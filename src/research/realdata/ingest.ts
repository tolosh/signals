// SIG-61 (10:50, item 4): ingestion from openfeed into the secure store. It runs once, while the
// person is connecting, with their own DPoP-bound token: openfeed's client-credentials tokens can't
// read data (client.ts).
//
// - The grant must be ACTIVE. Only the accounts the grant covers are read, never account detail
//   (where openfeed returns the unmasked account number).
// - It keeps only the fields the engines read (TRANSACTION_FIELDS, ACCOUNT_FIELDS); display names
//   and masked numbers are dropped.
// - It covers LOOKBACK_MONTHS to the as-of date, the longest any engine reads (LIA-03: 12 months).
// - It writes only to the secure stores, and is all-or-nothing: on any failure everything written
//   for the person is deleted. A revocation part-way through (403 disclosure_grant_required) purges
//   at once.
// - The grant link (grant ID, revision, consent record, purge date and the refresh token, sealed
//   with KMS) goes in openfeed_grants, so the revocation poller can find it and deleting the person
//   removes it.
// - It returns a summary of counts that the T2 guard accepts.
import {
  GrantRevokedError,
  type BankingAccount,
  type BankingTransaction,
  type GrantDetail,
  type UserTokens,
} from "../../connectors/openfeed/client.js";
import { purgeBy, retentionRule, type ConsentRecord } from "./consent.js";
import { deleteConsumer, type DeletionReceipt } from "./deletion.js";
import { assertGuarded } from "./guard.js";
import type { Sealer } from "./sealer.js";
import { assertConsumerRef, STORES, type ConsumerStore, type StoreName } from "./stores.js";

export const LOOKBACK_MONTHS = 12;
export const CHUNK = 200;
export const INGEST_SCHEMA_VERSION = "1.0.0";

/** The transaction fields the engines read (openfeed's BankingTransaction, camel case). */
export const TRANSACTION_FIELDS: readonly string[] = [
  "transactionId",
  "accountId",
  "amount",
  "currency",
  "transactionDate",
  "valueDate",
  "postedDateTime",
  "executionDateTime",
  "description",
  "reference",
  "transactionType",
  "status",
  "merchantName",
  "merchantCategoryCode",
  "billerCode",
  "billerName",
  "apcaNumber",
];
/** The account fields the engines read. displayName, maskedNumber and productName are dropped. */
export const ACCOUNT_FIELDS: readonly string[] = [
  "accountId",
  "accountType",
  "productCategory",
  "status",
  "isOwned",
  "accountOwnership",
  "providerId",
  "providerName",
];

export interface DataApi {
  getGrant(tokens: UserTokens, grantId: string): Promise<GrantDetail>;
  listAccounts(tokens: UserTokens): Promise<BankingAccount[]>;
  listTransactions(
    tokens: UserTokens,
    accountId: string,
    window: { oldestDate: string; newestDate: string },
  ): Promise<BankingTransaction[]>;
}

export type IngestDeps = { api: DataApi; stores: readonly ConsumerStore[]; sealer: Sealer };
export type IngestInput = {
  consumerRef: string;
  tokens: UserTokens;
  /** The last day read, an ISO date. */
  asOf: string;
  consent: ConsentRecord;
  revision: number;
};

export type GrantLink = {
  consumer_ref: string;
  grant_id: string;
  revision: number;
  sealed_refresh_token: string;
  consent: ConsentRecord;
  retention: "purge_after_comparison";
  connected_on: string;
  purge_by: string;
};

export type IngestSummary = {
  record_type: "ingest_summary";
  schema_version: typeof INGEST_SCHEMA_VERSION;
  data_source: "openfeed-production";
  consent_basis: "openfeed-onward-disclosure";
  retention: "purge_after_comparison";
  status: "complete" | "revoked";
  lookback_months: number;
  accounts: number;
  transactions: number;
  purge?: { status: DeletionReceipt["status"]; verified: boolean };
};

const pick = (o: Record<string, unknown>, fields: readonly string[]) =>
  Object.fromEntries(fields.filter((f) => o[f] !== undefined).map((f) => [f, o[f]]));

/** The first day of the lookback: LOOKBACK_MONTHS before the as-of date, plus one day. */
export function lookbackStart(asOf: string): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error("asOf is an ISO date");
  d.setUTCMonth(d.getUTCMonth() - LOOKBACK_MONTHS);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function storeMap(stores: readonly ConsumerStore[]): Record<StoreName, ConsumerStore> {
  const names = stores.map((s) => s.name);
  const missing = STORES.filter((n) => !names.includes(n));
  if (missing.length)
    throw new Error(`Ingestion needs every store; missing: ${missing.join(", ")}`);
  return Object.fromEntries(stores.map((s) => [s.name, s])) as Record<StoreName, ConsumerStore>;
}

export async function ingestGrant(deps: IngestDeps, input: IngestInput): Promise<IngestSummary> {
  assertConsumerRef(input.consumerRef);
  if (input.consent.consumer_ref !== input.consumerRef)
    throw new Error("The consent record is for someone else");
  const stores = storeMap(deps.stores);
  const base = {
    record_type: "ingest_summary",
    schema_version: INGEST_SCHEMA_VERSION,
    data_source: "openfeed-production",
    consent_basis: "openfeed-onward-disclosure",
    retention: retentionRule(input.consent),
    lookback_months: LOOKBACK_MONTHS,
  } as const;
  const window = { oldestDate: lookbackStart(input.asOf), newestDate: input.asOf };
  let accounts = 0;
  let transactions = 0;

  const purge = async () => {
    const at = `${input.consent.recorded_on}T00:00:00Z`;
    const receipt = await deleteConsumer(deps.stores, input.consumerRef, at);
    return { status: receipt.status, verified: receipt.verified };
  };

  try {
    const grant = await deps.api.getGrant(input.tokens, input.tokens.grantId);
    if (grant.grantStatus !== "ACTIVE") throw new GrantRevokedError(200, null, "grant not active");
    const covered = new Set(grant.bankingAccountIds);
    const all = (await deps.api.listAccounts(input.tokens)).filter((a) => covered.has(a.accountId));
    for (const [i, account] of all.entries()) {
      await stores.raw_grant_data.put(input.consumerRef, `account-${i}`, {
        kind: "account",
        account: pick(account, ACCOUNT_FIELDS),
      });
      const txns = await deps.api.listTransactions(input.tokens, account.accountId, window);
      for (let k = 0; k * CHUNK < txns.length; k++) {
        const chunk = txns
          .slice(k * CHUNK, (k + 1) * CHUNK)
          .map((t) => pick(t, TRANSACTION_FIELDS));
        await stores.raw_grant_data.put(input.consumerRef, `txns-${i}-${k}`, {
          kind: "transactions",
          account_index: i,
          transactions: chunk,
        });
      }
      accounts++;
      transactions += txns.length;
    }
    const link: GrantLink = {
      consumer_ref: input.consumerRef,
      grant_id: input.tokens.grantId,
      revision: input.revision,
      sealed_refresh_token: await deps.sealer.seal(input.tokens.refreshToken, input.consumerRef),
      consent: input.consent,
      retention: retentionRule(input.consent),
      connected_on: input.consent.recorded_on,
      purge_by: purgeBy(input.consent.recorded_on),
    };
    await stores.openfeed_grants.put(input.consumerRef, "grant", link);
  } catch (e) {
    const receipt = await purge();
    if (e instanceof GrantRevokedError) {
      const summary: IngestSummary = {
        ...base,
        status: "revoked",
        accounts: 0,
        transactions: 0,
        purge: receipt,
      };
      assertGuarded(summary);
      return summary;
    }
    throw e;
  }
  const summary: IngestSummary = { ...base, status: "complete", accounts, transactions };
  assertGuarded(summary);
  return summary;
}
