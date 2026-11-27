// SIG-70: the categorisation port (D42). One interface, two implementations: LocalEnrich, the
// pinned local engine (local.ts), and ApiEnrich, Enrich's API under the lender's own tenant
// (waiting for SIG-72's service credential and tenant mapping, ruling 40719). The engines never
// call either: they read the categories stored with each assessment (D3).

/** How an assessment was categorised. */
export type EnrichPath = "api" | "local" | "api_fallback_local";
/** The lender's Enrich tenant (SIG-72). Only an active tenant uses the API. */
export type TenantStatus = "active" | "pending" | "none";

/** A transaction as the feed gives it; only these fields are sent to Enrich. */
export type EnrichTx = {
  transactionId: string;
  description: string;
  amount: string;
  merchantCategoryCode?: string;
  merchantName?: string;
  billerCode?: string;
  billerName?: string;
  reference?: string;
};

/** One transaction's result, as Enrich returned it, with its transaction id. */
export type EnrichResult = {
  transaction_id: string;
  category: string;
  [field: string]: unknown;
};
export type EnrichResponse = {
  engine_version: string;
  taxonomy_version: string;
  results: EnrichResult[];
};
/**
 * The taxonomy as the categoriser publishes it: Enrich's TaxonomyDocument, the shape GET
 * /v1/taxonomy serves and the engine's taxonomyDocument() returns.
 */
export type Taxonomy = { taxonomy_version: string; [field: string]: unknown };

/**
 * A pinned engine build: the moroku-enrich commit, the version, and the SHA-256 of its dist tree
 * (every built file; dist/index.js alone doesn't change between builds).
 */
export type EngineBuild = { commit: string; version: string; dist_sha256: string };

export interface Categoriser {
  readonly path: "api" | "local";
  /** The pinned build a local categoriser runs; null for the API. */
  readonly build?: EngineBuild | null;
  categorise(txs: readonly EnrichTx[]): Promise<EnrichResponse>;
  taxonomy(): Promise<Taxonomy>;
}

export type FallbackReason = "timeout" | "server_error" | "rate_limited" | "unavailable" | "error";

/** What is stored with every assessment (SIG-70 section 4): enough to replay it, never re-call. */
export type EnrichRecord = {
  path: EnrichPath;
  engine_version: string;
  taxonomy_version: string;
  taxonomy: Taxonomy;
  /** The local engine build that categorised it; null on the API path. */
  build: EngineBuild | null;
  /** Why the API wasn't used, when it should have been. */
  fallback?: { reason: FallbackReason };
  /**
   * Set when an active tenant's API was refused because the feed wasn't marked as real, consented
   * data. Synthetic data never goes to the API (D42), and the API refuses by default (fail closed,
   * SIG-70 ruling 40740, O4).
   */
  api_refused?: "not_marked_real";
  transactions: number;
  response: EnrichResponse;
};
