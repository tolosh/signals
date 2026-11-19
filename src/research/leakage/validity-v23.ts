// SIG-63: validity checks V7, V9, V10 and V11 of T7 on set v2.3, as pre-registered in
// research/preregistrations/SIG-63.json (validity_checks_added). V8 (reserved names invented, by
// the ASIC check record) is checked by test/research/v23/reserved-names.test.ts. V1 to V6 are
// SIG-60's, unchanged, in validity.ts.
import type { GeneratedApplicant } from "../generator/index.js";
import { genuinelyDifferent, type Check } from "./validity.js";

type Truth = GeneratedApplicant["truth"];
type V23Liability = {
  id: string;
  lender: string;
  lender_id?: string;
  declared_as: string | null;
  unseen_lender: boolean;
  repayment_transaction_ids: string[];
  declaration?: { different: boolean; descriptor: boolean } | null;
};
type V23Extras = {
  drift?: {
    mode: string;
    alias: string;
    descriptors?: string[];
    transaction_ids: string[];
    pair_transaction_ids?: string[];
  } | null;
  bpay?: { transaction_id: string | null; biller_code: string; kind: string }[];
  liabilities?: V23Liability[];
};
const extras = (t: Truth) => (t.v2 ?? {}) as unknown as V23Extras;
const linesOf = (a: GeneratedApplicant) => a.feed.accounts.flatMap((acc) => acc.transactions);

/** Pearson chi-squared of a contingency table (rows by columns), with its degrees of freedom. */
export function chiSquared(table: number[][]): { x2: number; df: number } {
  const rows = table.map((r) => r.reduce((a, b) => a + b, 0));
  const cols = (table[0] ?? []).map((_, j) => table.reduce((a, r) => a + (r[j] ?? 0), 0));
  const n = rows.reduce((a, b) => a + b, 0);
  let x2 = 0;
  table.forEach((r, i) =>
    r.forEach((o, j) => {
      const e = ((rows[i] ?? 0) * (cols[j] ?? 0)) / n;
      if (e > 0) x2 += (o - e) ** 2 / e;
    }),
  );
  const df = (rows.filter((x) => x > 0).length - 1) * (cols.filter((x) => x > 0).length - 1);
  return { x2, df };
}
/** Upper 0.05 quantiles of chi-squared, by degrees of freedom. */
const CHI2_95: Record<number, number> = { 1: 3.841, 2: 5.991, 3: 7.815, 4: 9.488, 6: 12.592 };
const pAbove05 = ({ x2, df }: { x2: number; df: number }) =>
  df <= 0 || x2 < (CHI2_95[df] ?? Infinity);

/**
 * V7: every drift-tagged applicant has at least one drift line, and the pool excludes applicants
 * whose salary goes to an unshared account or whose history is too short for a split (1 month).
 */
export function driftLines(set: GeneratedApplicant[]): Check {
  let tagged = 0;
  let noLine = 0;
  let excluded = 0;
  let missing = 0;
  for (const a of set) {
    if (!a.truth.tags.some((t) => t.startsWith("drift-"))) continue;
    tagged++;
    const d = extras(a.truth).drift;
    const ids = new Set(linesOf(a).map((t) => t.transactionId));
    if (!d || d.transaction_ids.length === 0 || (d.pair_transaction_ids ?? []).length === 0)
      noLine++;
    for (const id of [...(d?.transaction_ids ?? []), ...(d?.pair_transaction_ids ?? [])])
      if (!ids.has(id)) missing++;
    if (!a.truth.coverage.salary_account_shared || a.truth.history.months < 3) excluded++;
  }
  return {
    id: "V7-drift-lines",
    pass: tagged > 0 && noLine === 0 && excluded === 0 && missing === 0,
    detail: {
      drift_tagged: tagged,
      without_drift_line: noLine,
      unshared_or_short: excluded,
      ids_not_in_feed: missing,
    },
  };
}

/** The alias part of a (lender, alias) pair: case, punctuation and spacing don't make a new one. */
export const aliasKey = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

/**
 * V9: no (lender, alias) pair is used by more than 4 natural-form declarations (declared names
 * that genuinely differ from the feed's lender, SIG-60's rule), and there are at least 200
 * distinct pairs.
 */
export function aliasRepeats(set: GeneratedApplicant[], cap = 4, minPairs = 200): Check {
  const pairs = new Map<string, number>();
  let natural = 0;
  for (const a of set)
    for (const l of extras(a.truth).liabilities ?? []) {
      if (!l.declared_as || !genuinelyDifferent(l.declared_as, l.lender)) continue;
      natural++;
      const key = `${l.lender_id ?? l.lender}|${aliasKey(l.declared_as)}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
  const max = Math.max(0, ...pairs.values());
  return {
    id: "V9-alias-repeats",
    pass: max <= cap && pairs.size >= minPairs,
    detail: { natural_form_declarations: natural, distinct_pairs: pairs.size, max_repeats: max },
  };
}

/**
 * V10: descriptor words on declared names are drawn independently of the same/different flag:
 * chi-squared on the descriptor-present by flag table, p > 0.05.
 */
export function descriptorWords(set: GeneratedApplicant[]): Check {
  const t = [
    [0, 0],
    [0, 0],
  ];
  for (const a of set)
    for (const l of extras(a.truth).liabilities ?? []) {
      const d = l.declaration;
      if (!d) continue;
      const row = t[d.different ? 1 : 0] as number[];
      row[d.descriptor ? 1 : 0] = (row[d.descriptor ? 1 : 0] ?? 0) + 1;
    }
  const c = chiSquared(t);
  const flat = t.flat();
  return {
    id: "V10-descriptor-words",
    pass: flat.every((x) => x > 0) && pAbove05(c),
    detail: {
      same_without: flat[0] ?? 0,
      same_with: flat[1] ?? 0,
      different_without: flat[2] ?? 0,
      different_with: flat[3] ?? 0,
      chi_squared: Math.round(c.x2 * 1000) / 1000,
    },
  };
}

/** The code-length bins V11 compares: at most 4 digits, 5, and 6 or more. */
const lengthBin = (code: string) => (code.length <= 4 ? 0 : code.length === 5 ? 1 : 2);

/**
 * V11: bill, lender and unseen-lender billers draw codes from one distribution (their code-length
 * distributions don't differ: chi-squared, p > 0.05), and no code is shared by two biller names
 * (a bank may show the registered name cut short, so every name on a code is a prefix of one).
 */
export function codeDistribution(set: GeneratedApplicant[]): Check {
  const kindOf = new Map<string, "bill" | "lender" | "unseen">();
  const names = new Map<string, Set<string>>();
  for (const a of set) {
    const x = extras(a.truth);
    const unseenIds = new Set(
      (x.liabilities ?? [])
        .filter((l) => l.unseen_lender)
        .flatMap((l) => l.repayment_transaction_ids),
    );
    for (const b of x.bpay ?? []) {
      const kind =
        b.kind === "bill"
          ? "bill"
          : b.transaction_id && unseenIds.has(b.transaction_id)
            ? "unseen"
            : "lender";
      kindOf.set(b.biller_code, kind);
    }
    for (const t of linesOf(a))
      if (t.billerCode) {
        let s = names.get(t.billerCode);
        if (!s) names.set(t.billerCode, (s = new Set()));
        s.add(t.billerName ?? "");
      }
  }
  const table = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const rowOf = { bill: 0, lender: 1, unseen: 2 } as const;
  for (const [code, kind] of kindOf) {
    const row = table[rowOf[kind]] as number[];
    const bin = lengthBin(code);
    row[bin] = (row[bin] ?? 0) + 1;
  }
  const c = chiSquared(table);
  let shared = 0;
  for (const s of names.values()) {
    const longest = [...s].sort((x, y) => y.length - x.length)[0] ?? "";
    if ([...s].some((n) => !longest.startsWith(n))) shared++;
  }
  const leadingZero = [...names.keys()].filter((c2) => c2.startsWith("0")).length;
  return {
    id: "V11-code-distribution",
    pass: pAbove05(c) && shared === 0 && leadingZero === 0,
    detail: {
      bill_codes: table[0]?.reduce((a, b) => a + b, 0) ?? 0,
      lender_codes: table[1]?.reduce((a, b) => a + b, 0) ?? 0,
      unseen_lender_codes: table[2]?.reduce((a, b) => a + b, 0) ?? 0,
      chi_squared: Math.round(c.x2 * 1000) / 1000,
      df: c.df,
      codes_with_two_names: shared,
      leading_zero: leadingZero,
    },
  };
}

export const validityChecksV23 = (set: GeneratedApplicant[]): Check[] => [
  driftLines(set),
  aliasRepeats(set),
  descriptorWords(set),
  codeDistribution(set),
];
