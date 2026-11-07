// SIG-51 (ADR 0005, ruled 7 November 2026): the hosted mock keeps its state in one on-demand
// DynamoDB table, so a write is seen by every Lambda container. Each request:
//   1. reads the scenario's items (partition key = scenario),
//   2. resets the mock to its seeded fixtures and applies them,
//   3. runs the ordinary synchronous handler,
//   4. writes back only the items that changed, each with a 7-day TTL.
// The scenario comes from the X-Mock-Scenario header ("default" when absent), so tests can run
// without touching the state Lovable works against. POST /mock-reset clears a scenario back to
// the fixtures; POST /mock-reset/requests clears its evidence requests only. Both are mock-only
// and outside the contract. Mock only: real persistence is Aurora with RLS (WP2), and nothing in
// src/engines or the production API may use this table.
import {
  BatchWriteItemCommand,
  DynamoDBClient,
  QueryCommand,
  type WriteRequest,
} from "@aws-sdk/client-dynamodb";
import { createMockHandler, type MockRequestInfo, type MockResponse } from "./server.js";
import { restoreAll, snapshotAll } from "./state.js";

export const TTL_SECONDS = 7 * 24 * 60 * 60;
/** DynamoDB items are at most 400 KB; values longer than this are split across items. */
export const CHUNK_CHARS = 300_000;
const SCENARIO = /^[a-z0-9-]{1,40}$/;

export type StoredItem = { pk: string; sk: string; data: string; expires_at: number };
export interface StateStore {
  query(pk: string): Promise<StoredItem[]>;
  write(puts: StoredItem[], deletes: { pk: string; sk: string }[]): Promise<void>;
}

/** The table's rows for a key: one item, or parts `${key}#part#${n}` when the value is long. */
export function toItems(pk: string, key: string, value: string, expires: number): StoredItem[] {
  if (value.length <= CHUNK_CHARS) return [{ pk, sk: key, data: value, expires_at: expires }];
  const parts: StoredItem[] = [];
  for (let i = 0; i * CHUNK_CHARS < value.length; i++)
    parts.push({
      pk,
      sk: `${key}#part#${String(i).padStart(4, "0")}`,
      data: value.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS),
      expires_at: expires,
    });
  return parts;
}

/** Joins parts back into values. A value with a missing part (expired mid-way) is dropped. */
export function fromItems(items: StoredItem[]): { values: Map<string, string>; sks: Set<string> } {
  const values = new Map<string, string>();
  const parts = new Map<string, string[]>();
  for (const it of [...items].sort((a, b) => (a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0))) {
    const m = /^(.*)#part#(\d{4})$/.exec(it.sk);
    if (!m) values.set(it.sk, it.data);
    else {
      const list = parts.get(m[1] as string) ?? [];
      if (Number(m[2]) === list.length) list.push(it.data);
      parts.set(m[1] as string, list);
    }
  }
  for (const [key, list] of parts) {
    const whole = list.join("");
    try {
      JSON.parse(whole);
      values.set(key, whole);
    } catch {
      // incomplete: ignore, the seed stands
    }
  }
  return { values, sks: new Set(items.map((i) => i.sk)) };
}

export type PersistentRequest = {
  method: string;
  path: string;
  scenario: string;
  prefer?: string;
  query?: string;
  request?: MockRequestInfo;
};
export type PersistentHandler = (r: PersistentRequest) => Promise<MockResponse>;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization,content-type,idempotency-key,prefer,x-mock-scenario",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
};
const badScenario = (): MockResponse => ({
  status: 400,
  headers: { ...CORS, "content-type": "application/json" },
  body: JSON.stringify({
    error: {
      code: "invalid_parameter",
      message: "X-Mock-Scenario must be 1 to 40 characters of a to z, 0 to 9 and hyphens",
    },
  }),
});

export function createPersistentHandler(
  store: StateStore,
  now: () => number = Date.now,
): PersistentHandler {
  const handle = createMockHandler();
  return async ({ method, path, scenario, prefer, query = "", request = {} }) => {
    if (method.toLowerCase() === "options") return { status: 204, headers: CORS, body: "" };
    if (!SCENARIO.test(scenario)) return badScenario();
    const stored = await store.query(scenario);

    const reset =
      method.toLowerCase() === "post" &&
      (path === "/mock-reset" || path === "/mock-reset/requests");
    if (reset) {
      const prefix = path === "/mock-reset" ? "" : "request#";
      const deletes = stored
        .filter((i) => i.sk.startsWith(prefix))
        .map((i) => ({ pk: scenario, sk: i.sk }));
      await store.write([], deletes);
      return { status: 204, headers: CORS, body: "" };
    }

    const { values, sks } = fromItems(stored);
    restoreAll(values);
    const before = snapshotAll();
    const out = handle(method, path, prefer, query, request);
    const after = snapshotAll();

    const expires = Math.floor(now() / 1000) + TTL_SECONDS;
    const puts: StoredItem[] = [];
    const deletes: { pk: string; sk: string }[] = [];
    for (const [key, value] of after) {
      if (before.get(key) === value) continue;
      const items = toItems(scenario, key, value, expires);
      puts.push(...items);
      // Parts left over from a longer earlier value are removed.
      const kept = new Set(items.map((i) => i.sk));
      for (const sk of sks)
        if ((sk === key || sk.startsWith(`${key}#part#`)) && !kept.has(sk))
          deletes.push({ pk: scenario, sk });
    }
    for (const key of before.keys())
      if (!after.has(key))
        for (const sk of sks)
          if (sk === key || sk.startsWith(`${key}#part#`)) deletes.push({ pk: scenario, sk });
    if (puts.length > 0 || deletes.length > 0) await store.write(puts, deletes);
    return { ...out, headers: { ...out.headers, ...CORS } };
  };
}

/** For tests and the local server: the same contract as the table, in memory. */
export class MemoryStore implements StateStore {
  readonly #rows = new Map<string, StoredItem>();
  query(pk: string): Promise<StoredItem[]> {
    return Promise.resolve(
      [...this.#rows.values()].filter((r) => r.pk === pk).map((r) => ({ ...r })),
    );
  }
  write(puts: StoredItem[], deletes: { pk: string; sk: string }[]): Promise<void> {
    for (const d of deletes) this.#rows.delete(`${d.pk}\n${d.sk}`);
    for (const p of puts) this.#rows.set(`${p.pk}\n${p.sk}`, { ...p });
    return Promise.resolve();
  }
  items(): StoredItem[] {
    return [...this.#rows.values()].sort((a, b) =>
      `${a.pk}\n${a.sk}` < `${b.pk}\n${b.sk}` ? -1 : 1,
    );
  }
}

/** The DynamoDB table (MOCK_TABLE). Strongly consistent reads, so a write is seen at once. */
export class DynamoStore implements StateStore {
  readonly #client = new DynamoDBClient({});
  constructor(readonly table: string) {}

  async query(pk: string): Promise<StoredItem[]> {
    const out: StoredItem[] = [];
    let start: Record<string, { S: string }> | undefined;
    do {
      const res = await this.#client.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": { S: pk } },
          ConsistentRead: true,
          ...(start ? { ExclusiveStartKey: start } : {}),
        }),
      );
      for (const i of res.Items ?? [])
        out.push({
          pk: i.pk?.S ?? "",
          sk: i.sk?.S ?? "",
          data: i.data?.S ?? "",
          expires_at: Number(i.expires_at?.N ?? 0),
        });
      start = res.LastEvaluatedKey as Record<string, { S: string }> | undefined;
    } while (start);
    return out;
  }

  async write(puts: StoredItem[], deletes: { pk: string; sk: string }[]): Promise<void> {
    const requests: WriteRequest[] = [
      ...deletes.map((d) => ({ DeleteRequest: { Key: { pk: { S: d.pk }, sk: { S: d.sk } } } })),
      ...puts.map((p) => ({
        PutRequest: {
          Item: {
            pk: { S: p.pk },
            sk: { S: p.sk },
            data: { S: p.data },
            expires_at: { N: String(p.expires_at) },
          },
        },
      })),
    ];
    // A put and a delete of the same key can't share a batch; the planner never produces both.
    for (let i = 0; i < requests.length; i += 25) {
      let batch: WriteRequest[] = requests.slice(i, i + 25);
      for (let attempt = 0; batch.length > 0; attempt++) {
        if (attempt > 8) throw new Error("DynamoDB kept items unprocessed");
        const res = await this.#client.send(
          new BatchWriteItemCommand({ RequestItems: { [this.table]: batch } }),
        );
        batch = res.UnprocessedItems?.[this.table] ?? [];
        if (batch.length > 0) await new Promise((r) => setTimeout(r, 20 * 2 ** attempt));
      }
    }
  }
}
