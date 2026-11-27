// SIG-82 (ADR 0014): the demo stage's DynamoDB store. It is the hosted mock's store
// (src/mock/persist.ts, SIG-51): the same table layout (partition key pk, sort key sk, data, a TTL
// in expires_at), the same splitting of long values across items, and the same strongly
// consistent reads. It is copied here rather than imported because importing persist.ts pulls in
// the mock's fixtures, which the demo stage must never serve. Kept identical; a change to one is
// made to both.
import {
  BatchWriteItemCommand,
  DynamoDBClient,
  QueryCommand,
  type WriteRequest,
} from "@aws-sdk/client-dynamodb";

/** DynamoDB items are at most 400 KB; values longer than this are split across items. */
export const CHUNK_CHARS = 300_000;

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
