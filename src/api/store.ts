// SIG-82 (ruling 40775, 1; ADR 0014): the demo's persistence stand-in. It uses ./dynamo.ts, a copy
// of the hosted mock's DynamoDB store (one on-demand table, partition key pk, sort key sk, values
// split across items when long). Tenant isolation is structural: every workspace's records sit
// under their own partition, ws#<workspace id>, and a request can only name the partition of the
// workspace its verified sign-in maps to. Portal tokens sit under the partition portal, each
// pointing at its workspace and applicant. Demo only: real persistence is Aurora with RLS (D1).
import { fromItems, toItems, type StateStore } from "./dynamo.js";

/** Demo records live for 30 days, past the 1 December demo. */
export const DEMO_TTL_SECONDS = 30 * 24 * 60 * 60;

export const workspacePartition = (workspaceId: string) => `ws#${workspaceId}`;
export const PORTAL_PARTITION = "portal";
/** Demo members' email-to-sub bindings (40820, 3; review 23). */
export const MEMBER_PARTITION = "member";

export class DemoStore {
  constructor(
    readonly rows: StateStore,
    readonly now: () => number = Date.now,
  ) {}

  /** Every record in a partition whose key starts with the prefix, keyed by the rest of the key. */
  async list<T>(pk: string, prefix: string): Promise<Map<string, T>> {
    const { values } = fromItems(await this.rows.query(pk));
    const out = new Map<string, T>();
    for (const [key, value] of [...values].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      if (key.startsWith(prefix)) out.set(key.slice(prefix.length), JSON.parse(value) as T);
    return out;
  }

  async get<T>(pk: string, key: string): Promise<T | null> {
    const { values } = fromItems(await this.rows.query(pk));
    const v = values.get(key);
    return v === undefined ? null : (JSON.parse(v) as T);
  }

  async put(pk: string, key: string, value: unknown): Promise<void> {
    const existing = (await this.rows.query(pk)).filter(
      (i) => i.sk === key || i.sk.startsWith(`${key}#part#`),
    );
    const expires = Math.floor(this.now() / 1000) + DEMO_TTL_SECONDS;
    const items = toItems(pk, key, JSON.stringify(value), expires);
    const kept = new Set(items.map((i) => i.sk));
    await this.rows.write(
      items,
      existing.filter((i) => !kept.has(i.sk)).map((i) => ({ pk, sk: i.sk })),
    );
  }
}
