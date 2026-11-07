// SIG-47 section 6 tests: every living-expense method in Product Specification §6.3 (AF-E3 to
// AF-E5), selectable per policy version (§6.6; Decision Record D26). Interpretations X-1 to X-4
// are in docs/adr/0003-expense-methods.md.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeAffordability,
  DEFAULT_THRESHOLDS,
  type AffordabilityInput,
} from "../../../../src/engines/affordability/index.js";
import {
  assessExpenses,
  DEFAULT_EXPENSE_METHOD,
  EXPENSE_METHODS,
  type ExpenseMethod,
} from "../../../../src/engines/affordability/expenses.js";

const fixture = JSON.parse(readFileSync("test/fixtures/af-t1.json", "utf8")) as {
  input: AffordabilityInput;
};
const published = JSON.parse(readFileSync("test/fixtures/af-t1-assessment.json", "utf8")) as {
  affordability: unknown;
};
const withMethod = (
  expense_method: ExpenseMethod,
  over: Partial<AffordabilityInput["expenses"]> = {},
) => ({
  ...fixture.input,
  policy: { ...fixture.input.policy, expense_method },
  expenses: { ...fixture.input.expenses, ...over },
});
const run = (input: AffordabilityInput) => computeAffordability(input, DEFAULT_THRESHOLDS);
const gleOf = (input: AffordabilityInput) =>
  run(input).affordability.serviceability.monthly_expenses_gle;

// AF-T1's expense inputs: confirmed $3,000; benchmark $1,573; observed committed $1,867 + basic $1,500.
describe("T1 each method reproduces a known answer", () => {
  it.each([
    ["highest_of_confirmed_benchmark_observed", 3367],
    ["confirmed", 3000],
    ["benchmark", 1573],
    ["observed", 3367],
    ["higher_of_confirmed_benchmark", 3000],
  ] as const)("%s gives GLE $%d", (method, gle) => {
    expect(gleOf(withMethod(method))).toBe(gle);
    expect(run(withMethod(method)).affordability.status).toBe("complete");
  });

  it("covers every method the contract lists", () => {
    expect([...EXPENSE_METHODS].sort()).toEqual(
      [
        "benchmark",
        "confirmed",
        "higher_of_confirmed_benchmark",
        "highest_of_confirmed_benchmark_observed",
        "observed",
      ].sort(),
    );
  });

  it("AF-E5: rent that ends at settlement is removed from observed committed and shown as removed", () => {
    const e = assessExpenses(
      { ...fixture.input.expenses, rent_ending_at_settlement_monthly: 1200 },
      "observed",
    );
    expect(e.gle).toBe(2167);
    expect(e.rent_removed_monthly).toBe(1200);
    expect(
      gleOf(withMethod(DEFAULT_EXPENSE_METHOD, { rent_ending_at_settlement_monthly: 1200 })),
    ).toBe(3000);
  });

  it("the trace states the method used and every input", () => {
    const step = run(withMethod("benchmark")).trace.find((s) => s.step === "gle");
    expect(step?.inputs).toMatchObject({
      method: "benchmark",
      used: "benchmark",
      confirmed_monthly: 3000,
      benchmark_monthly: 1573,
      observed: 3367,
    });
  });
});

describe("T2 AF-T1 under the default method is unchanged", () => {
  it("defaults to the AF-E3 method, and the affordability block equals Build Spec 3.4", () => {
    expect(DEFAULT_EXPENSE_METHOD).toBe("highest_of_confirmed_benchmark_observed");
    expect(run(fixture.input).affordability).toStrictEqual(published.affordability);
    expect(run(withMethod(DEFAULT_EXPENSE_METHOD)).affordability).toStrictEqual(
      published.affordability,
    );
  });
});

describe("T3 a method with a missing input is unverified, never a fallback", () => {
  it("observed with no observed input is unverified with resolve_with", () => {
    const input = withMethod("observed", {
      observed_committed_monthly: null,
      observed_basic_monthly: null,
    });
    const a = run(input).affordability;
    expect(a.status).toBe("unverified");
    expect(a.resolve_with).toEqual([
      "Observed expenses are not available yet: they need expense derivation from the transactions",
    ]);
    for (const key of ["dsr", "ndi", "ara", "benchmark_gle"])
      expect(a.ratios.find((r) => r.key === key)?.state).toBe("unverified");
    // Ratios that do not use expenses are still computed.
    expect(a.ratios.find((r) => r.key === "lvr")?.state).toBe("amber");
    const step = run(input).trace.find((s) => s.step === "gle");
    expect(step?.value).toBeNull();
    expect(step?.inputs).toMatchObject({ method: "observed", used: null, missing: ["observed"] });
  });

  it.each([
    [
      "confirmed",
      { confirmed_monthly: null },
      "Ask the applicant to confirm their living expenses",
    ],
    [
      "benchmark",
      { benchmark_monthly: null },
      "Upload a benchmark table that covers this household profile",
    ],
    [
      "higher_of_confirmed_benchmark",
      { benchmark_monthly: null },
      "Upload a benchmark table that covers this household profile",
    ],
    [
      "highest_of_confirmed_benchmark_observed",
      { confirmed_monthly: null },
      "Ask the applicant to confirm their living expenses",
    ],
  ] as const)(
    "%s missing an input is unverified, not the next-best figure",
    (method, over, resolve) => {
      const a = run(withMethod(method, over)).affordability;
      expect(a.status).toBe("unverified");
      expect(a.resolve_with).toContain(resolve);
    },
  );
});

describe("T4 switching method in a new policy version changes new assessments only", () => {
  it("version 1 replays unchanged after version 2 switches to confirmed", () => {
    const v1 = withMethod("highest_of_confirmed_benchmark_observed");
    const before = JSON.stringify(run(v1));
    const v2 = withMethod("confirmed");
    expect(gleOf(v2)).toBe(3000);
    expect(JSON.stringify(run(v1))).toBe(before);
    expect(gleOf(v1)).toBe(3367);
  });
});

describe("T5 identical inputs twice give byte-identical output", () => {
  it.each([...EXPENSE_METHODS])("%s", (method) => {
    const sha = () =>
      createHash("sha256")
        .update(JSON.stringify(run(withMethod(method))))
        .digest("hex");
    expect(sha()).toBe(sha());
  });
});
