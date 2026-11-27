// SIG-81: observed expenses 1.2.0's result in 1.1.1's shape, for tests whose baselines were taken
// at 1.1.1 (the GR-3 gate replay, SIG-64's and SIG-74's "unchanged" checks). With no LIA
// repayments given, 1.2.0 differs from 1.1.1 only by rule 1: other_expenses is the unverified line
// (and above the one-off threshold, a one-off) instead of discretionary. This puts it back, so a
// 1.1.1 baseline still proves nothing else moved. A result built with LIA repayments isn't
// convertible, and is refused.
import type { ObservedExpenses } from "../../../src/engines/affordability/observed-expenses.js";

const round2 = (x: number) => Math.round(x * 100) / 100;

export function asV111(o: ObservedExpenses): Record<string, unknown> {
  if (o.lia_repayments_in_other_categories !== 0)
    throw new Error("a result with LIA repayments excluded has no 1.1.1 equivalent");
  const months = o.months_covered;
  const folded = o.one_offs.filter((x) => x.category === "other_expenses");
  const foldedMonthly = months > 0 ? folded.reduce((sum, x) => sum + x.amount, 0) / months : 0;
  // 1.1.1's fields, in 1.1.1's order.
  return {
    gr3_gate_version: o.gr3_gate_version,
    committed_monthly: o.committed_monthly,
    basic_monthly: o.basic_monthly,
    discretionary_monthly: round2(o.discretionary_monthly + o.unverified_monthly + foldedMonthly),
    living_monthly: round2(o.committed_monthly + o.basic_monthly),
    months_covered: o.months_covered,
    one_offs: o.one_offs.filter((x) => x.category !== "other_expenses"),
    excluded: o.excluded,
    unmapped: o.unmapped,
  };
}
