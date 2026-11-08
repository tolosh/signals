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
import { deriveIncome } from "../../src/engines/affordability/income.js";
import { deriveObservedExpenses } from "../../src/engines/affordability/observed-expenses.js";
import { dayOf, isoOf } from "../../src/engines/evidence/dates.js";
import { assessEvidence } from "../../src/engines/evidence/index.js";
import { assessInc } from "../../src/engines/families/inc/index.js";
import { assessLia } from "../../src/engines/families/lia/index.js";
import {
  SENSITIVE_CATEGORIES,
  SENSITIVE_MCCS,
  isSensitive,
  withoutSensitive,
} from "../../src/engines/sensitive.js";

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
});

describe("G-1, pending ruling: observed living expenses still count Enrich's healthcare (AF-E1)", () => {
  it("is the one engine whose output moves with a healthcare debit, and only by that debit", () => {
    const run = (x: typeof base) =>
      deriveObservedExpenses({
        feed: x.feed,
        categories: x.categories,
        as_of: AS_OF,
        lookback_months: 6,
        one_off_threshold_aud: 5000,
      });
    const withHealth = applicant(SENSITIVE.filter((l) => l.category === "healthcare"));
    expect(run(withHealth).basic_monthly).toBeGreaterThan(run(base).basic_monthly);
    expect(run(withHealth).discretionary_monthly).toBe(run(base).discretionary_monthly);
  });
});

describe("GR-3 static scan: modules under src/engines/ that read transactions", () => {
  /** Reads transactions without the gate, on purpose. Adding to this list needs a reason. */
  const UNGATED: Record<string, string> = {
    "engines/sensitive.ts": "the gate itself",
    "engines/liabilities/index.ts":
      "SIG-18's detector at 1.0.0, unchanged; LIA-01 calls it with the gated feed",
    "engines/families/inc/streams.ts": "called only by assessInc, with the gated feed",
    "engines/affordability/observed-expenses.ts":
      "G-1, pending ruling: AF-E1 counts health in living expenses",
  };
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
    });
  const readers = files("src/engines")
    .map((p) => p.replace(/\\/g, "/").replace(/^src\//, ""))
    .filter((p) => /\.transactions\b/.test(readFileSync(`src/${p}`, "utf8")));

  it("every reader not on the list imports and applies withoutSensitive", () => {
    const ungated = readers.filter((p) => {
      const text = readFileSync(`src/${p}`, "utf8");
      return (
        !/import[^;]*\bwithoutSensitive\b[^;]*sensitive\.js/.test(text) ||
        !/withoutSensitive\(/.test(text)
      );
    });
    expect(ungated.sort()).toEqual(Object.keys(UNGATED).sort());
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
