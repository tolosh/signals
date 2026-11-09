// SIG-61 T3: the stores the secure processing environment would hold for a real-data run
// (ADR 0008). Every store is keyed by an opaque consumer reference, so one person's records can be
// found and deleted in every store. The in-memory and local-filesystem stores here are the test
// implementations; the secure environment's is S3Store (s3-store.ts), one SSE-KMS bucket per
// store. openfeed_grants holds each person's grant link: the
// grant ID, its revision, the consent record and the sealed refresh token, so deleting a person
// removes the link and the token with their data.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Every store the environment holds. The deletion procedure covers all of them. */
export const STORES = [
  "raw_grant_data",
  "derived_features",
  "truth_capture",
  "run_inputs",
  "openfeed_grants",
] as const;
export type StoreName = (typeof STORES)[number];

/** An opaque consumer reference, issued in the secure environment. It names no one. */
export const CONSUMER_REF = /^cr_[0-9a-z]{16,64}$/;
const RECORD_ID = /^[0-9a-z_-]{1,64}$/;

export function assertConsumerRef(ref: string): void {
  if (!CONSUMER_REF.test(ref)) throw new Error("Not an opaque consumer reference (cr_…)");
}
function assertRecordId(id: string): void {
  if (!RECORD_ID.test(id)) throw new Error("Record IDs are lower-case identifiers");
}

export interface ConsumerStore {
  readonly name: StoreName;
  put(consumerRef: string, recordId: string, record: unknown): Promise<void>;
  get(consumerRef: string): Promise<unknown[]>;
  /** How many records the store holds for the consumer. */
  count(consumerRef: string): Promise<number>;
  /** Removes every record for the consumer; returns how many were removed. Idempotent. */
  deleteConsumer(consumerRef: string): Promise<number>;
  /** The consumers the store holds records for (the revocation poller reads openfeed_grants). */
  listConsumers(): Promise<string[]>;
}

export class MemoryStore implements ConsumerStore {
  private readonly byConsumer = new Map<string, Map<string, unknown>>();
  constructor(readonly name: StoreName) {}

  async put(consumerRef: string, recordId: string, record: unknown): Promise<void> {
    assertConsumerRef(consumerRef);
    assertRecordId(recordId);
    const records = this.byConsumer.get(consumerRef) ?? new Map<string, unknown>();
    records.set(recordId, structuredClone(record));
    this.byConsumer.set(consumerRef, records);
  }
  async get(consumerRef: string): Promise<unknown[]> {
    return [...(this.byConsumer.get(consumerRef)?.values() ?? [])].map((r) => structuredClone(r));
  }
  async count(consumerRef: string): Promise<number> {
    return this.byConsumer.get(consumerRef)?.size ?? 0;
  }
  async deleteConsumer(consumerRef: string): Promise<number> {
    const n = await this.count(consumerRef);
    this.byConsumer.delete(consumerRef);
    return n;
  }
  async listConsumers(): Promise<string[]> {
    return [...this.byConsumer.keys()].sort();
  }
}

/**
 * A store on the local filesystem: <root>/<store>/<sha256 of the consumer ref>/<record>.json. The
 * folder name is a hash, so the reference itself is never a path. Local tests only; root must be
 * under realdata/ or a temporary folder, never the repository's tracked folders.
 */
export class FileStore implements ConsumerStore {
  constructor(
    readonly name: StoreName,
    private readonly root: string,
  ) {}

  private dir(consumerRef: string): string {
    assertConsumerRef(consumerRef);
    const hash = createHash("sha256").update(consumerRef).digest("hex");
    return join(this.root, this.name, hash);
  }
  async put(consumerRef: string, recordId: string, record: unknown): Promise<void> {
    assertRecordId(recordId);
    const dir = this.dir(consumerRef);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${recordId}.json`), JSON.stringify(record));
    // The opaque reference, beside the folder, so listConsumers can name it.
    writeFileSync(`${dir}.ref`, consumerRef);
  }
  async get(consumerRef: string): Promise<unknown[]> {
    const dir = this.dir(consumerRef);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .sort()
      .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown);
  }
  async count(consumerRef: string): Promise<number> {
    const dir = this.dir(consumerRef);
    return existsSync(dir) ? readdirSync(dir).length : 0;
  }
  async deleteConsumer(consumerRef: string): Promise<number> {
    const n = await this.count(consumerRef);
    rmSync(this.dir(consumerRef), { recursive: true, force: true });
    rmSync(`${this.dir(consumerRef)}.ref`, { force: true });
    return n;
  }
  async listConsumers(): Promise<string[]> {
    const dir = join(this.root, this.name);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".ref"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .sort();
  }
}
