// SIG-61 T3: the deletion procedure (ADR 0008, docs/runbooks/real-data-deletion.md). Removes every
// record for one consumer from every store the secure environment holds, then proves nothing
// remains. The receipt holds counts per store, the date and the outcome, never the consumer
// reference or any personal data, so it can be kept as a run record through the T2 guard.
//
// Nothing is ever de-identified or kept for research (ruling N-1, 9 November 2026: openfeed's
// onward-disclosure terms apply and its flow captures no de-identification consent), so every
// record a person has is in scope.
import { assertConsumerRef, STORES, type ConsumerStore, type StoreName } from "./stores.js";

export const RECEIPT_SCHEMA_VERSION = "1.0.0";

export type StoreOutcome = {
  store: StoreName;
  deleted: number;
  /** Records left after deletion; null when the store could not be read. */
  remaining: number | null;
  outcome: "complete" | "failed";
};

export type DeletionReceipt = {
  record_type: "deletion_receipt";
  schema_version: typeof RECEIPT_SCHEMA_VERSION;
  data_source: "openfeed-production";
  /** The UTC date of the deletion, from the timestamp passed in. Times stay in the audit log. */
  deleted_on: string;
  status: "complete" | "failed";
  verified: boolean;
  stores: StoreOutcome[];
  deidentified_data_in_scope: false;
};

export type Verification = {
  verified: boolean;
  stores: { store: StoreName; remaining: number | null }[];
};

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** The UTC date of an ISO 8601 timestamp. The caller passes the time; nothing reads the clock. */
export function utcDate(at: string): string {
  const ms = Date.parse(at);
  if (!ISO_TIMESTAMP.test(at) || Number.isNaN(ms))
    throw new Error("The deletion timestamp must be an ISO 8601 date-time with a zone");
  return new Date(ms).toISOString().slice(0, 10);
}

function checkCoverage(stores: readonly ConsumerStore[]): void {
  const names = stores.map((s) => s.name);
  const missing = STORES.filter((n) => !names.includes(n));
  if (missing.length)
    throw new Error(`The deletion must cover every store; missing: ${missing.join(", ")}`);
  if (new Set(names).size !== names.length) throw new Error("Each store is given once");
}

/** Proves nothing remains for the consumer in any store. A store that can't be read fails it. */
export async function verifyDeleted(
  stores: readonly ConsumerStore[],
  consumerRef: string,
): Promise<Verification> {
  assertConsumerRef(consumerRef);
  checkCoverage(stores);
  const out = await Promise.all(
    stores.map(async (s) => {
      try {
        return { store: s.name, remaining: await s.count(consumerRef) };
      } catch {
        return { store: s.name, remaining: null };
      }
    }),
  );
  return { verified: out.every((s) => s.remaining === 0), stores: out };
}

/**
 * Deletes every record for the consumer from every store, then verifies. Every store is attempted
 * even when one fails; a failed store fails the receipt. Running it again is safe: the second
 * receipt deletes nothing and verifies.
 */
export async function deleteConsumer(
  stores: readonly ConsumerStore[],
  consumerRef: string,
  at: string,
): Promise<DeletionReceipt> {
  assertConsumerRef(consumerRef);
  checkCoverage(stores);
  const deletedOn = utcDate(at);
  const deleted = await Promise.all(
    stores.map(async (s) => {
      try {
        return { store: s.name, deleted: await s.deleteConsumer(consumerRef), ok: true };
      } catch {
        return { store: s.name, deleted: 0, ok: false };
      }
    }),
  );
  const verification = await verifyDeleted(stores, consumerRef);
  const outcomes: StoreOutcome[] = deleted.map((d) => {
    const remaining = verification.stores.find((v) => v.store === d.store)?.remaining ?? null;
    return {
      store: d.store,
      deleted: d.deleted,
      remaining,
      outcome: d.ok && remaining === 0 ? "complete" : "failed",
    };
  });
  const complete = outcomes.every((o) => o.outcome === "complete") && verification.verified;
  return {
    record_type: "deletion_receipt",
    schema_version: RECEIPT_SCHEMA_VERSION,
    data_source: "openfeed-production",
    deleted_on: deletedOn,
    status: complete ? "complete" : "failed",
    verified: verification.verified,
    stores: [...outcomes].sort((a, b) => STORES.indexOf(a.store) - STORES.indexOf(b.store)),
    deidentified_data_in_scope: false,
  };
}
