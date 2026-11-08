// Signal definition registry, version 1 (SIG-39; Product Specification Amendment 2 §1 to §5).
// Every definition declares its minimum evidence (EQ-R4), whether it depends on something being
// absent (EQ-R2), whether it detects adverse categories that a statement feed may hide (EQ-R5),
// and its roll-up class. The evidence-quality layer is versioned with these definitions (EQ-R6).
// Retired IDs resolve as aliases and are never reused (D19, D20).

export const DEFINITIONS_VERSION = 1;

export type FamilyCode =
  "INC" | "LIQ" | "LIA" | "CON" | "INT" | "HOME" | "RES" | "TRJ" | "CMT" | "POS";
export type RollupClass =
  "knockout" | "refer" | "standard" | "context" | "review_only" | "indicative" | "positive";
export type FeedType = "cdr" | "uploaded_statement";
export type Basis = "observed" | "inferred" | "declared";
export type Detects = "presence" | "pattern";

export type SignalDefinition = {
  id: string;
  family: number;
  family_code: FamilyCode;
  name: string;
  rollup_class: RollupClass;
  min_history_months: number;
  feeds: FeedType[];
  depends_on_absence: boolean;
  /**
   * What the signal does (E-12, ruled 8 November 2026): "presence" detects something being
   * there, so a finding shows on a short history (EQ method 4); "pattern" judges a pattern over
   * time, so it keeps its minimum history. Every row declares it.
   */
  detects: Detects;
  adverse_detection: boolean;
  basis: Basis;
};

const BOTH: FeedType[] = ["cdr", "uploaded_statement"];
const FAMILY: Record<FamilyCode, number> = {
  INC: 1,
  LIQ: 2,
  LIA: 3,
  CON: 4,
  INT: 5,
  HOME: 6,
  RES: 7,
  TRJ: 8,
  CMT: 9,
  POS: 10,
};

type Row = [
  id: string,
  name: string,
  rollup_class: RollupClass,
  min_history_months: number,
  flags: {
    detects: Detects;
    absence?: boolean;
    adverse?: boolean;
    basis?: Basis;
    feeds?: FeedType[];
  },
];

// Interpretation E-5 (SIG-39): signals whose minimum history the specifications do not state
// (INC-01 to INC-05, LIA-01 to LIA-06, CMT) take the default lookback, 6 months.
const ROWS: Row[] = [
  ["INC-01", "Income regularity", "standard", 6, { detects: "pattern" }],
  ["INC-02", "Stated vs observed", "standard", 6, { detects: "pattern", basis: "inferred" }],
  ["INC-03", "Income mix", "standard", 6, { detects: "pattern" }],
  ["INC-04", "Employer tenure", "standard", 6, { detects: "pattern" }],
  ["INC-05", "Circular income", "standard", 6, { detects: "presence", absence: true }],
  ["INC-06", "Occupation fit", "standard", 3, { detects: "pattern", basis: "declared" }],
  ["INC-07", "Payer concentration", "context", 3, { detects: "pattern" }],
  ["INC-08", "Diversification", "context", 3, { detects: "pattern" }],
  ["INC-09", "Seasonality", "standard", 12, { detects: "pattern" }],
  ["INC-10", "Gig and platform income", "standard", 6, { detects: "pattern" }],
  ["INC-11", "Falling pay at the same payer", "standard", 3, { detects: "pattern" }],
  ["INC-12", "Interruptions", "standard", 6, { detects: "pattern" }],
  ["INC-13", "Pay-cycle change", "standard", 3, { detects: "pattern" }],
  [
    "LIA-01",
    "Undisclosed liabilities",
    "knockout",
    6,
    { detects: "presence", absence: true, adverse: true },
  ],
  ["LIA-02", "Loan stacking", "refer", 6, { detects: "presence", absence: true, adverse: true }],
  ["LIA-03", "Payday and SACC", "refer", 6, { detects: "presence", absence: true, adverse: true }],
  ["LIA-04", "Wage advance", "standard", 6, { detects: "presence", absence: true, adverse: true }],
  ["LIA-05", "BNPL", "standard", 6, { detects: "presence", absence: true, adverse: true }],
  ["LIA-06", "Private loans", "standard", 6, { detects: "presence", absence: true, adverse: true }],
  ["CMT-01", "Recurring commitments register", "context", 6, { detects: "pattern" }],
  ["CMT-02", "Irregular obligations", "standard", 12, { detects: "pattern", adverse: true }],
  ["CMT-03", "Declared vs observed commitments", "standard", 6, { detects: "pattern" }],
  ["CMT-04", "Shared household costs", "context", 6, { detects: "pattern" }],
  ["CMT-05", "Dependant-linked costs", "review_only", 6, { detects: "pattern" }],
  ["CMT-06", "Commitments falling due", "standard", 12, { detects: "pattern" }],
  ["POS-01", "Rent reliability", "positive", 6, { detects: "pattern" }],
  ["POS-02", "Cards cleared in full", "positive", 6, { detects: "pattern" }],
  ["POS-03", "Existing loan conduct", "positive", 6, { detects: "pattern" }],
  ["POS-04", "Bills paid on time", "positive", 6, { detects: "pattern" }],
  ["POS-05", "Savings habit", "positive", 6, { detects: "pattern" }],
  ["POS-06", "Demonstrated capacity", "positive", 3, { detects: "pattern" }],
  ["POS-07", "Resilience shown", "positive", 6, { detects: "pattern" }],
  ["POS-08", "Stable, diversified income", "positive", 6, { detects: "pattern" }],
  ["TRJ-01", "Savings trajectory", "indicative", 12, { detects: "pattern" }],
];

export const DEFINITIONS: Readonly<Record<string, SignalDefinition>> = Object.freeze(
  Object.fromEntries(
    ROWS.map(([id, name, rollup_class, min_history_months, flags]) => {
      const family_code = id.split("-")[0] as FamilyCode;
      const def: SignalDefinition = {
        id,
        family: FAMILY[family_code],
        family_code,
        name,
        rollup_class,
        min_history_months,
        feeds: flags.feeds ?? BOTH,
        depends_on_absence: flags.absence ?? false,
        detects: flags.detects,
        adverse_detection: flags.adverse ?? false,
        basis: flags.basis ?? "observed",
      };
      return [id, Object.freeze(def)];
    }),
  ),
);

/** The assessment-level checks are not signals, but their retired IDs resolve to them. */
export const EQ_CHECKS = Object.freeze({
  "EQ-01": { id: "EQ-01", name: "Income account present" },
  "EQ-02": { id: "EQ-02", name: "Unmatched own-account transfers" },
  "EQ-03": { id: "EQ-03", name: "Window covered" },
} as const);

export const ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "COV-01": "EQ-01",
  "COV-02": "EQ-02",
  "COV-03": "EQ-03",
  "LIQ-04": "TRJ-01",
});

/** A definition or EQ check by current or retired ID; undefined when the ID is unknown. */
export function definition(
  id: string,
): SignalDefinition | (typeof EQ_CHECKS)[keyof typeof EQ_CHECKS] | undefined {
  const current = ALIASES[id] ?? id;
  return DEFINITIONS[current] ?? EQ_CHECKS[current as keyof typeof EQ_CHECKS];
}
