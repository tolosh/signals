// Inputs and outputs of the synthetic applicant generator (SIG-12).

export const GENERATOR_VERSION = "1.0.0";
export const GROUND_TRUTH_SCHEMA_VERSION = "1.0.0";
/** Set v2 (SIG-54): an applicant whose spec has a `v2` block is generated at 2.0.0. */
export const GENERATOR_VERSION_V2 = "2.0.0";
export const GROUND_TRUTH_SCHEMA_VERSION_V2 = "2.0.0";
/** The fixed end of every history window; the generator never reads the clock. */
export const AS_OF_DATE = "2026-10-31";

export type Cadence = "weekly" | "fortnightly" | "monthly" | "quarterly" | "annual";
export type Archetype = "salaried" | "variable" | "gig" | "benefits";
export type FeedType = "cdr" | "uploaded_statement";
export type LiabilityType =
  "credit_card" | "personal_loan" | "car_loan" | "mortgage" | "bnpl" | "sacc" | "wage_advance";

export type CommitmentSpec = { kind: string; cadence: Cadence; amount: number };
export type LiabilitySpec = {
  type: LiabilityType;
  declared?: boolean;
  account_shared?: boolean;
  limit?: number;
  balance?: number;
  repayment?: number;
  cadence?: Cadence;
  provider?: string;
  // Set v2 (SIG-54, from the SIG-18 review). All optional; absent, the liability is as in v1.
  /** Repaid from an account outside the grant: real, but no repayment is visible. */
  paid_from_unshared?: boolean;
  /** How the application names the lender, when not as the feed does ("Commonwealth Bank"). */
  declared_as?: string;
  /** The lender narrative carries a reference or customer number. */
  narrative_ref?: boolean;
  /** False: a card's BPAY biller name and narrative don't say "credit card". */
  biller_cue?: boolean;
  /** A lender absent from SIG-18's runs and from SIG-57's alias table. */
  unseen_lender?: boolean;
  mortgage?: { purpose: "owner_occupier" | "investor"; feature: "offset" | "redraw" | "none" };
};

/** Set v2 (SIG-54): what generator 2.0.0 adds to a spec. */
export type V2Spec = {
  /** The lender's requested lookback, drawn independently of the history held (D22). */
  requested_lookback: 3 | 6 | 12;
  /** Gross is the input, and net follows through the tax table (SIG-46 ruling). */
  gross_primary?: boolean;
  tax_year?: string;
  pay?: {
    /** Each pay has this chance of carrying overtime of `amount` (net). */
    overtime?: { share: number; amount: number };
    /** One pay carries a bonus of `amount` (net). */
    bonus?: { amount: number };
    /** From `after_days` into the window, pay changes (a rise, or a new employer). */
    change?: { after_days: number; net_per_pay: number; payer?: string };
  };
  /** The same employer under a second descriptor, later in the window or at a second bank. */
  payer_drift?: { mode: "over_time" | "across_banks"; alias: string };
  /** Dishonours on these days before the as-of date. */
  dishonours?: { days_ago: number[] };
};

/** Everything that shapes one applicant. Scenarios for later tickets are overrides of this. */
export type ApplicantSpec = {
  id: string;
  tags: string[];
  archetype: Archetype;
  income: {
    cadence: "weekly" | "fortnightly" | "monthly";
    net_per_pay: number;
    gross_annual: number;
    variability: number;
    payer: string;
  };
  history_months: 1 | 3 | 6 | 12;
  feed: FeedType;
  coverage: { salary_account_shared: boolean; unshared_transfer_accounts: number };
  expenses: { profile: "lean" | "typical" | "high"; rent_monthly: number };
  commitments: CommitmentSpec[];
  liabilities: LiabilitySpec[];
  behaviours: {
    gambling_weekly: number;
    dishonours: number;
    positive: { rent_on_time: boolean; cards_cleared_in_full: boolean; savings_monthly: number };
  };
  /** Set v2 only. */
  v2?: V2Spec;
};

type DeepPartial<T> = T extends (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
export type SpecOverrides = DeepPartial<Omit<ApplicantSpec, "id">>;

/** CDR banking transaction (research/schemas/cdr-banking-v1.schema.json). */
export type Transaction = {
  accountId: string;
  transactionId: string;
  isDetailAvailable: boolean;
  type: "FEE" | "TRANSFER_OUTGOING" | "TRANSFER_INCOMING" | "PAYMENT" | "DIRECT_DEBIT" | "OTHER";
  status: "POSTED";
  description: string;
  postingDateTime?: string;
  valueDateTime?: string;
  amount: string;
  currency: "AUD";
  reference: string;
  merchantName?: string;
  merchantCategoryCode?: string;
  billerCode?: string;
  billerName?: string;
};

export type FeedAccount = {
  account: Record<string, unknown>;
  detail: unknown;
  balance: unknown;
  transactions: Transaction[];
  transactionList: unknown;
};

export type GroundTruth = {
  schema_version: string;
  generator_version: string;
  applicant_id: string;
  seed: number;
  tags: string[];
  archetype: Archetype;
  feed_type: FeedType;
  history: { months: number; start_date: string; end_date: string };
  coverage: {
    salary_account_shared: boolean;
    unshared_transfer_accounts: number;
    transfers_to_unshared_count: number;
    shared_account_ids: string[];
    unshared_account_ids: string[];
  };
  income: {
    net_monthly: number;
    gross_annual: number;
    streams: {
      type: "salary" | "variable" | "gig" | "benefit";
      payer: string;
      cadence: Cadence;
      net_per_pay: number;
      variability: number;
      net_monthly: number;
      account_id: string;
      account_shared: boolean;
    }[];
  };
  expenses: {
    committed_monthly: number;
    basic_monthly: number;
    discretionary_monthly: number;
    total_monthly: number;
    items: {
      name: string;
      group: "committed" | "basic" | "discretionary";
      cadence: Cadence;
      monthly_equivalent: number;
    }[];
  };
  commitments: {
    kind: string;
    cadence: Cadence;
    amount: number;
    monthly_equivalent: number;
    occurrences_in_window: number;
    account_id: string;
  }[];
  liabilities: {
    repayments_monthly: number;
    items: {
      id: string;
      type: LiabilityType;
      provider: string;
      declared: boolean;
      account_shared: boolean;
      limit: number | null;
      balance: number | null;
      repayment: number;
      cadence: Cadence;
      monthly_commitment: number;
    }[];
  };
  behaviours: {
    gambling_monthly: number | null;
    dishonours: number;
    positive: {
      rent_on_time: boolean;
      cards_cleared_in_full: boolean;
      savings_growing: boolean;
      savings_monthly: number;
      no_dishonours: boolean;
    };
  };
  surplus_monthly: number;
  /** Schema 2.0.0 additions (set v2). Absent at 1.0.0. */
  v2?: V2Truth;
};

export type V2Truth = {
  request: { lookback_months: number };
  /** Gross to net through the tax table; null when gross isn't the input (gig, benefits). */
  tax: {
    gross_annual: number;
    tax: number;
    medicare_levy: number;
    net_annual: number;
    tax_table: string;
  } | null;
  payers: { payer: string; aliases: string[]; from: string; to: string }[];
  pay_events: {
    kind: "overtime" | "bonus" | "change";
    date: string;
    transaction_id: string | null;
    amount: number;
  }[];
  /** Pay actually received over the window, a monthly mean; net_monthly is the rate at as-of. */
  received_net_monthly: number;
  dishonour_events: { date: string; days_ago: number; recent: boolean; transaction_id: string }[];
  bpay: {
    transaction_id: string | null;
    biller_name: string;
    biller_code: string;
    kind: "bill" | "card_repayment";
    item: string | null;
    true_group: "committed" | "basic" | "discretionary" | null;
    true_category: string | null;
  }[];
  liabilities: {
    id: string;
    lender: string;
    declared_as: string | null;
    unseen_lender: boolean;
    paid_from_account_id: string;
    paid_from_shared: boolean;
    repayment_transaction_ids: string[];
    narrative_ref: string | null;
    biller_cue: boolean;
    mortgage: {
      purpose: "owner_occupier" | "investor";
      feature: "offset" | "redraw" | "none";
    } | null;
  }[];
};

export type GeneratedApplicant = {
  truth: GroundTruth;
  /** What the lender has: the application, for declared-versus-found comparisons. */
  application: {
    stated_gross_annual: number;
    declared_liabilities: { type: LiabilityType; provider: string; repayment_monthly: number }[];
  };
  /** What a grant shares: shared accounts only, in CDR response shapes. */
  feed: { accountList: unknown; accounts: FeedAccount[] };
};
