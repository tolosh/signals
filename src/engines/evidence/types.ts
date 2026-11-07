// Inputs and outputs of the evidence-quality layer (SIG-39; Amendment 2 §2 and §3).
import type { Basis, FeedType, RollupClass } from "../signals/definitions.js";

/** The parts of a CDR banking transaction the layer reads. */
export type FeedTransaction = {
  accountId: string;
  transactionId: string;
  type: string;
  description: string;
  postingDateTime?: string;
  valueDateTime?: string;
  amount: string;
  reference?: string;
  merchantName?: string;
  merchantCategoryCode?: string;
  billerCode?: string;
};

export type FeedAccount = {
  account: { accountId: string; productCategory?: string };
  detail?: { data?: { bsb?: string; accountNumber?: string } };
  transactions: FeedTransaction[];
};

/** What the grant shared: shared accounts only. */
export type Feed = { accounts: FeedAccount[] };

export type EvidenceInput = {
  feed: Feed;
  /** Known from ingestion: a CDR grant, or an uploaded statement. */
  feed_type: FeedType;
  /** The end of the lookback window, inclusive (YYYY-MM-DD). */
  as_of: string;
  /**
   * The lookback the lender requested (D22): 6 months by default, never under 3. EQ-03 is
   * judged against it; signals keep their own minimum history (EQ-R4).
   */
  lookback_months?: number;
};

export type CheckResult = "pass" | "partial" | "fail";

export type EvidenceCheck = {
  id: "EQ-01" | "EQ-02" | "EQ-03";
  name: string;
  result: CheckResult;
  detail: string;
  resolve_with: string[];
  review_required: boolean;
};

/** Assessment-level evidence, computed once and applied to every signal. */
export type EvidenceContext = {
  definitions_version: number;
  as_of: string;
  lookback_months: number;
  window: { start: string; end: string };
  /** First and last transaction actually returned inside the window; null when none. */
  period: { start: string; end: string } | null;
  feed_type: FeedType;
  checks: EvidenceCheck[];
  primary_income_account_shared: boolean;
  income_account_ids: string[];
  shared_account_ids: string[];
  transaction_count: number;
  /** Distinct accounts outside the grant seen in own-account transfers (interpretation E-3). */
  unshared_own_accounts: number;
  institutions_without_shared_account: number;
  history_months_available: number;
  field_population_pct: number | null;
};

/** A family evaluator's output, before the evidence-quality layer is applied. */
export type RawSignal = {
  id: string;
  state: "green" | "amber" | "red" | "evidenced" | "not_observed";
  value: string | null;
  reason: string;
  confidence: "high" | "medium" | "low";
  /** True when the evaluator looked for something adverse and found none (EQ-R2). */
  nothing_found: boolean;
  evidence: {
    account_ids: string[];
    transaction_count: number;
    period_start?: string;
    period_end?: string;
  };
  /** Enrich's confident share for the transactions used, when the evaluator used Enrich. */
  enrich_confident_pct: number | null;
  /** Debit lines the evaluator could not classify that could be adverse (EQ-R5). */
  unrecognised_adverse: number;
  resolve_with?: string[];
  review_reason?: string | null;
};

export type EvidenceQuality = {
  observed: {
    period_start: string;
    period_end: string;
    account_ids: string[];
    transaction_count: number;
  };
  completeness: {
    primary_income_account_shared: boolean;
    unshared_own_account_transfers: number;
    institutions_without_shared_account: number;
    history_months_available: number;
    history_months_required: number;
  };
  reliability: {
    feed_type: FeedType;
    enrich_confident_pct: number | null;
    field_population_pct: number | null;
  };
  basis: Basis;
  resolve_with: string[];
  review_required: boolean;
  review_reason: string | null;
};

export type SignalState = RawSignal["state"] | "unverified" | "none_observed";

/** A signal in the contract's shape (openapi.yaml Signal, v1.2.0). */
export type Signal = {
  id: string;
  family: number;
  family_code: string;
  name: string;
  state: SignalState;
  rollup_class: RollupClass;
  value: string | null;
  reason: string;
  confidence: "high" | "medium" | "low";
  evidence_count: number;
  evidence_quality: EvidenceQuality;
};

export type EvidenceRollup = {
  /** "unverified" when RU-4 applies; otherwise null and the families decide. */
  state: "unverified" | null;
  /** RU-5: green needs EQ-01 and EQ-03 to pass and EQ-02 not to fail. */
  green_allowed: boolean;
  reasons: { signal_id: null; state: "unverified" | null; reason: string }[];
};
