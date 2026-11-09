// GR-3, repo-wide (SIG-42 review ruling 2, 8 November 2026; Product Specification §9.2): spending
// at medical providers, pharmacies, religious organisations, unions and political parties never
// feeds a signal, ratio or decisioning input. Three checks:
//   1. the exclusion list itself;
//   2. every engine entry that reads transactions gives byte-identical output with and without
//      sensitive lines, found by Enrich category, by a payee Enrich marks sensitive, or by MCC;
//   3. a static scan: every module under src/engines/ that reads transactions applies the gate,
//      or is on a short, reasoned list, and that list can't grow unnoticed.
// The one exception, observed living expenses (AF-E1 counts "health"), is pinned as it stands
// until it's ruled (G-1, docs/adr/0007-gr3-sensitive-spending.md).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INCOME_METHOD_VERSION, deriveIncome } from "../../src/engines/affordability/income.js";
import {
  OBSERVED_EXPENSES_METHOD_VERSION,
  deriveObservedExpenses,
} from "../../src/engines/affordability/observed-expenses.js";
import { dayOf, isoOf } from "../../src/engines/evidence/dates.js";
import { assessEvidence } from "../../src/engines/evidence/index.js";
import { INC_VERSION, assessInc } from "../../src/engines/families/inc/index.js";
import { LIA_VERSION, assessLia } from "../../src/engines/families/lia/index.js";
import * as gate from "../../src/engines/sensitive.js";
import {
  SENSITIVE_CATEGORIES,
  SENSITIVE_MCCS,
  isSensitive,
  withoutSensitive,
} from "../../src/engines/sensitive.js";
import { scanTransactionsReads } from "./gr3-taint.js";

const AS_OF = "2026-10-31";
const END = dayOf(AS_OF);

type Tx = {
  accountId: string;
  transactionId: string;
  type: string;
  description: string;
  postingDateTime: string;
  amount: string;
  reference?: string;
  merchantCategoryCode?: string;
};
type Line = {
  ago: number;
  description: string;
  amount: number;
  category?: string;
  mcc?: string;
  type?: string;
  reference?: string;
};

/** A salaried applicant over 12 months, with groceries and a card, and optional extra lines. */
function applicant(extra: Line[]) {
  const lines: Line[] = [];
  for (let d = 2; d < 365; d += 14)
    lines.push({ ago: d, description: "SALARY ACME CONSULTING PTY LTD", amount: 3000 });
  for (let d = 3; d < 365; d += 7)
    lines.push({
      ago: d,
      description: "COLES 4729 PARRAMATTA",
      amount: -140,
      category: "groceries",
      mcc: "5411",
    });
  for (let d = 9; d < 365; d += 30)
    lines.push({ ago: d, description: "AGL ENERGY", amount: -160, category: "utilities" });
  const categories: Record<string, string> = {};
  const transactions: Tx[] = [...lines, ...extra].map((l, i) => {
    const id = `t${String(i).padStart(5, "0")}`;
    if (l.category) categories[id] = l.category;
    return {
      accountId: "acc-pay",
      transactionId: id,
      type: l.type ?? (l.amount > 0 ? "TRANSFER_INCOMING" : "PAYMENT"),
      description: l.description,
      postingDateTime: `${isoOf(END - l.ago)}T02:00:00Z`,
      amount: l.amount.toFixed(2),
      ...(l.reference ? { reference: l.reference } : {}),
      ...(l.mcc ? { merchantCategoryCode: l.mcc } : {}),
    };
  });
  transactions.sort((a, b) => (a.postingDateTime < b.postingDateTime ? -1 : 1));
  return {
    feed: {
      accounts: [
        {
          account: { accountId: "acc-pay", productCategory: "TRANS_AND_SAVINGS_ACCOUNTS" },
          detail: { data: { bsb: "062000", accountNumber: "11112222" } },
          transactions,
        },
      ],
    },
    categories,
  };
}

const monthly = (n: number, first: number, line: Omit<Line, "ago">): Line[] =>
  Array.from({ length: n }, (_, i) => ({ ...line, ago: first + i * 30 }));

/** Sensitive lines of every kind, each shaped to move some signal if it were read. */
const SENSITIVE: Line[] = [
  // Enrich's category (healthcare covers medical and pharmacy), with and without an MCC.
  ...monthly(10, 4, {
    description: "CHEMIST WAREHOUSE PARRAMATTA",
    amount: -64.5,
    category: "healthcare",
    mcc: "5912",
  }),
  ...monthly(6, 11, {
    description: "NTHSIDE HEALTH SVC PAY",
    amount: -220,
    category: "healthcare",
  }),
  // A payee Enrich marks sensitive: repeated transfers to a parish with a repayment reference,
  // which LIA-06's rule would read as a large private loan.
  ...monthly(6, 6, {
    description: "TRANSFER TO ST MARYS PARISH",
    amount: -600,
    category: "sensitive",
    type: "TRANSFER_OUTGOING",
    reference: "LOAN REPAY",
  }),
  // An uncategorised transfer to a union with a repayment reference, found by its MCC: LIA-06's
  // rule would read it as an increasing private loan (the review's F3 probe).
  ...Array.from({ length: 6 }, (_, i) => ({
    ago: 7 + i * 30,
    description: "TRANSFER TO CFMEU",
    amount: -(560 + i * 60),
    mcc: "8699",
    type: "TRANSFER_OUTGOING",
    reference: "REPAY",
  })),
  // A loan from a religious organisation (Enrich's category): LIA-02 reads a LOAN credit as a
  // disbursement, so with the gate off LIA moves (SIG-42 re-review, K1).
  { ago: 40, description: "ST MARYS PARISH LOAN 22817", amount: 5000, category: "religious" },
  // MCC only: no Enrich category.
  ...monthly(6, 13, { description: "UNITED WORKERS UNION DUES", amount: -48, mcc: "8699" }),
  ...monthly(3, 17, { description: "PARTY DONATION", amount: -250, mcc: "8651" }),
  ...monthly(4, 19, { description: "HILLSONG CHURCH", amount: -100, mcc: "8661" }),
  ...monthly(5, 21, { description: "DR A NGUYEN MEDICAL", amount: -85, mcc: "8011" }),
  // A credit from a pharmacy, every fortnight, which an income rule could read as a stream.
  ...Array.from({ length: 12 }, (_, i) => ({
    ago: 8 + i * 14,
    description: "PRICELINE PHARMACY",
    amount: 410,
    mcc: "5912",
  })),
];

const base = applicant([]);
const withSensitive = applicant(SENSITIVE);
// The base lines keep the same IDs in both feeds (extra lines are numbered after them), so the
// outputs are compared exactly, transaction IDs included.
const canon = (x: unknown) => JSON.stringify(x);

describe("GR-3 exclusion list", () => {
  it("names the five groups, Enrich's healthcare category and Enrich's sensitive mark", () => {
    expect([...SENSITIVE_CATEGORIES].sort()).toEqual(
      ["healthcare", "medical", "pharmacy", "political", "religious", "sensitive", "union"].sort(),
    );
  });
  it("lists pharmacy, medical, religious, political and union MCCs", () => {
    for (const mcc of ["5912", "8011", "8062", "8661", "8651", "8699"])
      expect(SENSITIVE_MCCS).toHaveProperty(mcc);
    expect(SENSITIVE_MCCS).not.toHaveProperty("5411");
  });
  it("finds a line by category, by Enrich's mark or by MCC, and nothing else", () => {
    expect(isSensitive({ transactionId: "a" }, { a: "healthcare" })).toBe(true);
    expect(isSensitive({ transactionId: "a" }, { a: "sensitive" })).toBe(true);
    expect(isSensitive({ transactionId: "a", merchantCategoryCode: "8661" })).toBe(true);
    expect(
      isSensitive({ transactionId: "a", merchantCategoryCode: "5411" }, { a: "groceries" }),
    ).toBe(false);
    expect(
      withoutSensitive(withSensitive.feed, withSensitive.categories).accounts[0]?.transactions,
    ).toHaveLength(base.feed.accounts[0]?.transactions.length ?? -1);
  });
});

// The same lines with their marks taken off (no category, no MCC): each engine must move, or the
// byte-identical checks below would pass with the gate off (SIG-42 re-review, K1).
const unmarked = applicant(
  SENSITIVE.map(({ category, mcc, ...l }) =>
    category === undefined && mcc === undefined ? l : { ...l, category: "transfer" },
  ),
);

describe("GR-3: every engine entry is blind to sensitive lines", () => {
  const both = <T>(f: (x: typeof base) => T) => [canon(f(base)), canon(f(withSensitive))];

  it("the evidence-quality layer (EQ-01 to EQ-03, and every signal's evidence block)", () => {
    const [a, b] = both((x) =>
      assessEvidence({
        feed: x.feed,
        feed_type: "cdr",
        as_of: AS_OF,
        lookback_months: 6,
        categories: x.categories,
      } as Parameters<typeof assessEvidence>[0]),
    );
    expect(b).toBe(a);
  });
  it("family 1 INC", () => {
    const [a, b] = both((x) =>
      assessInc({
        feed: x.feed,
        feed_type: "cdr",
        as_of: AS_OF,
        lookback_months: 6,
        categories: x.categories,
      } as Parameters<typeof assessInc>[0]),
    );
    expect(b).toBe(a);
  });
  it("family 3 LIA, all six signals, LIA-06 included", () => {
    const [a, b] = both((x) =>
      assessLia({
        feed: x.feed,
        feed_type: "cdr",
        as_of: AS_OF,
        lookback_months: 6,
        categories: x.categories,
        application: { declared_liabilities: [] },
      }),
    );
    expect(b).toBe(a);
  });
  it("observed income for affordability (a ratio input)", () => {
    const [a, b] = both((x) =>
      deriveIncome({
        feed: x.feed,
        as_of: AS_OF,
        lookback_months: 6,
        min_occurrences: 3,
        categories: x.categories,
      } as Parameters<typeof deriveIncome>[0]),
    );
    expect(b).toBe(a);
  });
  // Non-vacuity: unmarked, the same lines move every engine, so a gate made a no-op fails above.
  const lia = (x: typeof base) =>
    assessLia({
      feed: x.feed,
      feed_type: "cdr",
      as_of: AS_OF,
      lookback_months: 6,
      categories: x.categories,
      application: { declared_liabilities: [] },
    });
  it.each([
    [
      "evidence",
      (x: typeof base) =>
        assessEvidence({ feed: x.feed, feed_type: "cdr", as_of: AS_OF, lookback_months: 6 }),
    ],
    [
      "INC",
      (x: typeof base) =>
        assessInc({
          feed: x.feed,
          feed_type: "cdr",
          as_of: AS_OF,
          lookback_months: 6,
          categories: x.categories,
        } as Parameters<typeof assessInc>[0]),
    ],
    ["LIA", lia],
    [
      "observed income",
      (x: typeof base) =>
        deriveIncome({
          feed: x.feed,
          as_of: AS_OF,
          lookback_months: 6,
          min_occurrences: 3,
          categories: x.categories,
        } as Parameters<typeof deriveIncome>[0]),
    ],
  ] as const)("%s: the same lines, unmarked, change the output", (_name, f) => {
    expect(canon(f(unmarked))).not.toBe(canon(f(base)));
  });
  it("LIA in particular: the unmarked parish loan is a disbursement (LIA-02 amber)", () => {
    expect(lia(unmarked).signals.find((s) => s.id === "LIA-02")?.state).toBe("amber");
    expect(lia(withSensitive).signals.find((s) => s.id === "LIA-02")?.state).toBe("none_observed");
  });
});

// SIG-42 re-review direction 5 (19:40): a liability repayment is never removed as sensitive
// spending. The gate applies to spending lines; lines Enrich categorises as a loan, card, BNPL,
// SACC, mortgage or wage-advance repayment stay, whatever their merchant code.
const LIABILITY_CATEGORIES = [
  "loan_repayment",
  "credit_card",
  "bnpl",
  "sacc_loan",
  "mortgage",
  "wage_advance",
];
describe("GR-3 over-exclusion: liability repayments are never sensitive", () => {
  it.each(LIABILITY_CATEGORIES)("%s with a medical MCC is not removed", (category) => {
    expect(isSensitive({ transactionId: "a", merchantCategoryCode: "8021" }, { a: category })).toBe(
      false,
    );
  });
  it("a sensitive category still is: healthcare with no MCC", () => {
    expect(isSensitive({ transactionId: "a" }, { a: "healthcare" })).toBe(true);
  });
  const repayments = (mcc?: string) =>
    applicant([
      ...monthly(6, 5, {
        description: "HUMM SMILE DENTAL 88123",
        amount: -120,
        category: "bnpl",
        ...(mcc ? { mcc } : {}),
      }),
      ...Array.from({ length: 6 }, (_, i) => ({
        ago: 6 + i * 14,
        description: "CASH CONVERTERS LOAN 7781",
        amount: -95,
        category: "sacc_loan",
        ...(mcc ? { mcc } : {}),
      })),
    ]);
  it("LIA reads a BNPL and a SACC repayment carrying a dental MCC exactly as without it", () => {
    const run = (x: typeof base) =>
      assessLia({
        feed: x.feed,
        feed_type: "cdr",
        as_of: AS_OF,
        lookback_months: 6,
        categories: x.categories,
        application: { declared_liabilities: [] },
      });
    // Every signal and liability as without the MCC. Only the evidence block's field-population
    // share differs, because the MCC is one more populated field.
    const read = (r: ReturnType<typeof run>) =>
      canon({
        signals: r.signals.map(({ id, state, value, reason }) => ({ id, state, value, reason })),
        liabilities: r.liabilities,
      });
    const plain = run(repayments());
    expect(plain.signals.find((s) => s.id === "LIA-03")?.state).toBe("red");
    expect(read(run(repayments("8021")))).toBe(read(plain));
  });
  it("observed living expenses don't count them as health", () => {
    expect(canon(expensesOf(repayments("8021")))).toBe(canon(expensesOf(repayments())));
  });
});

// D29 (Decision Record; GR-3, Product Specification §9.2; SIG-42 ruling 2, 8 November 2026,
// 16:36). Health spending counts towards the living-expense total (AF-E1) as an aggregate amount
// only: never itemised, labelled or used to judge. Religious, union and political spending, and
// payees Enrich marks sensitive, are not living expenses and never enter the totals.
const isHealthLine = (l: Line) =>
  l.category === "healthcare" || (l.mcc !== undefined && ["5912", "8011"].includes(l.mcc));
const HOSPITAL: Line = {
  ago: 30,
  description: "ST VINCENTS HOSPITAL",
  amount: -8000,
  category: "healthcare",
};
const expensesOf = (x: typeof base) =>
  deriveObservedExpenses({
    feed: x.feed,
    categories: x.categories,
    as_of: AS_OF,
    lookback_months: 6,
    one_off_threshold_aud: 5000,
  });

describe("D29: observed living expenses", () => {
  it("religious, union and political spending, and Enrich-marked payees, never enter them", () => {
    const others = applicant(SENSITIVE.filter((l) => !isHealthLine(l)));
    expect(canon(expensesOf(others))).toBe(canon(expensesOf(base)));
  });
  it("health counts towards basic, the living-expense total, and moves nothing else", () => {
    const health = applicant([
      ...SENSITIVE.filter((l) => l.amount < 0 && isHealthLine(l)),
      HOSPITAL,
    ]);
    const a = expensesOf(base);
    const b = expensesOf(health);
    expect(b.basic_monthly).toBeGreaterThan(a.basic_monthly);
    expect(b.living_monthly).toBeGreaterThan(a.living_monthly);
    expect(b.committed_monthly).toBe(a.committed_monthly);
    expect(b.discretionary_monthly).toBe(a.discretionary_monthly);
  });
  it("health is never itemised: a large health debit isn't listed as a one-off", () => {
    const b = expensesOf(applicant([HOSPITAL]));
    expect(b.one_offs).toEqual([]);
    expect(b.basic_monthly).toBeGreaterThan(expensesOf(base).basic_monthly);
  });
});

describe("D29: no breakdown, trace line or reason names a sensitive category", () => {
  const everything = applicant([...SENSITIVE, HOSPITAL]);
  const baseIds = new Set(base.feed.accounts[0]?.transactions.map((t) => t.transactionId));
  const sensitiveIds = (everything.feed.accounts[0]?.transactions ?? [])
    .map((t) => t.transactionId)
    .filter((id) => !baseIds.has(id));
  const WORDS =
    /medic|pharm|health|relig|union|politic|parish|church|chemist|hospital|donation|priceline/i;
  const outputs: [string, unknown][] = [
    ["observed living expenses", expensesOf(everything)],
    [
      "evidence",
      assessEvidence({
        feed: everything.feed,
        feed_type: "cdr",
        as_of: AS_OF,
        lookback_months: 6,
        categories: everything.categories,
      }),
    ],
    [
      "INC",
      assessInc({
        feed: everything.feed,
        feed_type: "cdr",
        as_of: AS_OF,
        lookback_months: 6,
        categories: everything.categories,
      }),
    ],
    [
      "LIA",
      assessLia({
        feed: everything.feed,
        feed_type: "cdr",
        as_of: AS_OF,
        lookback_months: 6,
        categories: everything.categories,
        application: { declared_liabilities: [] },
      }),
    ],
    [
      "observed income",
      deriveIncome({
        feed: everything.feed,
        as_of: AS_OF,
        lookback_months: 6,
        min_occurrences: 3,
        categories: everything.categories,
      }),
    ],
  ];
  it.each(outputs)("%s: no sensitive category code, word or transaction ID", (_name, out) => {
    const text = JSON.stringify(out);
    for (const code of SENSITIVE_CATEGORIES) expect(text).not.toContain(`"${code}"`);
    expect(text).not.toMatch(WORDS);
    for (const id of sensitiveIds) expect(text).not.toContain(id);
  });
  it("the check isn't vacuous: the inputs carry every sensitive kind", () => {
    expect(SENSITIVE.some((l) => l.description.includes("PARISH LOAN"))).toBe(true);
    expect(sensitiveIds.length).toBeGreaterThan(50);
    expect(JSON.stringify(everything)).toMatch(WORDS);
  });
});

// SIG-42 re-review direction 6 (D29): reasons and traces name the provider or lender, never the
// raw narrative. Every narrative here carries more than a name (a reference or a merchant), and
// none may appear in any engine's output; nor may the merchant behind a BNPL (an unmarked dental
// practice, which G-2 can't catch).
describe("D29: no output echoes a raw narrative", () => {
  const lines: Line[] = [
    ...monthly(12, 4, { description: "SALARY BETA LOGISTICS REF 0042117", amount: 900 }),
    ...Array.from({ length: 13 }, (_, i) => ({
      ago: 5 + i * 14,
      description: "HUMM SMILE DENTAL 88123",
      amount: -45,
      category: "bnpl",
    })),
    ...Array.from({ length: 13 }, (_, i) => ({
      ago: 6 + i * 14,
      description: "AFTERPAY JB HI-FI 4411",
      amount: -30,
      category: "bnpl",
    })),
    ...monthly(6, 8, {
      description: "BPAY CBA CREDIT CARD 4417",
      amount: -180,
      category: "transfer",
    }),
    ...monthly(6, 9, {
      description: "SOCIETYONE PERSONAL LOAN 88123",
      amount: -450,
      category: "loan_repayment",
    }),
    { ago: 30, description: "PLENTI DISBURSEMENT 55121", amount: 5000 },
    ...Array.from({ length: 6 }, (_, i) => ({
      ago: 10 + i * 14,
      description: "CASH CONVERTERS LOAN 7781",
      amount: -95,
      category: "sacc_loan",
    })),
    ...Array.from({ length: 6 }, (_, i) => ({
      ago: 12 + i * 14,
      description: "BEFOREPAY ADVANCE 2231",
      amount: 200,
    })),
    ...Array.from({ length: 6 }, (_, i) => ({
      ago: 11 + i * 14,
      description: "BEFOREPAY REPAYMENT 2231",
      amount: -210,
      category: "wage_advance",
    })),
  ];
  const x = applicant(lines);
  const narratives = [
    ...new Set((x.feed.accounts[0]?.transactions ?? []).map((t) => t.description)),
  ].filter((d) => /\d/.test(d));
  const outputs: [string, unknown][] = [
    ["observed living expenses", expensesOf(x)],
    [
      "evidence",
      assessEvidence({ feed: x.feed, feed_type: "cdr", as_of: AS_OF, lookback_months: 6 }),
    ],
    [
      "INC",
      assessInc({
        feed: x.feed,
        feed_type: "cdr",
        as_of: AS_OF,
        lookback_months: 6,
        categories: x.categories,
      } as Parameters<typeof assessInc>[0]),
    ],
    [
      "LIA",
      assessLia({
        feed: x.feed,
        feed_type: "cdr",
        as_of: AS_OF,
        lookback_months: 6,
        categories: x.categories,
        application: { declared_liabilities: [] },
      }),
    ],
    [
      "observed income",
      deriveIncome({
        feed: x.feed,
        as_of: AS_OF,
        lookback_months: 6,
        min_occurrences: 3,
        categories: x.categories,
      } as Parameters<typeof deriveIncome>[0]),
    ],
  ];
  it.each(outputs)("%s: no narrative, and no merchant behind a BNPL", (_name, out) => {
    const text = JSON.stringify(out).toUpperCase();
    for (const n of narratives) expect(text).not.toContain(n.toUpperCase());
    expect(text).not.toMatch(/SMILE|DENTAL|JB HI/);
  });
  it("the check isn't vacuous: LIA names the lenders", () => {
    const text = JSON.stringify(outputs.find(([n]) => n === "LIA")?.[1]);
    // Ruling 3 (9 November 2026): a lender is named by the first word of its narrative, for every
    // family now (the interim rule ruled for BNPL). The 10 November ruling: a known multi-word
    // lender is matched first, so Cash Converters is "CASH CONVERTERS", not "CASH".
    for (const lender of ["HUMM", "AFTERPAY", "SOCIETYONE", "CASH CONVERTERS"])
      expect(text).toContain(lender);
    expect(narratives.length).toBeGreaterThan(8);
  });
});

// SIG-42 re-review direction 8: the gate's version is part of each engine's recorded inputs, and
// the engines whose output it changed are bumped.
describe("GR-3 gate version", () => {
  it("is 1.2.0: liability repayments are kept, and a liability credit with a sensitive MCC removed", () => {
    expect(gate.SENSITIVE_METHOD_VERSION).toBe("1.2.0");
  });
  it("is recorded by every engine that reads the gate", () => {
    const v = { gr3_gate_version: gate.SENSITIVE_METHOD_VERSION };
    expect(
      assessEvidence({ feed: base.feed, feed_type: "cdr", as_of: AS_OF, lookback_months: 6 }),
    ).toMatchObject(v);
    expect(
      assessInc({
        feed: base.feed,
        feed_type: "cdr",
        as_of: AS_OF,
        lookback_months: 6,
        categories: base.categories,
      } as Parameters<typeof assessInc>[0]),
    ).toMatchObject(v);
    expect(
      assessLia({
        feed: base.feed,
        feed_type: "cdr",
        as_of: AS_OF,
        lookback_months: 6,
        categories: base.categories,
        application: { declared_liabilities: [] },
      }),
    ).toMatchObject(v);
    expect(
      deriveIncome({
        feed: base.feed,
        as_of: AS_OF,
        lookback_months: 6,
        min_occurrences: 3,
        categories: base.categories,
      } as Parameters<typeof deriveIncome>[0]),
    ).toMatchObject(v);
    expect(expensesOf(base)).toMatchObject(v);
  });
  it("LIA is 1.3.2 (the 10 November rulings); INC 1.2.2, observed income 1.0.1, observed expenses 1.1.1", () => {
    // Gate 1.2.0 changes their output only on a liability credit carrying a sensitive MCC; each
    // records the gate version it ran, so their own versions stand (for the reviewer).
    expect(INC_VERSION).toBe("1.2.2");
    expect(INCOME_METHOD_VERSION).toBe("1.0.1");
    expect(LIA_VERSION).toBe("1.3.2");
    expect(OBSERVED_EXPENSES_METHOD_VERSION).toBe("1.1.1");
  });
});

describe("GR-3 static scan: every read of transactions under src/engines/ is gated", () => {
  // Review 9 (C2): the scan is a taint check over the syntax tree (test/repo/gr3-taint.ts), which
  // follows each read back to the gate. The regex scan it replaces missed nested destructuring,
  // computed keys, and a token withoutSensitive() call placed beside an ungated read.
  /** Reads transactions without the gate, on purpose. Adding to this list needs a reason. */
  const UNGATED: Record<string, string> = {
    "engines/sensitive.ts": "the gate itself",
    "engines/liabilities/index.ts":
      "SIG-18's detector at 1.0.0, unchanged; LIA-01 calls it with the gated feed",
    "engines/families/inc/streams.ts": "called only by assessInc, with the gated feed",
    "engines/affordability/observed-expenses.ts":
      "D29: health counts in the living-expense total as an aggregate; the rest is removed",
  };
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
    });
  const ungatedIn = (src: string) => scanTransactionsReads(src).filter((r) => !r.gated);
  const GATE = 'import { withoutSensitive } from "../sensitive.js";\n';

  it.each([
    // the forms the regex scan found
    "export function f(feed: F) { for (const a of feed.accounts) use(a.transactions); }",
    'export function f(account: A) { return account["transactions"]; }',
    "export function f(account: A) { return account?.['transactions']; }",
    "export function f(feed: F) { for (const { transactions } of feed.accounts) use(transactions); }",
    "export function f(a: A) { const { account, transactions } = a; return transactions; }",
    "export function f(feed: F) { return feed.accounts.map(({ transactions }) => transactions.length); }",
    "export function f({ transactions }: Acc) { return transactions; }",
    // review 9's three gaps
    "export function f(input: I) { const { feed: { accounts: [{ transactions }] } } = input; return transactions; }",
    'const K = "transactions";\nexport function f(a: A) { return a[K]; }',
    'const K = "transactions";\nexport function f(a: A) { const { [K]: tx } = a; return tx; }',
    "export function f(input: I) { const feed = withoutSensitive(input.feed); for (const a of input.feed.accounts) use(a.transactions); return feed; }",
    // and its neighbours
    "export function f(input: I) { const g = withoutSensitive(input.feed); const ctx = { feed: input.feed, g }; return ctx.feed.accounts.map((a) => a.transactions); }",
    "export function f(input: I) { const g = withoutSensitive(input.feed); return { ...g, accounts: input.feed.accounts }.accounts.map((a) => a.transactions); }",
  ])("flags an ungated read written as: %s", (snippet) => {
    expect(ungatedIn(GATE + snippet).length).toBeGreaterThan(0);
  });

  it.each([
    "export function f(input: I) { const feed = withoutSensitive(input.feed); return feed.accounts.flatMap((acc) => acc.transactions.map((t) => t.amount)); }",
    "export function f(input: I) { const feed = withoutSensitive(input.feed); for (const { transactions } of feed.accounts) use(transactions); }",
    "export function f(input: I) { const feed = withoutSensitive(input.feed); const w = { ...feed, accounts: feed.accounts.map((a) => ({ ...a, transactions: a.transactions.filter(ok) })) }; return w.accounts.map((a) => a.transactions); }",
    "type Ctx = { feed: F; end: number };\nfunction g(c: Ctx) { return c.feed.accounts.map((a) => a.transactions); }\nexport function f(input: I) { const feed = withoutSensitive(input.feed); const ctx: Ctx = { feed, end: 1 }; return g(ctx); }",
    "function g(feed: F) { return feed.accounts.map((a) => a.transactions); }\nexport function f(input: I) { return g(withoutSensitive(input.feed)); }",
    'const label = "transactions";\nexport type T = { transactions: Tx[] };\n// transactions',
  ])("passes a gated read, or no read: %s", (snippet) => {
    expect(ungatedIn(GATE + snippet)).toEqual([]);
  });

  it("every module not on the list reads transactions only through the gate", () => {
    const ungated = files("src/engines")
      .map((p) => p.replace(/\\/g, "/").replace(/^src\//, ""))
      .filter((p) => ungatedIn(readFileSync(`src/${p}`, "utf8")).length > 0);
    expect(ungated.sort()).toEqual(Object.keys(UNGATED).sort());
  });
  it("the gated engines do read transactions (the scan isn't vacuous)", () => {
    for (const p of [
      "engines/evidence/checks.ts",
      "engines/families/inc/index.ts",
      "engines/families/lia/index.ts",
      "engines/affordability/income.ts",
    ]) {
      const reads = scanTransactionsReads(readFileSync(`src/${p}`, "utf8"));
      expect(reads.length, p).toBeGreaterThan(0);
      expect(
        reads.every((r) => r.gated),
        p,
      ).toBe(true);
    }
  });
  it("streamsOf is called from assessInc only", () => {
    const callers = files("src")
      .filter((p) => /\bstreamsOf\(/.test(readFileSync(p, "utf8")))
      .map((p) => p.replace(/\\/g, "/"));
    expect(callers.sort()).toEqual(
      ["src/engines/families/inc/index.ts", "src/engines/families/inc/streams.ts"].sort(),
    );
  });
});

// Review 9 (C3): a credit categorised as a liability that carries a medical MCC, such as a BNPL
// refund from a dentist, is sensitive. Only liability repayments, which are debits, are exempt.
describe("GR-3: the liability exemption covers repayments (debits) only", () => {
  const cats = { r: "bnpl", c: "bnpl" };
  it("a BNPL repayment carrying a dental MCC is kept", () => {
    expect(
      isSensitive({ transactionId: "r", merchantCategoryCode: "8021", amount: "-45.00" }, cats),
    ).toBe(false);
  });
  it("a BNPL refund carrying a dental MCC is removed, in every liability category", () => {
    for (const category of [
      "loan_repayment",
      "credit_card",
      "bnpl",
      "sacc_loan",
      "mortgage",
      "wage_advance",
    ])
      expect(
        isSensitive(
          { transactionId: "c", merchantCategoryCode: "8021", amount: "45.00" },
          { c: category },
        ),
        category,
      ).toBe(true);
  });
  it("a liability credit with no sensitive MCC is kept (a loan disbursement)", () => {
    expect(isSensitive({ transactionId: "c", amount: "5000.00" }, { c: "loan_repayment" })).toBe(
      false,
    );
  });
  it("the gate is 1.2.0", () => {
    expect(gate.SENSITIVE_METHOD_VERSION).toBe("1.2.0");
  });
});

// Ruling 3 (9 November 2026, 20:29): no engine's output text carries a sensitive keyword, wherever
// it sits in a narrative, not only as a whole narrative. Every liability family is fed narratives
// with the lender followed by a sensitive word (review 9's C4 probes among them), uncategorised
// as sensitive and with no sensitive MCC, so the gate can't remove them: only naming the lender
// alone keeps the words out. Income payers stay outside this check (G-2, ruled unchanged).
describe("D29: no engine's output text carries a sensitive keyword", () => {
  const KEYWORDS =
    /\b(IVF|CLINIC|ONCOLOGY|PSYCH\w*|APPT|DENTAL|SMILE|HOSPITAL|MEDICAL|PHARMACY|CHEMIST|PHYSIO|GP|CHURCH|PARISH|UNION|PARTY)\b/i;
  const lines: Line[] = [
    ...monthly(12, 4, { description: "SALARY BETA LOGISTICS", amount: 900 }),
    ...monthly(6, 9, {
      description: "MACQUARIE IVF CLINIC REF 4411",
      amount: -300,
      category: "loan_repayment",
    }),
    ...Array.from({ length: 6 }, (_, i) => ({
      ago: 10 + i * 14,
      description: "NIMBLE REPAY ONCOLOGY BILL",
      amount: -95,
      category: "sacc_loan",
    })),
    ...Array.from({ length: 6 }, (_, i) => ({
      ago: 12 + i * 14,
      description: "BEFOREPAY PSYCH APPT",
      amount: 200,
    })),
    ...Array.from({ length: 6 }, (_, i) => ({
      ago: 11 + i * 14,
      description: "BEFOREPAY PSYCH APPT",
      amount: -210,
      category: "wage_advance",
    })),
    { ago: 30, description: "HARMONEY IVF LOAN 55121", amount: 5000 },
    ...Array.from({ length: 13 }, (_, i) => ({
      ago: 5 + i * 14,
      description: "HUMM SMILE DENTAL",
      amount: -45,
      category: "bnpl",
    })),
    ...monthly(6, 8, {
      description: "SOCIETYONE HOSPITAL PARKING",
      amount: -450,
      category: "loan_repayment",
    }),
  ];
  const x = applicant(lines);
  const input = {
    feed: x.feed,
    feed_type: "cdr" as const,
    as_of: AS_OF,
    lookback_months: 6,
    categories: x.categories,
  };
  const outputs: [string, unknown][] = [
    ["observed living expenses", expensesOf(x)],
    ["evidence", assessEvidence(input)],
    ["INC", assessInc(input as Parameters<typeof assessInc>[0])],
    ["LIA", assessLia({ ...input, application: { declared_liabilities: [] } })],
    [
      "LIA, with declarations",
      assessLia({
        ...input,
        application: {
          declared_liabilities: [
            { type: "loan", provider: "Macquarie", repayment_monthly: 300 },
            { type: "bnpl", provider: "Humm", repayment_monthly: 97 },
          ],
        },
      }),
    ],
    [
      "observed income",
      deriveIncome({ ...input, min_occurrences: 3 } as Parameters<typeof deriveIncome>[0]),
    ],
  ];
  it.each(outputs)("%s: no sensitive keyword anywhere in its text", (_name, out) => {
    const text = JSON.stringify(out);
    expect(text.match(KEYWORDS)?.[0] ?? null).toBeNull();
  });
  it("the check isn't vacuous: LIA finds every lender and names it", () => {
    const text = JSON.stringify(outputs.find(([n]) => n === "LIA")?.[1]);
    for (const lender of ["MACQUARIE", "NIMBLE", "BEFOREPAY", "HARMONEY", "HUMM", "SOCIETYONE"])
      expect(text, lender).toContain(lender);
    expect(JSON.stringify(x)).toMatch(KEYWORDS);
  });
});
