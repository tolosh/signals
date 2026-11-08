// SIG-61 T3: the deletion procedure (ADR 0008). Stub: the tests are written first and fail on
// their assertions until the procedure is implemented.
import type { ConsumerStore, StoreName } from "./stores.js";

export const RECEIPT_SCHEMA_VERSION = "1.0.0";
export type StoreOutcome = {
  store: StoreName;
  deleted: number;
  remaining: number | null;
  outcome: "complete" | "failed";
};
export type DeletionReceipt = {
  record_type: "deletion_receipt";
  schema_version: typeof RECEIPT_SCHEMA_VERSION;
  data_source: "openfeed-production";
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

export const utcDate = (at: string): string => (at === at ? "" : at);

export async function verifyDeleted(
  stores: readonly ConsumerStore[],
  consumerRef: string,
): Promise<Verification> {
  void stores;
  void consumerRef;
  return { verified: false, stores: [] };
}

export async function deleteConsumer(
  stores: readonly ConsumerStore[],
  consumerRef: string,
  at: string,
): Promise<DeletionReceipt> {
  void stores;
  void consumerRef;
  void at;
  return {
    record_type: "deletion_receipt",
    schema_version: RECEIPT_SCHEMA_VERSION,
    data_source: "openfeed-production",
    deleted_on: "",
    status: "failed",
    verified: false,
    stores: [],
    deidentified_data_in_scope: false,
  };
}
