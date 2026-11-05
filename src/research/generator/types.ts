// Inputs and outputs of the synthetic applicant generator (SIG-12).

export const GENERATOR_VERSION = "1.0.0";
export const GROUND_TRUTH_SCHEMA_VERSION = "1.0.0";
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
