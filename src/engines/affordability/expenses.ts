// Living expenses, every method in Product Specification §6.3 (AF-E3 to AF-E5), selected per
// workspace and product in the policy version (§6.6; Decision Record D26, SIG-47). A method whose
// input is missing returns no figure, with what would resolve it; it never substitutes another
// method. Interpretations X-1 to X-4 are in docs/adr/0003-expense-methods.md. Pure (D3).

export const EXPENSE_METHODS = [
  "highest_of_confirmed_benchmark_observed",
  "confirmed",
  "benchmark",
  "observed",
  "higher_of_confirmed_benchmark",
] as const;
export type ExpenseMethod = (typeof EXPENSE_METHODS)[number];
/** AF-E3: the higher of applicant-confirmed, benchmark, and observed committed plus basic. */
export const DEFAULT_EXPENSE_METHOD: ExpenseMethod = "highest_of_confirmed_benchmark_observed";

export type ExpenseInput = {
  /** Applicant-confirmed monthly living expenses (FR-C9). */
  confirmed_monthly: number | null;
  /** The benchmark for the household profile (AF-E4). */
  benchmark_monthly: number | null;
  /** Observed monthly averages (AF-E1, AF-E2), from expense derivation (SIG-17, SIG-43). */
  observed_committed_monthly: number | null;
  observed_basic_monthly: number | null;
  /** AF-E5: rent stated in the application as ending at settlement. */
  rent_ending_at_settlement_monthly?: number | null;
};

type Source = "confirmed" | "benchmark" | "observed";
const NEEDS: Record<ExpenseMethod, Source[]> = {
  highest_of_confirmed_benchmark_observed: ["confirmed", "benchmark", "observed"],
  confirmed: ["confirmed"],
  benchmark: ["benchmark"],
  observed: ["observed"],
  higher_of_confirmed_benchmark: ["confirmed", "benchmark"],
};
const RESOLVE: Record<Source, string> = {
  confirmed: "Ask the applicant to confirm their living expenses",
  benchmark: "Upload a benchmark table that covers this household profile",
  observed:
    "Observed expenses are not available yet: they need expense derivation from the transactions",
};

export type ExpenseAssessment = {
  method: ExpenseMethod;
  /** The assessed monthly living expenses (GLE), or null when the method's inputs are missing. */
  gle: number | null;
  /** Which source the figure came from; for a "higher of" method, the one that was highest. */
  used: Source | null;
  confirmed_monthly: number | null;
  benchmark_monthly: number | null;
  observed: number | null;
  rent_removed_monthly: number;
  missing: Source[];
  resolve_with: string[];
};

export function assessExpenses(
  input: ExpenseInput,
  method: ExpenseMethod = DEFAULT_EXPENSE_METHOD,
): ExpenseAssessment {
  if (!EXPENSE_METHODS.includes(method))
    throw new Error(`Unknown expense method ${String(method)}`);
  // AF-E5 (X-3): rent ending at settlement comes off observed committed, and is shown as removed.
  const rent = input.rent_ending_at_settlement_monthly ?? 0;
  const observed =
    input.observed_committed_monthly == null || input.observed_basic_monthly == null
      ? null
      : Math.max(input.observed_committed_monthly - rent, 0) + input.observed_basic_monthly;
  const figures: Record<Source, number | null> = {
    confirmed: input.confirmed_monthly,
    benchmark: input.benchmark_monthly,
    observed,
  };
  const needs = NEEDS[method];
  // X-2: a method needs every input it names; a missing one is never replaced by another.
  const missing = needs.filter((s) => figures[s] == null);
  const base = {
    method,
    confirmed_monthly: input.confirmed_monthly,
    benchmark_monthly: input.benchmark_monthly,
    observed,
    rent_removed_monthly: observed == null ? 0 : rent,
    missing,
  };
  if (missing.length > 0)
    return { ...base, gle: null, used: null, resolve_with: missing.map((s) => RESOLVE[s]) };
  // Ties go to the first source in the method's order, so the result is deterministic.
  let used: Source = needs[0] ?? "confirmed";
  for (const s of needs) if ((figures[s] ?? 0) > (figures[used] ?? 0)) used = s;
  return { ...base, gle: figures[used] ?? null, used, resolve_with: [] };
}
