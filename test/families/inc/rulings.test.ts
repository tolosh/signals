// SIG-41 rulings, 7 November 2026 (Colin, on ADR 0004): INC-09 and INC-12 overlap, household_earners
// (contract 1.7.0), the loan sizes as candidate workspace defaults, and N-13 kept in the family.
import { describe, expect, it } from "vitest";
import { STEADY, run, signal, stateOf } from "./script.js";
import { INC_CANDIDATES, INC_DEFAULTS } from "../../../src/engines/families/inc/index.js";
import { loadContract, schemaValidator } from "../../contract/helpers.js";

// Ruling 1 was superseded on 8 November 2026: INC-09 and INC-12 both fire, cross-referenced
// (test/families/inc/inc09-inc12.test.ts). This test now asserts the replacement.
describe("Ruling 1 (superseded 8 November): both signals fire on a missed pay", () => {
  it("one missed fortnightly pay gives INC-12 amber and INC-09 amber", () => {
    const r = run({ pays: [{ ...STEADY, skip: [8] }] });
    expect(stateOf(r, "INC-12")).toBe("amber");
    expect(stateOf(r, "INC-09")).toBe("amber");
  });
  it("a trough not explained by a flagged missed pay still counts in INC-09", () => {
    const winter = (day: number) => {
      const m = new Date(day * 86_400_000).getUTCMonth() + 1;
      return m >= 6 && m <= 8;
    };
    const r = run({
      pays: [{ ...STEADY, skip: [8], amount: (_, d) => (winter(d) ? 1000 : 3000) }],
    });
    expect(stateOf(r, "INC-09")).toBe("amber");
    expect(stateOf(r, "INC-12")).toBe("amber");
  });
});

describe("Ruling 2: household_earners", () => {
  it("absent makes INC-07 unverified with the ruled resolve_with, never green", () => {
    const s = signal(run({ pays: [STEADY] }, { loan_amount: 600_000 }), "INC-07");
    expect(s.state).toBe("unverified");
    expect(s.evidence_quality.resolve_with).toEqual([
      "Confirm how many people in the household earn an income",
    ]);
  });
  it("is in the contract at 1.7.0, on the applicant's financial position", () => {
    const doc = loadContract();
    expect(doc.info.version).toMatch(/^1\.([7-9]|\d{2,})\./);
    const validate = schemaValidator(doc)("FinancialPosition");
    const base = { assets: [], liabilities: [], repayments: [], income: [], expenses: [] };
    expect(validate({ ...base, household_earners: 2 }).valid).toBe(true);
    expect(validate({ ...base, household_earners: null }).valid).toBe(true);
    expect(validate({ ...base, household_earners: 0 }).valid).toBe(false);
  });
});

describe("Ruling 3: loan sizes are candidate workspace defaults", () => {
  it("$20,000 wage-sized and $500,000 large loan are defaults, marked as candidates", () => {
    expect(INC_DEFAULTS.wage_sized_loan_amount).toBe(20_000);
    expect(INC_DEFAULTS.large_loan_amount).toBe(500_000);
    expect(INC_CANDIDATES).toEqual(["wage_sized_loan_amount", "large_loan_amount"]);
    expect(INC_DEFAULTS.policy_loan_amount).toBeNull();
  });
  it("each lender can change them in its policy (contract 1.7.0)", () => {
    const validate = schemaValidator(loadContract())("PolicyInput");
    const policy = {
      buffer: 3,
      floor_rate: 5.5,
      income_shading: {},
      card_factor: 0.03,
      expense_method: "highest_of_confirmed_benchmark_observed",
      ratio_thresholds: {},
    };
    const signals = {
      wage_sized_loan_amount: 25_000,
      large_loan_amount: 750_000,
      policy_loan_amount: null,
    };
    expect(validate({ ...policy, income_signals: signals }).valid).toBe(true);
    expect(
      validate({ ...policy, income_signals: { ...signals, large_loan_amount: -1 } }).valid,
    ).toBe(false);
  });
  it("a lender's own large-loan size is used", () => {
    const r = run(
      { pays: [STEADY] },
      { household_earners: 1, loan_amount: 400_000 },
      { large_loan_amount: 300_000 },
    );
    expect(stateOf(r, "INC-07")).toBe("amber");
  });
});
