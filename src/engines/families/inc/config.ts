// Workspace configuration for family 1 (SIG-41). Every amber and red threshold is an illustrative
// starting point that the lender calibrates (Amendment 2, design rule 5). Values marked
// "candidate" are interpretations recorded in docs/adr/0004-inc-family.md for ruling.

/** AF-I2 stream types (interest is never income, AF-I5). */
export type StreamType =
  | "salary"
  | "overtime_bonus"
  | "commission"
  | "government_benefit"
  | "rental"
  | "gig_platform"
  | "other";

export type IncConfig = {
  /** AF-I3 shading by type. INC-R1: variable income is shaded 20% by default. */
  shading: Record<StreamType, number>;
  /** INC-06: the workspace's pay band per occupation, in net dollars a month. None by default. */
  occupation_bands: Record<string, { min_monthly: number; max_monthly: number }>;
  /** INC-04 red: the lender's policy loan size. None by default, so INC-04 is never red. */
  policy_loan_amount: number | null;
  /** INC-07 amber: a "large loan". A candidate workspace default (ruling 3, 7 November 2026). */
  large_loan_amount: number;
  /** INC-03 red: a "loan sized for wages". A candidate workspace default (ruling 3). */
  wage_sized_loan_amount: number;
  /**
   * INC-10: gig and platform payers. Until Enrich curates them (Amendment 2 §4.1, "Enrich
   * need"), this is the synthetic fixtures' list only (SIG-12 catalog GIG_PAYERS).
   */
  gig_payers: readonly string[];
  /** Government benefit payers. */
  benefit_payers: readonly string[];
};

export const INC_DEFAULTS: Readonly<IncConfig> = Object.freeze({
  shading: Object.freeze({
    salary: 1,
    overtime_bonus: 0.8,
    commission: 0.8,
    rental: 0.8,
    gig_platform: 0.8,
    government_benefit: 0,
    other: 1,
  }),
  occupation_bands: Object.freeze({}),
  policy_loan_amount: null,
  large_loan_amount: 500_000,
  wage_sized_loan_amount: 20_000,
  gig_payers: Object.freeze(["UBER AUSTRALIA PTY", "DOORDASH AUSTRALIA", "AIRTASKER"]),
  benefit_payers: Object.freeze(["SERVICES AUSTRALIA", "CENTRELINK"]),
}) as Readonly<IncConfig>;

/** Workspace defaults the specifications don't give, ruled as candidates each lender can change. */
export const INC_CANDIDATES = Object.freeze([
  "wage_sized_loan_amount",
  "large_loan_amount",
] as const);

/** The contract's PolicyInput.income_signals (1.7.0), as a lender saves it. */
export type IncomeSignalsPolicy = {
  wage_sized_loan_amount?: number;
  large_loan_amount?: number;
  policy_loan_amount?: number | null;
};

/**
 * Maps a lender's income_signals policy onto the INC config (SIG-41 review, fix 5). The names
 * are the contract's; a field the policy leaves out keeps the workspace default.
 */
export function incConfigFromPolicy(
  signals: IncomeSignalsPolicy | null | undefined,
): Partial<IncConfig> {
  const out: Partial<IncConfig> = {};
  if (!signals) return out;
  if (signals.wage_sized_loan_amount !== undefined)
    out.wage_sized_loan_amount = signals.wage_sized_loan_amount;
  if (signals.large_loan_amount !== undefined) out.large_loan_amount = signals.large_loan_amount;
  if (signals.policy_loan_amount !== undefined) out.policy_loan_amount = signals.policy_loan_amount;
  return out;
}

/** Thresholds from Amendment 2 §4.1 and Product Specification §7.2. */
export const INC_THRESHOLDS = Object.freeze({
  /** INC-01 */
  regularity_variation: 0.2,
  regularity_late_cycles: 1.5,
  /** INC-02 */
  stated_gap_amber: 0.1,
  stated_gap_red: 0.2,
  /** INC-03 */
  variable_share: 0.3,
  /** INC-04 */
  tenure_months: 3,
  /** INC-05 (N-6): material, as for EQ-02 (D23). */
  circular_material_share: 0.05,
  /** INC-08 */
  diversification_share: 0.1,
  /** INC-09 */
  trough_share: 0.6,
  /** INC-10 */
  gig_amber: 0.3,
  gig_red: 0.5,
  gig_decline: 0.1,
  /** INC-11 */
  falling_amber: 0.1,
  falling_red: 0.25,
  falling_cycles: 3,
  /** INC-12 */
  interruption_window_months: 6,
  interruption_recent_days: 60,
  /** INC-13 */
  change_window_days: 90,
  change_pay_fall: 0.1,
});
