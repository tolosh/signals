// SIG-42: Colin's rulings of 16 November 2026 (comment 40327) on independent review 10 (comment
// 40326), LIA 1.3.4. Written before the change it tests:
//   1. Exact-name pairing is the best overall fit: it maximises the number of exact (name plus
//      compatible type) matches; ties go to the smallest total amount difference, then to a fixed,
//      documented tie-break that doesn't depend on input order. The input order of feeds or
//      declarations never changes the result. The fuzzy path stays as it is.
//   2. Sensitive words in displayed names are masked: a lender name falls back to the next word
//      that isn't sensitive, or "a lender"; in the applicant's declared text each sensitive word
//      shows as "[withheld]".
//   3. A merchant in a narrative ("HUMM SMILE DENTAL" against a declared "Humm") stays amber.
//   Also: lender names keep Unicode letters (ZÖP, ÉCO).
import { describe, expect, it } from "vitest";
import { assessLia, LIA_VERSION, type LiaResult } from "../../../src/engines/families/lia/index.js";
import { LENDER_NAMES_VERSION, lenderOf } from "../../../src/engines/families/lia/lenders.js";
import { AS_OF, build, repeat, run, signal, type Line, type Script } from "./script.js";

type Declared = { type: string; provider: string; repayment_monthly?: number };
const monthly = (description: string, amount: number, extra: Partial<Line> = {}): Line[] =>
  repeat(6, 30, { description, amount: -amount, ...extra });
const loan = (narrative: string, amount: number): Line[] =>
  monthly(`${narrative} 88123`, amount, { category: "loan_repayment" });
const sacc = (narrative: string, amount: number): Line[] =>
  repeat(13, 14, { description: narrative, amount: -amount, category: "sacc_loan" }, 3);
const bnpl = (narrative: string, amount: number): Line[] =>
  repeat(13, 14, { description: narrative, amount: -amount, category: "bnpl" }, 4);
const lia = (lines: Line[], declared: Declared[] = []) =>
  run({ lines }, { declared_liabilities: declared });
const lia01 = (lines: Line[], declared: Declared[]) => signal(lia(lines, declared), "LIA-01");
const flags = (r: LiaResult) =>
  r.liabilities.map((l) => [l.provider, l.monthly, l.declared] as const).sort();

/** mulberry32, so the shuffles are the same on every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffled = <T>(xs: readonly T[], r: () => number): T[] => {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
};

// Review 10's two cases.
const XAVO = [...loan("XAVO LOAN REPAYMENT", 500), ...loan("XAVO CAR LOAN", 300)];
const XAVO_DECLARED: Declared[] = [
  { type: "personal_loan", provider: "Xavo", repayment_monthly: 310 },
  { type: "car_loan", provider: "Xavo", repayment_monthly: 480 },
];
const BEVO = [...loan("BEVO LOAN REPAYMENT", 900), ...loan("BEVO PERSONAL LOAN", 300)];

describe("ruling 1: exact-name pairing is the best overall fit", () => {
  it("XAVO: both loans are declared, in either declaration order (maximum matching)", () => {
    for (const declared of [XAVO_DECLARED, [...XAVO_DECLARED].reverse()]) {
      const r = lia(XAVO, declared);
      expect(signal(r, "LIA-01").state).toBe("green");
      expect(signal(r, "LIA-01").value).toBe("2 found, all declared");
      expect(flags(r)).toEqual([
        ["XAVO", 300, true],
        ["XAVO", 500, true],
      ]);
    }
  });
  it("BEVO: the declaration goes to the loan with the closest amount, the $300 personal loan", () => {
    const r = lia(BEVO, [{ type: "personal_loan", provider: "Bevo", repayment_monthly: 300 }]);
    expect(flags(r)).toEqual([
      ["BEVO", 300, true],
      ["BEVO", 900, false],
    ]);
    const s = signal(r, "LIA-01");
    expect(s.state).toBe("amber");
    expect(s.reason).toContain("BEVO (loan, $900 a month) found but not in the application");
    expect(s.reason).not.toContain("$300 a month) found");
  });
  it("a tie on count and amount goes to the documented tie-break, in any declaration order", () => {
    // Two loans of one lender, each $400 from a single $500 plain-loan declaration (entered twice,
    // so one is a duplicate). The tie-break (ADR 0006) takes liabilities in the detector's key
    // order, family then provider: "KOVA" before "KOVA CAR", so the untyped $100 loan is paired.
    const lines = [...loan("KOVA LOAN REPAYMENT", 100), ...loan("KOVA CAR LOAN", 900)];
    const declared: Declared[] = [
      { type: "loan", provider: "Kova", repayment_monthly: 500 },
      { type: "loan", provider: "KOVA PTY LTD", repayment_monthly: 500 },
    ];
    const results = [declared, [...declared].reverse()].map((d) => lia(lines, d));
    for (const r of results)
      expect(flags(r)).toEqual([
        ["KOVA", 100, true],
        ["KOVA", 900, false],
      ]);
    expect(JSON.stringify(results[1])).toBe(JSON.stringify(results[0]));
  });
  it("the fuzzy path is unchanged: a fuzzy match is still amber, never green", () => {
    const s = lia01(loan("HARMONEY PERSONAL LOAN", 450), [
      { type: "personal_loan", provider: "Plenti", repayment_monthly: 450 },
    ]);
    expect(s.state).toBe("amber");
    expect(s.reason).toContain("Possibly the declared Plenti ($450 a month)");
  });
});

describe("ruling 1: the input order of feeds and declarations never changes the result", () => {
  // A mixed applicant: two lenders with two loans each (review 10's), a typed and an untyped
  // loan, a card, a BNPL, a SACC, a disbursement, and declarations with exact, conflicting,
  // fuzzy and duplicate entries.
  const script: Script = {
    lines: [
      ...XAVO,
      ...BEVO,
      ...loan("HARMONEY PERSONAL LOAN", 450),
      ...loan("PLENTI LOAN REPAYMENT", 260),
      ...monthly("BPAY CITI CREDIT CARD 4417", 180, {
        category: "transfer",
        billerName: "CITI CREDIT CARD",
      }),
      ...bnpl("AFTERPAY INSTALMENT", 40),
      ...bnpl("ZIP PAY", 25),
      ...sacc("NIMBLE REPAY", 60),
      ...sacc("CASH CONVERTERS LOAN", 45),
      { ago: 40, description: "SOCIETYONE LOAN DISBURSEMENT", amount: 4000 },
      { ago: 20, description: "HARMONEY LOAN DISBURSEMENT", amount: 1500 },
    ],
  };
  const declared: Declared[] = [
    ...XAVO_DECLARED,
    { type: "personal_loan", provider: "Bevo", repayment_monthly: 300 },
    { type: "car_loan", provider: "Harmoney", repayment_monthly: 450 },
    { type: "personal_loan", provider: "Harmoney Pty Ltd", repayment_monthly: 450 },
    { type: "personal_loan", provider: "HARMONEY", repayment_monthly: 450 },
    { type: "personal_loan", provider: "Society One", repayment_monthly: 255 },
    { type: "credit_card", provider: "Citibank", repayment_monthly: 180 },
    { type: "bnpl", provider: "Afterpay", repayment_monthly: 87 },
  ];
  const { feed, categories } = build(script);
  const assess = (f: typeof feed, d: Declared[]) =>
    JSON.stringify(
      assessLia({
        feed: f,
        feed_type: "cdr",
        as_of: AS_OF,
        lookback_months: 6,
        categories,
        application: { declared_liabilities: d },
      }),
    );
  const reorder = (order: <T>(xs: readonly T[]) => T[]) => ({
    ...feed,
    accounts: order(feed.accounts).map((a) => ({ ...a, transactions: order(a.transactions) })),
  });
  const base = assess(feed, declared);

  it("the case isn't trivial: it has exact, possibly declared and undisclosed liabilities", () => {
    const s = signal(JSON.parse(base) as LiaResult, "LIA-01");
    expect(s.state).toBe("amber");
    expect(s.value).toMatch(/undisclosed/);
    expect(s.value).toMatch(/possibly declared/);
    expect((JSON.parse(base) as LiaResult).liabilities.some((l) => l.declared)).toBe(true);
  });
  it("reversed declarations give the same result, byte for byte", () => {
    expect(assess(feed, [...declared].reverse())).toBe(base);
  });
  it("a reversed feed gives the same result, byte for byte", () => {
    expect(
      assess(
        reorder((xs) => [...xs].reverse()),
        declared,
      ),
    ).toBe(base);
  });
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "shuffle %i of both the feed and the declarations gives the same result",
    (seed) => {
      const r = rng(seed);
      expect(
        assess(
          reorder((xs) => shuffled(xs, r)),
          shuffled(declared, r),
        ),
      ).toBe(base);
    },
  );
});

describe("ruling 2: sensitive words in displayed names are masked", () => {
  it.each([
    ["IVF NIMBLE REPAY", "NIMBLE"],
    ["ONCOLOGY HARMONEY LOAN", "HARMONEY"],
    ["IVF CASH CONVERTERS", "CASH CONVERTERS"],
    ["PSYCHOLOGY CLINIC WALLET WIZARD", "WALLET WIZARD"],
    ["IVF CLINIC", "a lender"],
  ])("a lender written %s is named %s", (narrative, name) => {
    expect(lenderOf(narrative, narrative)).toBe(name);
  });
  it("without a description too", () => {
    expect(lenderOf("IVF NIMBLE REPAY")).toBe("NIMBLE");
    expect(lenderOf("IVF CLINIC")).toBe("a lender");
  });
  it("LIA-03 and the liabilities list name NIMBLE, not IVF", () => {
    const r = lia(sacc("IVF NIMBLE REPAY", 60));
    expect(signal(r, "LIA-03").reason).toContain("NIMBLE");
    expect(signal(r, "LIA-03").reason).not.toMatch(/IVF/);
    expect(r.liabilities.map((l) => l.provider)).toEqual(["NIMBLE"]);
  });
  it("LIA-01 names HARMONEY, not ONCOLOGY", () => {
    const s = lia01(loan("ONCOLOGY HARMONEY LOAN", 300), []);
    expect(s.reason).toContain("HARMONEY (loan");
    expect(s.reason).not.toMatch(/ONCOLOGY/);
  });
  it("a name that is all sensitive words shows as a lender", () => {
    const r = lia(sacc("IVF CLINIC", 60));
    expect(signal(r, "LIA-03").reason).toContain("a lender");
    expect(signal(r, "LIA-03").reason).not.toMatch(/IVF|CLINIC/);
  });
  it("a lender known only from its account is masked too", () => {
    const r = run(
      {
        accounts: [
          {
            accountId: "acc-loan",
            productCategory: "PERS_LOANS",
            productName: "IVF Finance Personal Loan",
          },
        ],
      },
      { declared_liabilities: [] },
    );
    expect(JSON.stringify(r)).not.toMatch(/IVF/);
    expect(r.liabilities.map((l) => l.provider)).toEqual(["FINANCE"]);
  });
  it("the applicant's declared text shows each sensitive word as [withheld]", () => {
    const s = lia01(loan("HARMONEY PERSONAL LOAN", 450), [
      { type: "personal_loan", provider: "IVF clinic loan", repayment_monthly: 450 },
    ]);
    expect(s.state).toBe("amber");
    expect(s.reason).toContain("Possibly the declared [withheld] [withheld] loan ($450 a month)");
    expect(JSON.stringify(s)).not.toMatch(/IVF|clinic/i);
  });
  it("declared text without a sensitive word is shown as the applicant wrote it", () => {
    const s = lia01(loan("HARMONEY PERSONAL LOAN", 450), [
      { type: "personal_loan", provider: "Plenti loan", repayment_monthly: 450 },
    ]);
    expect(s.reason).toContain("Possibly the declared Plenti loan ($450 a month)");
  });
  it("masking is for display only: matching still reads the unmasked name", () => {
    // "IVF HARMONEY" declared, "IVF HARMONEY LOAN" in the feed: the exact names agree.
    const s = lia01(loan("IVF HARMONEY LOAN", 300), [
      { type: "loan", provider: "IVF Harmoney", repayment_monthly: 300 },
    ]);
    expect(s.state).toBe("green");
  });
});

describe("ruling 3: a merchant in a narrative stays amber", () => {
  it("HUMM SMILE DENTAL against a declared Humm is amber, and names only HUMM", () => {
    const s = lia01(bnpl("HUMM SMILE DENTAL", 45), [
      { type: "bnpl", provider: "Humm", repayment_monthly: 97 },
    ]);
    expect(s.state).toBe("amber");
    expect(s.reason).not.toMatch(/SMILE|DENTAL/);
  });
});

describe("lender names keep Unicode letters", () => {
  it.each([
    ["ZÖP LOAN REPAYMENT", "ZÖP"],
    ["ÉCO BANK PERSONAL LOAN", "ÉCO"],
    ["ŁUKA FINANCE LOAN", "ŁUKA"],
  ])("%s is named %s", (narrative, name) => {
    expect(lenderOf(narrative.replace(/[^A-Z ]/g, " ").trim(), narrative)).toBe(name);
    expect(lia01(loan(narrative, 300), []).reason).toContain(`${name} (`);
  });
  it("a listed name still wins, and ASCII names are unchanged", () => {
    expect(lenderOf("CASH CONVERTERS", "CASH CONVERTERS 7781 LOAN")).toBe("CASH CONVERTERS");
    expect(lenderOf("HARMONEY", "HARMONEY LOAN REPAYMENT")).toBe("HARMONEY");
  });
});

describe("versions", () => {
  it("LIA is 1.3.4; the lender-name list is unchanged at 1.1.0", () => {
    expect(LIA_VERSION).toBe("1.3.4");
    expect(LENDER_NAMES_VERSION).toBe("1.1.0");
    expect(lia([]).version).toBe("1.3.4");
  });
});
