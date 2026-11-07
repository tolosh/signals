// SIG-39 follow-up: rulings of 7 November 2026 (Decision Record D22 and D23; comment on SIG-39).
// D22: EQ-03 is judged against the lookback the lender requested (default 6, minimum 3 months).
// D23 (E-2): EQ-02 fails at 3 or more months and 5% or more of observed income ($250 floor).
import { describe, expect, it } from "vitest";
import {
  applyEvidence,
  assessEvidence,
  evidenceRollup,
  type EvidenceCheck,
} from "../../../src/engines/evidence/index.js";
import { FULL, INC_01, INC_09, applicant, input, truncate } from "./helpers.js";

const eq = (checks: EvidenceCheck[], id: string) => checks.find((c) => c.id === id)?.result;

describe("D22 EQ-03 measures against the requested lookback", () => {
  const threeMonths = applicant({ ...FULL, history_months: 3 }, "sig39-d22");

  it("a lender who requests 3 months and gets 3 passes EQ-03, and is not unverified", () => {
    const ctx = assessEvidence(input(threeMonths, 3));
    expect(eq(ctx.checks, "EQ-03")).toBe("pass");
    expect(ctx.checks.find((c) => c.id === "EQ-03")?.detail).toMatch(/3-month lookback/);
    expect(evidenceRollup(ctx).state).toBeNull();
  });

  it("a shortfall against the requested window still fails: 6 requested, 3 returned", () => {
    const ctx = assessEvidence(input(threeMonths, 6));
    expect(eq(ctx.checks, "EQ-03")).toBe("fail");
    expect(evidenceRollup(ctx).state).toBe("unverified");
  });

  it("the default request is 6 months", () => {
    const rest = { ...input(threeMonths) };
    delete rest.lookback_months;
    expect(assessEvidence(rest).lookback_months).toBe(6);
    expect(eq(assessEvidence(rest).checks, "EQ-03")).toBe("fail");
  });

  it("a request under 3 months is refused", () => {
    expect(() => assessEvidence(input(threeMonths, 2))).toThrow(/at least 3 months/);
  });

  it("signals keep their own minimum history (EQ-R4): a 12-month signal stays unverified", () => {
    const ctx = assessEvidence(input(threeMonths, 3));
    const [inc09] = applyEvidence([INC_09], ctx);
    expect(inc09?.state).toBe("unverified");
    expect(inc09?.evidence_quality.resolve_with).toEqual([
      "Share 12 months of transaction history",
    ]);
  });

  it("a 6-month signal on a 3-month request is unverified too, asking for 6 months", () => {
    const [inc01] = applyEvidence([INC_01], assessEvidence(input(threeMonths, 3)));
    expect(inc01?.state).toBe("unverified");
    expect(inc01?.evidence_quality.resolve_with).toEqual(["Share 6 months of transaction history"]);
  });
});

describe("D23 (E-2) EQ-02 fails only at 3 or more months", () => {
  const lowIncome = {
    ...FULL,
    income: { cadence: "monthly" as const, net_per_pay: 3600, gross_annual: 52000 },
    coverage: { salary_account_shared: true, unshared_transfer_accounts: 1 },
  };

  it("material transfers in 3 or more months fail", () => {
    const ctx = assessEvidence(input(applicant(lowIncome, "sig39-d23"), 6));
    expect(eq(ctx.checks, "EQ-02")).toBe("fail");
  });

  it("the same transfers seen in only 2 calendar months are partial, not fail", () => {
    // Keep the last 2 calendar months of a 6-month history; the lookback is the minimum, 3.
    const a = truncate(applicant(lowIncome, "sig39-d23"), "2026-09-01");
    const ctx = assessEvidence(input(a, 3));
    expect(eq(ctx.checks, "EQ-02")).toBe("partial");
  });
});
