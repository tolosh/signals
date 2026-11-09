// SIG-42 short re-review at 11e2ef4, ruling and direction (Colin, 8 November 2026, 19:40), LIA 1.3.0.
// Written before the change it tests:
//   1. "possibly declared" is amber, never green, with the ruled reason; strict matching: exact
//      types only, closest amount first, one-to-one, duplicate declarations removed. Every review
//      probe is a case here.
//   5. LIA reads within the requested lookback (LIA-03 keeps its 12 months); LIA-05's "rising" needs
//      both 90-day windows inside it.
//   7. Text is normalised to NFC before keyword matching.
import { describe, expect, it } from "vitest";
import { build, repeat, run, signal, stateOf, AS_OF, type Line } from "./script.js";
import { assessLia, LIA_VERSION } from "../../../src/engines/families/lia/index.js";
import { dayOf, isoOf } from "../../../src/engines/evidence/dates.js";

type Declared = { type: string; provider: string; repayment_monthly?: number };
const monthly = (description: string, amount: number, extra: Partial<Line> = {}): Line[] =>
  repeat(6, 30, { description, amount: -amount, ...extra });
/** A card repaid by BPAY: the biller names the card, the narrative carries a reference. */
const card = (issuer: string, amount: number): Line[] =>
  monthly(`BPAY ${issuer} CREDIT CARD 4417`, amount, {
    category: "transfer",
    billerName: `${issuer} CREDIT CARD`,
  });
const loan = (narrative: string, amount: number): Line[] =>
  monthly(`${narrative} 88123`, amount, { category: "loan_repayment" });
const bnpl = (lender: string, amount: number): Line[] =>
  repeat(26, 14, { description: `${lender} INSTALMENT`, amount: -amount, category: "bnpl" });
const lia01 = (lines: Line[], declared: Declared[]) =>
  signal(run({ lines }, { declared_liabilities: declared }), "LIA-01");
const POSSIBLY = (name: string, amount: number) =>
  `Possibly the declared ${name} ($${amount} a month): confirm with the applicant`;

describe("1. Possibly declared is amber, with the ruled reason and review", () => {
  it("a misnamed card of the same type and amount is amber, not green", () => {
    const s = lia01(card("CBA", 180), [
      { type: "credit_card", provider: "Commonwealth Bank", repayment_monthly: 180 },
    ]);
    expect(s.state).toBe("amber");
    expect(s.value).toBe("1 possibly declared");
    expect(s.reason).toContain(POSSIBLY("Commonwealth Bank", 180));
    expect(s.evidence_quality.review_required).toBe(true);
  });
  it("only an exact name match is green", () => {
    const s = lia01(card("CBA", 180), [
      { type: "credit_card", provider: "CBA", repayment_monthly: 180 },
    ]);
    expect(s.state).toBe("green");
    expect(s.value).toBe("1 found, all declared");
  });
});

describe("1. The review's probes: no undisclosed liability is green through the fallback", () => {
  it("card: a declared CBA card at $300, not in the data, can't hide an undisclosed Citi card at $290 as green", () => {
    const s = lia01(card("CITI", 290), [
      { type: "credit_card", provider: "CBA", repayment_monthly: 300 },
    ]);
    expect(s.state).toBe("amber");
    expect(s.reason).toContain(POSSIBLY("CBA", 300));
  });
  it("merged types: a declared car loan at $560 doesn't absorb an undisclosed personal loan at $600", () => {
    const s = lia01(loan("HARMONEY PERSONAL LOAN", 600), [
      { type: "car_loan", provider: "Macquarie", repayment_monthly: 560 },
    ]);
    expect(s.state).toBe("amber");
    expect(s.value).toBe("1 undisclosed");
    expect(s.reason).not.toContain("Possibly");
  });
  it("a loan whose type the data doesn't show matches no typed declaration", () => {
    const s = lia01(loan("HARMONEY LOAN", 560), [
      { type: "car_loan", provider: "Macquarie", repayment_monthly: 560 },
    ]);
    expect(s.value).toBe("1 undisclosed");
  });
  it("large amounts: a declared $2,000 loan can't make an undisclosed $2,290 loan green", () => {
    const s = lia01(loan("HARMONEY PERSONAL LOAN", 2290), [
      { type: "personal_loan", provider: "Plenti", repayment_monthly: 2000 },
    ]);
    expect(s.state).toBe("amber");
  });
  it("single BNPL: an absorbed BNPL still leaves LIA-01 amber", () => {
    const r = run(
      { lines: bnpl("ZIP", 60) },
      { declared_liabilities: [{ type: "bnpl", provider: "Afterpay", repayment_monthly: 130 }] },
    );
    expect(stateOf(r, "LIA-01")).toBe("amber");
    expect(signal(r, "LIA-01").value).toBe("1 possibly declared");
  });
  it("closest amount, not alphabetical: the declared Westpac card pairs with WBC, and AMEX stays undisclosed", () => {
    const s = lia01(
      [...card("AMEX", 225), ...card("WBC", 200)],
      [{ type: "credit_card", provider: "Westpac", repayment_monthly: 200 }],
    );
    expect(s.state).toBe("amber");
    expect(s.value).toBe("1 undisclosed, 1 possibly declared");
    expect(s.reason).toContain(`WBC (credit card, $200 a month). ${POSSIBLY("Westpac", 200)}`);
    expect(s.reason).toMatch(/AMEX \(credit card, \$225 a month\)[^.]*not in the application/);
    expect(s.evidence_quality.resolve_with).toContain(
      "The applicant's confirmation of the AMEX credit card, added to the application",
    );
  });
  it("labels don't swap when the order is reversed", () => {
    const s = lia01(
      [...card("WBC", 200), ...card("AMEX", 225)],
      [{ type: "credit_card", provider: "Westpac", repayment_monthly: 200 }],
    );
    expect(s.reason).toContain(`WBC (credit card, $200 a month). ${POSSIBLY("Westpac", 200)}`);
    expect(s.reason).toMatch(/AMEX \(credit card, \$225 a month\)[^.]*not in the application/);
  });
  it("duplicates: a declaration entered twice absorbs once", () => {
    const westpac = { type: "credit_card", provider: "Westpac", repayment_monthly: 200 };
    const s = lia01(
      [...card("WBC", 200), ...card("AMEX", 205)],
      [westpac, { ...westpac, provider: "WESTPAC " }],
    );
    expect(s.value).toBe("1 undisclosed, 1 possibly declared");
  });
  it("two different declarations of the same type each pair with their closest", () => {
    const s = lia01(
      [...card("AMEX", 225), ...card("WBC", 200)],
      [
        { type: "credit_card", provider: "Westpac", repayment_monthly: 200 },
        { type: "credit_card", provider: "American Express", repayment_monthly: 230 },
      ],
    );
    expect(s.value).toBe("2 possibly declared");
    expect(s.reason).toContain(`WBC (credit card, $200 a month). ${POSSIBLY("Westpac", 200)}`);
    expect(s.reason).toContain(
      `AMEX (credit card, $225 a month). ${POSSIBLY("American Express", 230)}`,
    );
  });

  // A sweep over amounts, types and orders: whenever a liability found isn't declared under its
  // exact name, LIA-01 is never green.
  const TYPES: [string, (amount: number) => Line[]][] = [
    ["credit_card", (a) => card("CITI", a)],
    ["personal_loan", (a) => loan("HARMONEY PERSONAL LOAN", a)],
    ["car_loan", (a) => loan("FIRSTMAC CAR LOAN", a)],
    ["bnpl", (a) => bnpl("ZIP", (a * 12) / 26)],
  ];
  const cases = TYPES.flatMap(([foundType, lines]) =>
    TYPES.flatMap(([declaredType]) =>
      [100, 290, 600, 2290].flatMap((found) =>
        [0.8, 0.9, 1, 1.1, 1.2].map((ratio) => ({ foundType, declaredType, found, ratio, lines })),
      ),
    ),
  );
  it(`never green with nothing declared under its name (${cases.length} cases)`, () => {
    const green: string[] = [];
    for (const c of cases) {
      const s = lia01(c.lines(c.found), [
        {
          type: c.declaredType,
          provider: "Some Other Lender",
          repayment_monthly: Math.round(c.found * c.ratio),
        },
      ]);
      if (s.state === "green" || s.state === "none_observed")
        green.push(`${c.foundType} $${c.found} vs ${c.declaredType} x${c.ratio}: ${s.state}`);
    }
    expect(green).toEqual([]);
  });
});

describe("5. LIA reads within the requested lookback", () => {
  it("a card repaid only 7 to 11 months ago is not found at a 6-month request", () => {
    const lines = repeat(
      5,
      30,
      {
        description: "BPAY NAB CREDIT CARD 4417",
        amount: -180,
        category: "transfer",
        billerName: "NAB CREDIT CARD",
      },
      215,
    );
    const r = run({ lines });
    expect(stateOf(r, "LIA-01")).toBe("none_observed");
    expect(r.liabilities).toEqual([]);
  });
  it("the same card is found at a 12-month request", () => {
    const lines = repeat(
      5,
      30,
      {
        description: "BPAY NAB CREDIT CARD 4417",
        amount: -180,
        category: "transfer",
        billerName: "NAB CREDIT CARD",
      },
      215,
    );
    expect(stateOf(run({ lines }, undefined, {}, 12), "LIA-01")).toBe("amber");
  });
  it("LIA-03 keeps its 12 months: SACC repaid 9 months ago is still amber at a 3-month request", () => {
    const lines = repeat(
      4,
      14,
      {
        description: "CASH CONVERTERS LOAN REPAYMENT",
        amount: -95,
        category: "sacc_loan",
      },
      270,
    );
    expect(stateOf(run({ lines }, undefined, {}, 3), "LIA-03")).toBe("amber");
  });
  it("the reviewer's grocery line: one line 200 days old doesn't let a 3-month request judge rising", () => {
    // syn-v1-0285's BNPL pattern on a 3-month history, plus a single grocery line 200 days old.
    const lines = repeat(
      7,
      14,
      { description: "ZIP PAY INSTALMENT", amount: -60, category: "bnpl" },
      6,
    );
    const { feed, categories } = build({ months: 3, lines });
    const pay = feed.accounts[0]!;
    pay.transactions.unshift({
      accountId: "acc-pay",
      transactionId: "t-grocery-200",
      type: "PAYMENT",
      description: "WOOLWORTHS 1123 SYDNEY",
      postingDateTime: `${isoOf(dayOf(AS_OF) - 200)}T02:00:00Z`,
      amount: "-60.00",
    });
    categories["t-grocery-200"] = "groceries";
    const r = assessLia({
      feed,
      feed_type: "cdr",
      as_of: AS_OF,
      lookback_months: 3,
      categories,
      application: { declared_liabilities: [] },
    });
    const s = signal(r, "LIA-05");
    expect(s.state).not.toBe("red");
    expect(s.reason).not.toMatch(/up from/);
  });
  it("on a 12-month history, a rise is judged at a 6-month request but not at a 3-month one", () => {
    const lines = [
      ...repeat(6, 14, { description: "AFTERPAY INSTALMENT", amount: -40, category: "bnpl" }, 100),
      ...repeat(6, 14, { description: "AFTERPAY INSTALMENT", amount: -120, category: "bnpl" }),
    ];
    expect(stateOf(run({ lines }, undefined, {}, 6), "LIA-05")).toBe("red");
    expect(stateOf(run({ lines }, undefined, {}, 3), "LIA-05")).not.toBe("red");
  });
});

describe("7. NFC before keyword matching", () => {
  const credit = (description: string): Line[] => [{ ago: 20, description, amount: 5000 }];
  it("a combining accent is part of the letter: JOSE + U+0301 + LOAN is not a disbursement", () => {
    const word = "JOSÉLOAN";
    expect(word).not.toBe(word.normalize("NFC"));
    expect(stateOf(run({ lines: credit(`${word} REFUND`) }), "LIA-02")).toBe("none_observed");
  });
  it("and JOSE + U+0301, a space, then LOAN still matches", () => {
    expect(stateOf(run({ lines: credit("JOSÉ LOAN") }), "LIA-02")).toBe("amber");
  });
});

describe("Version", () => {
  it("is LIA 1.3.1", () => expect(LIA_VERSION).toBe("1.3.1"));
});
