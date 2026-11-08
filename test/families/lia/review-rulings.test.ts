// SIG-42 independent review rulings (Colin, 8 November 2026), LIA 1.2.0. Each section was written
// before the change it tests:
//   ruling 2: LIA-06 is parked until Enrich supplies a private-transfer category that excludes
//             sensitive payees; its code and tests stay, behind the parked state.
import { describe, expect, it } from "vitest";
import { liaConfigFromPolicy } from "../../../src/engines/families/lia/index.js";
import { repeat, run, signal, stateOf, type Line } from "./script.js";

const privateLoan = (amount: number, n = 4): Line[] =>
  Array.from({ length: n }, (_, i) => ({
    ago: 5 + i * 30,
    description: "TRANSFER TO J SMITH LOAN REPAYMENT",
    amount: -amount,
    type: "TRANSFER_OUTGOING",
  }));
const PARKED = "Private-loan detection is not yet supported on categorised data";

describe("Ruling 2: LIA-06 is parked", () => {
  it("a scripted private loan that 1.1.0 called red is unverified, with the ruled reason", () => {
    const s = signal(run({ lines: privateLoan(800) }), "LIA-06");
    expect(s.state).toBe("unverified");
    expect(s.reason).toBe(PARKED);
    expect(s.value).toBeNull();
    expect(s.confidence).toBe("low");
  });
  it("with nothing to find, it is unverified, not none_observed", () => {
    expect(stateOf(run({}), "LIA-06")).toBe("unverified");
  });
  it("when an evidence check also caps it, the check's reason stands (E-11)", () => {
    const transfers = repeat(5, 30, {
      description: "TRANSFER TO 062-000 99998888",
      amount: -800,
      type: "TRANSFER_OUTGOING",
    });
    const s = signal(run({ lines: transfers }), "LIA-06");
    expect(s.state).toBe("unverified");
    expect(s.reason).not.toBe(PARKED);
  });
  it("a lender's policy can't unpark it", () => {
    const policy = { private_loans: "detect", private_large_monthly: 100 } as Parameters<
      typeof liaConfigFromPolicy
    >[0];
    expect(liaConfigFromPolicy(policy)).toEqual({ private_large_monthly: 100 });
  });
  it("behind the parked state, the 1.1.0 rules still run: red for a large private loan", () => {
    const r = run({ lines: privateLoan(800) }, undefined, { private_loans: "detect" });
    expect(stateOf(r, "LIA-06")).toBe("red");
  });
  it("the other five signals are unaffected", () => {
    const r = run({});
    for (const id of ["LIA-01", "LIA-02", "LIA-03", "LIA-04", "LIA-05"])
      expect(stateOf(r, id), id).toBe("none_observed");
  });
});

// Ruling 1: LIA-01 matches a declaration by type and repayment when the names differ, and is
// never red until SIG-57 (the alias table) is Supported and the assessed surplus is wired (SIG-58).
type Declared = { type: string; provider: string; repayment_monthly?: number };
const monthlyLines = (description: string, amount: number, extra: Partial<Line> = {}): Line[] =>
  repeat(6, 30, { description, amount: -amount, ...extra });
const card = (biller: string, amount = 180): Line[] =>
  monthlyLines(`BPAY ${biller} PAYMENT`, amount, { category: "transfer", billerName: biller });
const loanLines = (name: string, amount: number): Line[] =>
  monthlyLines(`${name} LOAN REPAYMENT`, amount, { category: "loan_repayment" });
const bnplLines = (name: string, amount = 45, n = 26): Line[] =>
  repeat(n, 14, { description: `${name} INSTALMENT`, amount: -amount, category: "bnpl" });
const lia01 = (lines: Line[], declared: Declared[], surplus?: number) =>
  signal(
    run(
      { lines },
      {
        declared_liabilities: declared,
        ...(surplus === undefined ? {} : { assessed_surplus_monthly: surplus }),
      },
    ),
    "LIA-01",
  );

// The reviewer's four pairs (F1), each declared one way and repaid under the other name.
const PAIRS: {
  label: string;
  lines: (name: string) => Line[];
  type: string;
  amount: number;
  names: [string, string];
}[] = [
  {
    label: "card",
    lines: (n) => card(`${n} CREDIT CARD`),
    type: "credit_card",
    amount: 180,
    names: ["Commonwealth Bank", "CBA"],
  },
  {
    label: "personal loan",
    lines: (n) => loanLines(n, 450),
    type: "personal_loan",
    amount: 450,
    names: ["Society One", "SOCIETYONE"],
  },
  {
    label: "BNPL",
    lines: (n) => bnplLines(n),
    type: "bnpl",
    amount: 97.5,
    names: ["Zip", "ZIP PAY"],
  },
  {
    label: "car loan",
    lines: (n) => loanLines(n, 560),
    type: "car_loan",
    amount: 560,
    names: ["Macquarie", "MACQUARIE LEASING"],
  },
];

describe("Ruling 1: LIA-01 amount-and-type fallback", () => {
  for (const p of PAIRS)
    for (const [declaredAs, repaidAs] of [p.names, [p.names[1], p.names[0]]] as const)
      it(`${p.label}: declared "${declaredAs}", repaid as "${repaidAs}": possibly declared, review`, () => {
        const s = lia01(p.lines(repaidAs.toUpperCase()), [
          { type: p.type, provider: declaredAs, repayment_monthly: p.amount },
        ]);
        expect(s.state).toBe("green");
        expect(s.value).toMatch(/1 possibly declared/);
        expect(s.reason).toContain(declaredAs);
        expect(s.reason).toContain(repaidAs.toUpperCase());
        expect(s.reason).toMatch(/possibly declared: review/);
        expect(s.evidence_quality.review_required).toBe(true);
      });

  it("an amount outside 15% of the declared repayment stays undisclosed", () => {
    const s = lia01(card("CBA CREDIT CARD", 250), [
      { type: "credit_card", provider: "Commonwealth Bank", repayment_monthly: 180 },
    ]);
    expect(s.state).toBe("amber");
    expect(s.value).toBe("1 undisclosed");
  });
  it("an amount just inside 15% matches", () => {
    const s = lia01(card("CBA CREDIT CARD", 207), [
      { type: "credit_card", provider: "Commonwealth Bank", repayment_monthly: 180 },
    ]);
    expect(s.state).toBe("green");
  });
  it("a type mismatch stays undisclosed, whatever the amount", () => {
    const s = lia01(card("CBA CREDIT CARD"), [
      { type: "personal_loan", provider: "Commonwealth Bank", repayment_monthly: 180 },
    ]);
    expect(s.state).toBe("amber");
    expect(s.value).toBe("1 undisclosed");
  });
  it("a declaration with no repayment amount can't match by amount", () => {
    const s = lia01(card("CBA CREDIT CARD"), [
      { type: "credit_card", provider: "Commonwealth Bank" },
    ]);
    expect(s.state).toBe("amber");
  });
  it("one declaration matches one liability: a second card at the same amount stays undisclosed", () => {
    const s = lia01(
      [...card("CBA CREDIT CARD"), ...card("WESTPAC CREDIT CARD")],
      [{ type: "credit_card", provider: "Commonwealth Bank", repayment_monthly: 180 }],
    );
    expect(s.state).toBe("amber");
    expect(s.value).toBe("1 undisclosed, 1 possibly declared");
  });
  it("an exact name match keeps its declaration: it isn't spent on a fallback", () => {
    const s = lia01(
      [...card("CBA CREDIT CARD"), ...card("NAB CREDIT CARD")],
      [{ type: "credit_card", provider: "CBA", repayment_monthly: 180 }],
    );
    expect(s.state).toBe("amber");
    expect(s.value).toBe("1 undisclosed");
    expect(s.reason).toContain("NAB");
  });
});

describe("Ruling 1: LIA-01 is never red until SIG-57 is Supported and SIG-58 is wired", () => {
  it("an undisclosed loan that would take the surplus below zero is amber", () => {
    const s = lia01(loanLines("SOCIETYONE", 450), [], 300);
    expect(s.state).toBe("amber");
  });
  it("the review's case: a misnamed, declared card with a $100 surplus is not red, and not amber", () => {
    const s = lia01(
      card("CBA CREDIT CARD"),
      [{ type: "credit_card", provider: "Commonwealth Bank", repayment_monthly: 180 }],
      100,
    );
    expect(s.state).toBe("green");
  });
});

describe("Ruling 1: T2 and T7 with natural-form declarations", () => {
  it('T2: a disclosed car loan declared as "Macquarie", repaid as MACQUARIE LEASING, isn\'t flagged', () => {
    const s = lia01(loanLines("MACQUARIE LEASING", 560), [
      { type: "car_loan", provider: "Macquarie", repayment_monthly: 560 },
    ]);
    expect(["amber", "red"]).not.toContain(s.state);
  });
  it("T7: only disclosed, on-time credit, every declaration in natural form: no amber or red", () => {
    const r = run(
      {
        lines: [
          ...loanLines("SOCIETYONE", 450),
          ...card("CBA CREDIT CARD"),
          ...bnplLines("AFTERPAY", 60),
        ],
      },
      {
        declared_liabilities: [
          { type: "personal_loan", provider: "Society One Pty Ltd", repayment_monthly: 450 },
          { type: "credit_card", provider: "Commonwealth Bank", repayment_monthly: 180 },
          { type: "bnpl", provider: "Afterpay Pty Ltd", repayment_monthly: 130 },
        ],
        assessed_surplus_monthly: 2000,
      },
    );
    for (const id of ["LIA-01", "LIA-02", "LIA-03", "LIA-04", "LIA-05", "LIA-06"])
      expect(["amber", "red"], id).not.toContain(stateOf(r, id));
  });
});

// Ruling 3: findings show; absence needs history (EQ method 4, through EQ-R4).
describe("Ruling 3: on a 3-month history at a 3-month request", () => {
  const short = (lines: Line[]) => run({ months: 3, lines }, undefined, {}, 3);
  it("an undisclosed card shows LIA-01 amber", () => {
    expect(
      stateOf(
        short(
          repeat(3, 30, {
            description: "BPAY NAB CREDIT CARD PAYMENT",
            amount: -180,
            category: "transfer",
            billerName: "NAB CREDIT CARD",
          }),
        ),
        "LIA-01",
      ),
    ).toBe("amber");
  });
  it("recent SACC repayments show LIA-03 red", () => {
    expect(
      stateOf(
        short(
          repeat(4, 14, {
            description: "CASH CONVERTERS LOAN REPAYMENT",
            amount: -95,
            category: "sacc_loan",
          }),
        ),
        "LIA-03",
      ),
    ).toBe("red");
  });
  it("with nothing found, LIA-01 to LIA-05 stay unverified, not none_observed", () => {
    const r = short([]);
    for (const id of ["LIA-01", "LIA-02", "LIA-03", "LIA-04", "LIA-05"])
      expect(stateOf(r, id), id).toBe("unverified");
  });
  it("at a 6-month request, EQ-03 still caps the same card", () => {
    const r = run({
      months: 3,
      lines: repeat(3, 30, {
        description: "BPAY NAB CREDIT CARD PAYMENT",
        amount: -180,
        category: "transfer",
        billerName: "NAB CREDIT CARD",
      }),
    });
    expect(stateOf(r, "LIA-01")).toBe("unverified");
  });
});
