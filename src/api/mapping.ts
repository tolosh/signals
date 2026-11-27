// SIG-82 contract mapping (40805, 40817; approved as proposed in D65, SIG-82 40818, 2): one
// assessApplicant output (composition 1.2.0) to the contract's Assessment, AssessmentSummary and
// AffordabilityTrace (1.11.0). Figures, states and reasons are copied, never reshaped or
// rewritten; the only new value is the income's state, read from the affordability engine's own
// "no income". The embedded Enrich record, transactions, taxonomy, INC's trace and LIA's evidence
// IDs never reach a lender response: the full output stays server-side, for T3.
//
// The roll-up's reasons (D65, 40818, 1) are ordered here, on the server, in four tiers:
//   1. evidence-quality reasons with a state (they decide whether anything else can be relied on);
//   2. red movers;  3. amber movers;
//   4. evidence-quality reasons with state null (informational; they don't move the roll-up).
// Within a tier the composition's order is kept (evidence reasons in check order, then movers,
// INC before LIA). top_reasons is the first three; all_reasons the whole list.
//
// Disclosed gaps (ADR 0014): discretionary_monthly, months_covered, one_offs, excluded,
// lia_repayments_in_other_categories, unmapped and green_allowed are not mapped, and there is no
// separate list of found liabilities. reasons_to_say_yes is always [] (family 10 isn't built).
import type { Assessment as Output } from "../assessment/assess.js";
import { OBSERVED_EXPENSES_METHOD_VERSION } from "../engines/affordability/observed-expenses.js";
import { EQ_METHOD_VERSION } from "../engines/evidence/checks.js";
import { DEFINITIONS_VERSION } from "../engines/signals/definitions.js";

export type RollupReason = { signal_id: string | null; state: string | null; reason: string };
export type ContractRollup = {
  state?: "unverified";
  top_reasons: RollupReason[];
  all_reasons: RollupReason[];
  reasons_total: number;
  reasons_to_say_yes: RollupReason[];
};
export type AssessmentRecord = { id: string; applicant_id: string; version: number };
export type AssessmentRequestPart = { product_type: string; as_of: string };

/** D65's tier for one reason: 1 is the highest. */
export function reasonTier(r: RollupReason): 1 | 2 | 3 | 4 {
  if (r.signal_id === null) return r.state === null ? 4 : 1;
  if (r.state === "red") return 2;
  if (r.state === "amber") return 3;
  // rollupMovers returns amber or red only; anything else is a change upstream.
  throw new Error(`a roll-up mover in state ${String(r.state)}: not amber or red`);
}

/** The roll-up (contract Rollup, 1.11.0), its reasons in D65's order. */
export function rollupOf(out: Output): ContractRollup {
  const signals = [...out.inc.signals, ...out.lia.signals];
  const composition: RollupReason[] = [
    ...out.evidence.rollup.reasons.map((r) => ({
      signal_id: r.signal_id,
      state: r.state,
      reason: r.reason,
    })),
    ...out.rollup.movers.map((m) => {
      const s = signals.find((x) => x.id === m.id);
      if (!s) throw new Error(`roll-up mover ${m.id} has no signal`);
      return { signal_id: m.id, state: m.state, reason: s.reason };
    }),
  ];
  // A stable sort by tier: the composition's order is kept within each.
  const all = composition
    .map((r, i) => ({ r, i, t: reasonTier(r) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.r);
  return {
    ...(out.rollup.state === "unverified" ? { state: "unverified" as const } : {}),
    top_reasons: all.slice(0, 3),
    all_reasons: all,
    reasons_total: all.length,
    reasons_to_say_yes: [],
  };
}

const step = (out: Output, name: string) => out.affordability.trace.find((s) => s.step === name);

/** unverified exactly when the affordability engine had no income (40805, 2.4). */
export function monthlyIncomeState(out: Output): "observed" | "unverified" {
  const dsr = step(out, "dsr");
  if (!dsr) throw new Error("the affordability trace has no dsr step");
  const reason = (dsr.inputs as { reason?: unknown } | undefined)?.reason;
  return dsr.value === null && reason === "no income" ? "unverified" : "observed";
}

function same<T>(what: string, values: T[]): T {
  const [first] = values;
  if (first === undefined || new Set(values.map((v) => JSON.stringify(v))).size !== 1)
    throw new Error(`the engines report different ${what} versions`);
  return first;
}

/** Assessment.versions (40817, 3), copied from the output; eq_method and observed_expenses aren't
 * in the output, so they are the engines' own constants (disclosed). */
export function versionsOf(out: Output) {
  return {
    composition: out.composition_version,
    enrich: { engine_version: out.enrich.engine_version, build: out.enrich.build },
    inc: out.inc.version,
    lia: out.lia.version,
    lia_detector: out.lia.detector,
    eq_method: EQ_METHOD_VERSION,
    observed_expenses: OBSERVED_EXPENSES_METHOD_VERSION,
    gr3_gate: same("GR-3 gate", [
      out.inc.gr3_gate_version,
      out.lia.gr3_gate_version,
      out.expenses.gr3_gate_version,
    ]),
    keyword_list: same("keyword list", [
      out.inc.keyword_list_version,
      out.lia.keyword_list_version,
    ]),
    lender_names: out.lia.lender_names_version,
    thresholds: out.affordability.versions.thresholds_version,
  };
}

/** The contract's Assessment (1.11.0). */
export function toAssessment(rec: AssessmentRecord, out: Output, req: AssessmentRequestPart) {
  const a = out.affordability.affordability;
  return {
    id: rec.id,
    applicant_id: rec.applicant_id,
    version: rec.version,
    status: "complete" as const,
    status_reason: null,
    product_type: req.product_type,
    data_as_of: `${req.as_of}T00:00:00Z`,
    rollup: rollupOf(out),
    evidence_checks: out.evidence.checks,
    affordability: {
      ...a,
      serviceability: { ...a.serviceability, monthly_income_state: monthlyIncomeState(out) },
    },
    signals: [...out.inc.signals, ...out.lia.signals],
    pins: {
      definitions_version: DEFINITIONS_VERSION,
      thresholds_version: out.affordability.versions.thresholds_version,
      taxonomy_version: out.enrich.taxonomy_version,
    },
    versions: versionsOf(out),
  };
}

/** The contract's AssessmentSummary, for the applicant's list and the run's 202. */
export function toSummary(rec: AssessmentRecord, out: Output, req: AssessmentRequestPart) {
  return {
    id: rec.id,
    applicant_id: rec.applicant_id,
    version: rec.version,
    status: "complete" as const,
    rollup_state: out.rollup.state ?? null,
    data_as_of: `${req.as_of}T00:00:00Z`,
    evidence_checks: out.evidence.checks,
  };
}

const CARD = "Higher of stated repayment and 3% of limit";
const LOAN = "Higher of observed and stated repayment";
const OUTFLOW = "3-month average outflow";
/** Product Specification 6.4's rule for each liability type, by name: the rule the affordability
 * engine's commitment() applies (src/engines/affordability/index.ts). */
const RULES: Record<string, string> = {
  credit_card: CARD,
  charge_card: CARD,
  overdraft: CARD,
  personal_loan: LOAN,
  car_loan: LOAN,
  mortgage: "Repayment at the assessment rate over the remaining term, or the observed repayment",
  bnpl: OUTFLOW,
  sacc: OUTFLOW,
  wage_advance: OUTFLOW,
  declared_only: "Stated repayment",
};
export function liabilityRule(type: string): string {
  const r = RULES[type];
  if (!r) throw new Error(`no Product Specification 6.4 rule for liability type ${type}`);
  return r;
}

type Commitment = { type: string; source: "declared" | "found" | "inferred"; monthly: number };

/** The contract's AffordabilityTrace (40805, 2.6). */
export function toTrace(out: Output) {
  const gle = step(out, "gle");
  const used = (gle?.inputs as { used?: unknown } | undefined)?.used;
  // The lines below are the observed method's; any other method would need its own lines, so it is
  // refused rather than shown with lines that don't sum to its GLE.
  if (used !== "observed")
    throw new Error(`the expense method used is ${String(used)}: only observed has lines here`);
  const e = out.expenses;
  const line = (group: string, observed: number, why: string) => ({
    group,
    declared: null,
    benchmark: null,
    observed,
    used: observed,
    why,
  });
  const rep = step(out, "repayments");
  const commitments = (rep?.inputs as { commitments?: Commitment[] } | undefined)?.commitments;
  if (!commitments) throw new Error("the affordability trace has no repayments step");
  return {
    expense_method: "observed" as const,
    income: out.inc.income,
    expenses: [
      line("committed", e.committed_monthly, "observed committed (AF-E1)"),
      line("basic", e.basic_monthly, "observed basic (AF-E2)"),
      line(
        "unverified",
        e.unverified_monthly,
        "other_expenses, essential, counted as unverified (SIG-81, ADR 0013)",
      ),
    ],
    liabilities: commitments.map((c) => ({
      type: c.type,
      source: c.source,
      monthly_commitment: c.monthly,
      rule: liabilityRule(c.type),
    })),
    trace: out.affordability.trace,
    overrides: [],
  };
}
