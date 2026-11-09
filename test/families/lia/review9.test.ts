// SIG-42 review 9 (16:47) and Colin's rulings of 9 November 2026 (20:29), LIA 1.3.1. Written before
// the change it tests:
//   1. The exact-name path needs the exact type too. A right name with the wrong type is amber,
//      "Possibly the declared <name> (<amount>): confirm with the applicant"; a declaration typed
//      `mortgage` can exact-match a mortgage.
//   2. Names compare after NFC and case folding, with Pty Ltd, Ltd, Limited and every digit
//      stripped. An exact name needs at least 3 letters; an empty or punctuation-only name is never
//      exact. Diacritics stay letters: ZÖP and Zíp don't collide.
//   3. D29: every liability reason names only the lender, never the rest of the narrative.
import { describe, expect, it } from "vitest";
import { LIA_VERSION } from "../../../src/engines/families/lia/index.js";
import { repeat, run, signal, type Line } from "./script.js";

type Declared = { type: string; provider: string; repayment_monthly?: number };
const monthly = (description: string, amount: number, extra: Partial<Line> = {}): Line[] =>
  repeat(6, 30, { description, amount: -amount, ...extra });
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

describe("ruling 1: green needs the exact name and the exact type", () => {
  it("a right name with the wrong type is amber, possibly declared, with review", () => {
    const s = lia01(loan("HARMONEY PERSONAL LOAN", 450), [
      { type: "car_loan", provider: "Harmoney", repayment_monthly: 450 },
    ]);
    expect(s.state).toBe("amber");
    expect(s.value).toBe("1 possibly declared");
    expect(s.reason).toContain(POSSIBLY("Harmoney", 450));
    expect(s.evidence_quality.review_required).toBe(true);
  });
  it("the right name with the wrong type is still amber when the amounts differ widely", () => {
    const s = lia01(loan("HARMONEY PERSONAL LOAN", 450), [
      { type: "car_loan", provider: "Harmoney", repayment_monthly: 900 },
    ]);
    expect(s.state).toBe("amber");
    expect(s.reason).toContain(POSSIBLY("Harmoney", 900));
  });
  it("the right name and the exact type is green", () => {
    const s = lia01(loan("HARMONEY PERSONAL LOAN", 450), [
      { type: "personal_loan", provider: "Harmoney", repayment_monthly: 450 },
    ]);
    expect(s.state).toBe("green");
    expect(s.value).toBe("1 found, all declared");
  });
  it("an untyped loan declared as a car loan is amber (the review's 140 leaks)", () => {
    const s = lia01(loan("FIRSTMAC LOAN", 520), [
      { type: "car_loan", provider: "Firstmac", repayment_monthly: 520 },
    ]);
    expect(s.state).toBe("amber");
    expect(s.reason).toContain(POSSIBLY("Firstmac", 520));
  });
  it("a mortgage declared as a personal loan is amber", () => {
    const s = lia01(loan("CBA HOME LOAN", 2100), [
      { type: "personal_loan", provider: "CBA", repayment_monthly: 2100 },
    ]);
    expect(s.state).toBe("amber");
  });
  it("a declaration typed mortgage exact-matches a mortgage", () => {
    for (const narrative of ["CBA HOME LOAN", "CBA MORTGAGE"]) {
      const s = lia01(loan(narrative, 2100), [
        { type: "mortgage", provider: "CBA", repayment_monthly: 2100 },
      ]);
      expect(s.state, narrative).toBe("green");
    }
  });
  it("a card declared as a BNPL is amber, a card declared as a card green", () => {
    expect(
      lia01(card("CITI", 180), [{ type: "bnpl", provider: "Citi", repayment_monthly: 180 }]).state,
    ).toBe("amber");
    expect(
      lia01(card("CITI", 180), [{ type: "credit_card", provider: "Citi", repayment_monthly: 180 }])
        .state,
    ).toBe("green");
  });
  it("one declaration matches one liability: a second, undeclared one stays undisclosed", () => {
    const s = lia01(
      [...loan("HARMONEY PERSONAL LOAN", 450), ...loan("HARMONEY CAR LOAN", 610)],
      [{ type: "personal_loan", provider: "Harmoney", repayment_monthly: 450 }],
    );
    expect(s.state).toBe("amber");
    expect(s.value).toMatch(/1 (undisclosed|possibly declared)/);
  });
});

describe("ruling 1: a liability in the grant, repaid from the everyday account", () => {
  // Found on the set v1 re-run: the name comes from the card or loan account and the repayment
  // narratives, never from the transaction account the repayments leave.
  const accounts = [
    {
      accountId: "acc-card",
      productCategory: "CRED_AND_CHRG_CARDS",
      productName: "ANZ Credit Card",
    },
    {
      accountId: "acc-loan",
      productCategory: "PERS_LOANS",
      productName: "MACQUARIE LEASING car loan",
    },
  ];
  const lines = [
    ...repeat(6, 30, {
      description: "BPAY ANZ CREDIT CARD PAYMENT",
      amount: -180,
      category: "transfer",
      billerName: "ANZ CREDIT CARD",
    }),
    ...repeat(6, 30, {
      description: "MACQUARIE LEASING LOAN REPAYMENT",
      amount: -563.33,
      category: "loan_repayment",
    }),
  ];
  it("is green when declared under its name and type", () => {
    const s = signal(
      run(
        { lines, accounts, payProductName: "Everyday Account" },
        {
          declared_liabilities: [
            { type: "credit_card", provider: "ANZ", repayment_monthly: 180 },
            { type: "car_loan", provider: "MACQUARIE LEASING", repayment_monthly: 563.33 },
          ],
        },
      ),
      "LIA-01",
    );
    expect(s.state).toBe("green");
    expect(s.value).toBe("2 found, all declared");
  });
});

describe("ruling 2: names compare after NFC, case folding, legal suffixes and digits", () => {
  it.each([
    ["MACQUARIE 37 PERSONAL LOAN", "Macquarie"],
    ["MACQUARIE PERSONAL LOAN", "Macquarie 37"],
    ["MACQUARIE PERSONAL LOAN", "Macquarie Pty Ltd"],
    ["MACQUARIE PERSONAL LOAN", "MACQUARIE LIMITED"],
    ["MACQUARIE LTD PERSONAL LOAN", "macquarie"],
  ])("%j and the declared %j are the same name: green", (narrative, declared) => {
    const s = lia01(loan(narrative, 300), [
      { type: "personal_loan", provider: declared, repayment_monthly: 300 },
    ]);
    expect(s.state).toBe("green");
  });
  it("a card from Citi Pty Ltd is declared Citi", () => {
    const s = lia01(card("CITI PTY LTD", 210), [
      { type: "credit_card", provider: "Citi", repayment_monthly: 210 },
    ]);
    expect(s.state).toBe("green");
  });
  it("case folds, but diacritics stay letters: ZÖP is not Zíp", () => {
    expect(
      lia01(bnpl("ZÖP", 40), [{ type: "bnpl", provider: "zöp", repayment_monthly: 87 }]).state,
    ).toBe("green");
    expect(
      lia01(bnpl("ZÖP", 40), [{ type: "bnpl", provider: "Zíp", repayment_monthly: 87 }]).state,
    ).not.toBe("green");
  });
  it("a composed and a decomposed accent are the same name (NFC)", () => {
    const s = lia01(bnpl("ZÖP", 40), [{ type: "bnpl", provider: "ZÖP", repayment_monthly: 87 }]);
    expect(s.state).toBe("green");
  });
  it("a name of fewer than 3 letters is never exact", () => {
    const s = lia01(card("AB", 210), [
      { type: "credit_card", provider: "AB", repayment_monthly: 210 },
    ]);
    expect(s.state).not.toBe("green");
  });
  it("an empty or punctuation-only name is never exact", () => {
    for (const provider of ["", "-", "--", " . "]) {
      const s = lia01(loan("- PERSONAL LOAN", 300), [
        { type: "personal_loan", provider, repayment_monthly: 300 },
      ]);
      expect(s.state, JSON.stringify(provider)).not.toBe("green");
    }
  });
  it("any other difference goes to the fuzzy path: SOCIETYONE is not Society One", () => {
    const s = lia01(loan("SOCIETYONE PERSONAL LOAN", 450), [
      { type: "personal_loan", provider: "Society One", repayment_monthly: 450 },
    ]);
    expect(s.state).toBe("amber");
    expect(s.reason).toContain(POSSIBLY("Society One", 450));
  });
});

describe("ruling 3 (D29): liability reasons name only the lender", () => {
  const all = (r: ReturnType<typeof run>) => JSON.stringify(r).toUpperCase();
  it.each([
    ["a loan", loan("MACQUARIE IVF CLINIC REF", 300), "MACQUARIE", /IVF|CLINIC/],
    [
      "a SACC",
      repeat(6, 14, {
        description: "NIMBLE REPAY ONCOLOGY BILL",
        amount: -95,
        category: "sacc_loan",
      }),
      "NIMBLE",
      /ONCOLOGY|BILL/,
    ],
    [
      "a wage advance",
      [
        ...repeat(6, 14, { description: "BEFOREPAY PSYCH APPT", amount: 200 }, 6),
        ...repeat(6, 14, {
          description: "BEFOREPAY PSYCH APPT",
          amount: -210,
          category: "wage_advance",
        }),
      ],
      "BEFOREPAY",
      /PSYCH|APPT/,
    ],
    [
      "a disbursement",
      [{ ago: 30, description: "HARMONEY IVF LOAN 55121", amount: 5000 }],
      "HARMONEY",
      /IVF/,
    ],
    ["a BNPL", bnpl("HUMM SMILE DENTAL", 45), "HUMM", /SMILE|DENTAL/],
    ["a card", card("WESTPAC GP CLINIC", 120), "WESTPAC", /CLINIC/],
  ])("%s: the lender is named, the rest of the narrative never", (_n, lines, lender, rest) => {
    const r = run({ lines: lines as Line[] });
    expect(all(r)).toContain(lender);
    expect(all(r)).not.toMatch(rest);
  });
  it("a possibly declared liability names the applicant's name and the lender only", () => {
    // Untyped in the data, so it is a "loan"; a different name of that type and amount: fuzzy.
    const s = lia01(loan("MACQUARIE IVF CLINIC REF", 300), [
      { type: "loan", provider: "Macquarie", repayment_monthly: 300 },
    ]);
    expect(s.reason).toContain(POSSIBLY("Macquarie", 300));
    expect(s.reason.toUpperCase()).not.toMatch(/IVF|CLINIC/);
  });
});

describe("LIA 1.3.1", () => {
  it("is the version", () => {
    expect(LIA_VERSION).toBe("1.3.1");
  });
});
