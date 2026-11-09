// SIG-60: the validity checks of T7, pre-registered with the leakage test
// (research/preregistrations/SIG-60.json). Each is a review finding that isn't a label leaking
// through a feature: a group too small to test what it claims, an event that couldn't happen in a
// real feed, or a fee schedule no bank has.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { GeneratedApplicant, Transaction } from "../generator/index.js";

const DAY = 86_400_000;
const dayOf = (t: Transaction) => Math.floor(Date.parse(t.postingDateTime ?? "") / DAY);
const amt = (t: Transaction) => Number(t.amount);
const cents = (t: Transaction) => Math.round(Math.abs(amt(t)) * 100);

/** National public holidays observed by every Australian bank, November 2025 to October 2026. */
export const NATIONAL_HOLIDAYS = [
  "2025-12-25",
  "2025-12-26",
  "2026-01-01",
  "2026-01-26",
  "2026-04-03",
  "2026-04-06",
  "2026-04-25",
];
const holidays = new Set(NATIONAL_HOLIDAYS.map((d) => Date.parse(d) / DAY));
export const isBankingDay = (day: number) => {
  const wd = ((day % 7) + 7 + 4) % 7;
  return wd !== 0 && wd !== 6 && !holidays.has(day);
};
/** Banking days strictly after `from`, up to and including `to`. */
export const bankingDaysBetween = (from: number, to: number) => {
  let n = 0;
  for (let d = from + 1; d <= to; d++) if (isBankingDay(d)) n++;
  return n;
};

const SUFFIX_WORDS = new Set([
  "PTY",
  "LTD",
  "LIMITED",
  "GROUP",
  "CORPORATION",
  "CORP",
  "CO",
  "INC",
  "CREDIT",
  "CARD",
  "CARDS",
  "PERSONAL",
  "CAR",
  "HOME",
  "LOAN",
  "LOANS",
  "MORTGAGE",
]);
const words = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !SUFFIX_WORDS.has(w));
/**
 * A declared name genuinely differs from the feed's lender when it can't be reduced to it by case,
 * spacing, punctuation, company suffixes or loan-type words ("After Pay" and "AFTERPAY Pty Ltd"
 * don't; "Commonwealth Bank" for CBA, "RateSetter" for PLENTI and an abbreviation do).
 */
export function genuinelyDifferent(declared: string, lender: string): boolean {
  const a = words(declared).join("");
  const b = words(lender).join("");
  if (!a || !b) return false;
  return !(a.includes(b) || b.includes(a));
}

type Truth = GeneratedApplicant["truth"];
type Extras = {
  drift?: { mode: string; alias: string; transaction_ids: string[] } | null;
  dishonour_lines?: { debit: string; returned: string; fee: string | null }[];
  declared_link?: (string | null)[];
};
const extras = (t: Truth) => (t.v2 ?? {}) as unknown as Extras;
const linesOf = (a: GeneratedApplicant) => a.feed.accounts.flatMap((acc) => acc.transactions);

export type Check = { id: string; pass: boolean; detail: Record<string, number | string> };

/** V1: at least 20 distinct (employer, drifted descriptor) pairs across the drift groups. */
export function driftPairs(set: GeneratedApplicant[]): Check {
  const pairs = new Set<string>();
  for (const a of set) {
    if (!a.truth.tags.some((t) => t.startsWith("drift-"))) continue;
    const employer = a.truth.v2?.payers[0]?.payer ?? "";
    const listed = extras(a.truth).drift;
    if (listed) {
      pairs.add(`${employer}|${listed.alias}`);
      continue;
    }
    for (const alias of a.truth.v2?.payers[0]?.aliases ?? [])
      if (!alias.startsWith("SALARY ")) pairs.add(`${employer}|${alias}`);
  }
  return { id: "V1-drift-pairs", pass: pairs.size >= 20, detail: { distinct_pairs: pairs.size } };
}

/** V2: at least 70% of the natural-declarations group's declared names genuinely differ. */
export function naturalForms(set: GeneratedApplicant[]): Check {
  let n = 0;
  let different = 0;
  let inOtherNarratives = 0;
  const narratives = set.map((a) =>
    linesOf(a)
      .map((t) => words(`${t.description} ${t.billerName ?? ""}`).join(""))
      .join("\n"),
  );
  set.forEach((a, k) => {
    if (!a.truth.tags.includes("natural-declarations")) return;
    const lenders = new Map((a.truth.v2?.liabilities ?? []).map((l) => [l.id, l.lender]));
    const declaredIds = a.truth.liabilities.items.filter((l) => l.declared).map((l) => l.id);
    const links = extras(a.truth).declared_link ?? declaredIds;
    a.application.declared_liabilities.forEach((d, i) => {
      const lender = lenders.get(links[i] ?? "") ?? "";
      n++;
      if (genuinelyDifferent(d.provider, lender)) different++;
      const needle = words(d.provider).join("");
      if (needle && narratives.some((text, j) => j !== k && text.includes(needle)))
        inOtherNarratives++;
    });
  });
  const share = n === 0 ? 0 : different / n;
  return {
    id: "V2-natural-forms",
    pass: n > 0 && share >= 0.7,
    detail: {
      declarations: n,
      genuinely_different: different,
      share,
      in_other_narratives: inOtherNarratives,
    },
  };
}

/**
 * V3: every dishonour posts on banking days, as a debit, its return 1 to 3 banking days later in
 * the same account and for the same amount, and the fee on the return's day or up to 2 banking
 * days after.
 */
export function dishonourTiming(set: GeneratedApplicant[]): Check {
  let events = 0;
  let bad = 0;
  for (const a of set) {
    const lines = linesOf(a);
    const byId = new Map(lines.map((t) => [t.transactionId, t]));
    const listed = extras(a.truth).dishonour_lines;
    const feeIds = listed
      ? listed.map((d) => d.fee ?? "")
      : (a.truth.v2?.dishonour_events ?? []).map((e) => e.transaction_id);
    feeIds.forEach((feeId, k) => {
      events++;
      const fee = byId.get(feeId);
      const ok = (() => {
        if (listed) {
          const d = listed[k];
          const debit = byId.get(d?.debit ?? "");
          const ret = byId.get(d?.returned ?? "");
          if (!debit || !ret) return false;
          return timingOk(debit, ret, fee ?? null);
        }
        if (!fee) return false;
        const credits = lines.filter(
          (r) =>
            r.accountId === fee.accountId &&
            amt(r) > 0 &&
            dayOf(r) <= dayOf(fee) &&
            dayOf(fee) - dayOf(r) <= 7,
        );
        return credits.some((r) =>
          lines.some(
            (d) =>
              d.accountId === r.accountId &&
              amt(d) < 0 &&
              cents(d) === cents(r) &&
              dayOf(d) <= dayOf(r) &&
              timingOk(d, r, fee),
          ),
        );
      })();
      if (!ok) bad++;
    });
  }
  return {
    id: "V3-dishonour-timing",
    pass: events > 0 && bad === 0,
    detail: { events, failing: bad },
  };
}
function timingOk(debit: Transaction, ret: Transaction, fee: Transaction | null): boolean {
  const d = dayOf(debit);
  const r = dayOf(ret);
  if (!isBankingDay(d) || !isBankingDay(r)) return false;
  if (cents(debit) !== cents(ret) || debit.accountId !== ret.accountId) return false;
  const gap = bankingDaysBetween(d, r);
  if (gap < 1 || gap > 3) return false;
  if (!fee) return true;
  const f = dayOf(fee);
  return isBankingDay(f) && f >= r && bankingDaysBetween(r, f) <= 2;
}

/** V4: no fee narrative reads "HONOUR FEE" (a dishonour fee shown without its "DIS"). */
export function honourFee(set: GeneratedApplicant[]): Check {
  const n = set.reduce(
    (s, a) =>
      s + linesOf(a).filter((t) => t.type === "FEE" && /\bHONOUR FEE\b/.test(t.description)).length,
    0,
  );
  return { id: "V4-no-honour-fee", pass: n === 0, detail: { honour_fee_lines: n } };
}

/**
 * V5: account-keeping fees are realistic and varied: at least 3 distinct monthly amounts across
 * the set, at least 30% of applicants with none, and at least 20% of those charged with a waived
 * month (a month of their history without the fee).
 */
export function accountFees(set: GeneratedApplicant[]): Check {
  const amounts = new Set<string>();
  let charged = 0;
  let waived = 0;
  for (const a of set) {
    const lines = linesOf(a);
    const months = [...new Set(lines.map((t) => (t.postingDateTime ?? "").slice(0, 7)))].sort();
    const inner = months.slice(1, -1);
    const series = new Map<string, Set<string>>();
    for (const t of lines.filter(
      (t) => t.type === "FEE" && /ACCOUNT|MONTHLY|KEEPING|SERVICE/.test(t.description),
    )) {
      const k = t.description;
      let s = series.get(k);
      if (!s) series.set(k, (s = new Set()));
      s.add((t.postingDateTime ?? "").slice(0, 7));
      amounts.add(t.amount);
    }
    const periodic = [...series.values()].filter((s) => s.size >= 2);
    if (periodic.length === 0) continue;
    charged++;
    if (periodic.some((s) => inner.some((m) => !s.has(m)))) waived++;
  }
  const none = 1 - charged / Math.max(1, set.length);
  const waivedShare = charged === 0 ? 0 : waived / charged;
  return {
    id: "V5-account-fees",
    pass: amounts.size >= 3 && none >= 0.3 && waivedShare >= 0.2,
    detail: {
      distinct_amounts: amounts.size,
      share_without: none,
      share_charged_with_waived_month: waivedShare,
    },
  };
}

export const validityChecks = (set: GeneratedApplicant[]): Check[] => [
  driftPairs(set),
  naturalForms(set),
  dishonourTiming(set),
  honourFee(set),
  accountFees(set),
];

/**
 * V6: no unseen-lender name of the set appears in src/ or in a test, outside the research code
 * and tests (the generator, which must name them, and this scan's own fixtures).
 */
export function unseenLendersInCode(names: readonly string[], roots = ["src", "test"]): Check {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|json)$/.test(p) ? [p] : [];
    });
  const scanned = roots
    .flatMap((r) => files(r))
    .map((p) => p.split("\\").join("/"))
    .filter((p) => !p.startsWith("src/research/") && !p.startsWith("test/research/"));
  const hits = new Set<string>();
  for (const p of scanned) {
    const text = readFileSync(p, "utf8");
    for (const n of names)
      if (new RegExp(`(?<![A-Za-z])${n}(?![A-Za-z])`, "i").test(text)) hits.add(n);
  }
  return {
    id: "V6-unseen-lenders",
    pass: hits.size === 0,
    detail: { names: names.length, named_in_code: [...hits].sort().join(", ") },
  };
}
