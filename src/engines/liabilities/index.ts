// Hidden liabilities from transactions and the account list (SIG-18, H2; LIA-01 is built on it in
// SIG-42). The method is pre-registered in research/preregistrations/SIG-18.json:
//   (a) card and loan accounts in the grant are liabilities;
//   (b) lender outflows are found by Enrich category, or a BPAY biller naming a credit card;
//   (c) a group of outflows to one provider is a liability when it recurs in amount and cadence.
// A liability that matches no declared one of the same family and provider is undisclosed.
//   (d) 1.1.0 (SIG-83, research/preregistrations/SIG-83.json): when asked (step_d), a regular
//       repayment to a lender on LENDER_NAMES is found whatever its Enrich category. Off, the
//       detector is 1.0.0 exactly, as SIG-18 and SIG-57 call it.
// Pure: categories and declarations are inputs; no clock, no randomness, relative imports (D3).
import { listedLenderOf } from "../lender-match.js";

export type LiabilityTransaction = {
  accountId: string;
  transactionId: string;
  type: string;
  description: string;
  postingDateTime?: string;
  valueDateTime?: string;
  amount: string;
  billerName?: string;
};
export type LiabilityFeed = {
  accounts: {
    account: { accountId: string; productCategory?: string; productName?: string };
    transactions: LiabilityTransaction[];
  }[];
};
export type DeclaredLiability = { type: string; provider: string; repayment_monthly?: number };
export type LiabilityInput = {
  feed: LiabilityFeed;
  /** Enrich category by transaction id. */
  categories: Readonly<Record<string, string>>;
  declared: readonly DeclaredLiability[];
  /** End of the window, inclusive (YYYY-MM-DD). */
  as_of: string;
  min_occurrences: number;
  /** A debit recurs when within this fraction of the group's median amount. */
  amount_tolerance: number;
  /**
   * SIG-83's step (d), off when absent. "any" is the rule: a candidate in any category but
   * transfer. "liability_only" reads only the liability categories, and is the mutation (T6).
   */
  step_d?: { categories: "any" | "liability_only" };
};
export type Family = "credit_card" | "loan" | "bnpl" | "sacc" | "wage_advance";
export type Cadence = "weekly" | "fortnightly" | "monthly";
export type DetectedLiability = {
  family: Family;
  provider: string;
  /** How it was found: its account is in the grant, its repayments recur, or both. */
  sources: ("account" | "outflow")[];
  cadence: Cadence | null;
  occurrences: number;
  median_amount: number | null;
  monthly: number | null;
  /** The recurring repayments' transaction IDs, sorted. */
  evidence: string[];
  account_ids: string[];
  declared: boolean;
};
export type LiabilityResult = {
  liabilities: DetectedLiability[];
  undisclosed: DetectedLiability[];
};

export const LIABILITY_METHOD_VERSION = "1.0.0";
/** The detector with step (d) on (SIG-83). */
export const LIABILITY_METHOD_VERSION_STEP_D = "1.1.0";

const CREDIT_CATEGORIES: Record<string, Family> = {
  loan_repayment: "loan",
  bnpl: "bnpl",
  sacc_loan: "sacc",
  wage_advance: "wage_advance",
};
const TYPE_FAMILY: Record<string, Family> = {
  credit_card: "credit_card",
  car_loan: "loan",
  personal_loan: "loan",
  loan: "loan",
  bnpl: "bnpl",
  sacc: "sacc",
  wage_advance: "wage_advance",
};
const CADENCE_BANDS: [Cadence, number, number, number][] = [
  ["weekly", 5, 9, 52 / 12],
  ["fortnightly", 12, 16, 26 / 12],
  ["monthly", 26, 35, 1],
];
const DROP_WORDS = new Set([
  "LOAN",
  "REPAYMENT",
  "REPAYMENTS",
  "INSTALMENT",
  "PAYMENT",
  "CREDIT",
  "CARD",
  "PTY",
  "LTD",
  "BPAY",
]);
const BSB_NUMBER = /\b\d{3}-?\d{3}\s+\d{6,10}\b/;
const DAY_MS = 86_400_000;
const dayOf = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);
const round2 = (x: number) => Math.round(x * 100) / 100;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

/** Upper case; digits and punctuation removed; the pre-registered generic words dropped. */
export function normaliseProvider(text: string): string {
  return text
    .toUpperCase()
    .replace(/\d/g, "")
    .replace(/[^A-Z ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !DROP_WORDS.has(w))
    .join(" ");
}

const familyOfType = (type: string): Family | undefined => TYPE_FAMILY[type];
/** A card or loan account's provider, from its product name (exported for LIA's display). */
export const accountProvider = (productName: string) =>
  normaliseProvider(productName.replace(/\s*(credit card|car loan|personal loan)\s*$/i, ""));

type Outflow = { id: string; accountId: string; day: number; amount: number };

/** SIG-83's step (d) cut-offs, pre-registered; not LIA's configurable ones. */
const STEP_D = { min_occurrences: 3, amount_tolerance: 0.05 } as const;
const PER_MONTH: Record<Cadence, number> = { weekly: 52 / 12, fortnightly: 26 / 12, monthly: 1 };
/** A day number's civil date (days from 1970-01-01, proleptic Gregorian; no clock read). */
const civilOf = (day: number): [number, number, number] => {
  const z = day + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
};
const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const monthDays = (y: number, m: number) =>
  m === 2 ? (leap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
/** The same day of the next calendar month, clamped to that month's last day. */
const nextMonthDay = (day: number): number => {
  const [y, m, d] = civilOf(day);
  const days = monthDays(y, m);
  const nd = Math.min(d, monthDays(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1));
  return day + (days - d) + nd;
};
/** The band an interval falls in, or null. */
const bandOf = (from: number, to: number): Cadence | null => {
  const gap = to - from;
  if (gap >= 4 && gap <= 10) return "weekly";
  if (gap >= 11 && gap <= 17) return "fortnightly";
  if (Math.abs(to - nextMonthDay(from)) <= 3) return "monthly";
  return null;
};

export function detectLiabilities(input: LiabilityInput): LiabilityResult {
  const end = dayOf(input.as_of);
  const found = new Map<string, DetectedLiability>();
  const key = (family: Family, provider: string) => `${family}|${provider}`;
  const entry = (family: Family, provider: string): DetectedLiability => {
    const k = key(family, provider);
    let d = found.get(k);
    if (!d) {
      d = {
        family,
        provider,
        sources: [],
        cadence: null,
        occurrences: 0,
        median_amount: null,
        monthly: null,
        evidence: [],
        account_ids: [],
        declared: false,
      };
      found.set(k, d);
    }
    return d;
  };

  // (a) card and loan accounts in the grant.
  const groups = new Map<string, { family: Family; provider: string; outflows: Outflow[] }>();
  // (d) candidates: debits step (b) doesn't read as lender outflows, by family and listed name.
  const named = new Map<string, { family: Family; provider: string; outflows: Outflow[] }>();
  for (const { account, transactions } of input.feed.accounts) {
    const category = account.productCategory ?? "TRANS_AND_SAVINGS_ACCOUNTS";
    if (category === "CRED_AND_CHRG_CARDS" || category === "PERS_LOANS") {
      const family: Family = category === "CRED_AND_CHRG_CARDS" ? "credit_card" : "loan";
      const d = entry(family, accountProvider(account.productName ?? ""));
      if (!d.sources.includes("account")) d.sources.push("account");
      d.account_ids.push(account.accountId);
      continue;
    }
    if (category !== "TRANS_AND_SAVINGS_ACCOUNTS") continue;
    // (b) lender outflows in shared transaction accounts.
    for (const t of transactions) {
      const amount = Number(t.amount);
      const day = dayOf(t.postingDateTime ?? t.valueDateTime ?? "");
      if (!(amount < 0) || Number.isNaN(day) || day > end) continue;
      if (BSB_NUMBER.test(t.description)) continue;
      let family: Family | undefined = CREDIT_CATEGORIES[input.categories[t.transactionId] ?? ""];
      let provider = family ? normaliseProvider(t.description) : "";
      const biller = t.billerName ?? "";
      const card = /^(.*?)CREDIT CARD/i.exec(biller);
      if (!family && card) {
        family = "credit_card";
        provider = normaliseProvider(card[1] ?? "");
      }
      if (!family && input.step_d) {
        const category = input.categories[t.transactionId] ?? "";
        const allowed =
          input.step_d.categories === "any"
            ? category !== "transfer"
            : CREDIT_CATEGORIES[category] !== undefined;
        const lender = allowed ? (listedLenderOf(t.description) ?? listedLenderOf(biller)) : null;
        if (lender) {
          const f: Family = /\bCARD\b/i.test(`${t.description} ${biller}`) ? "credit_card" : "loan";
          const k = key(f, lender);
          const g = named.get(k) ?? { family: f, provider: lender, outflows: [] };
          g.outflows.push({ id: t.transactionId, accountId: t.accountId, day, amount: -amount });
          named.set(k, g);
        }
      }
      if (!family || provider === "") continue;
      const k = key(family, provider);
      const g = groups.get(k) ?? { family, provider, outflows: [] };
      g.outflows.push({ id: t.transactionId, accountId: t.accountId, day, amount: -amount });
      groups.set(k, g);
    }
  }

  // (c) recurrence: enough debits near the median amount, at a known cadence.
  for (const g of groups.values()) {
    const m = median(g.outflows.map((o) => o.amount));
    const near = g.outflows
      .filter((o) => Math.abs(o.amount - m) <= input.amount_tolerance * m + 1e-9)
      .sort((a, b) => a.day - b.day || (a.id < b.id ? -1 : 1));
    if (near.length < input.min_occurrences || near.length < 2) continue;
    const gaps = near.slice(1).map((o, i) => o.day - (near[i] as Outflow).day);
    const gap = median(gaps);
    const band = CADENCE_BANDS.find(([, lo, hi]) => gap >= lo && gap <= hi);
    if (!band) continue;
    const d = entry(g.family, g.provider);
    if (!d.sources.includes("outflow")) d.sources.push("outflow");
    const amount = median(near.map((o) => o.amount));
    d.cadence = band[0];
    d.occurrences = near.length;
    d.median_amount = round2(amount);
    d.monthly = round2(amount * band[3]);
    d.evidence = near.map((o) => o.id).sort();
    for (const o of near) if (!d.account_ids.includes(o.accountId)) d.account_ids.push(o.accountId);
  }

  // (d) SIG-83's recurrence: 3 or more debits within 5% of the group's median, every interval in
  // one band (7 ± 3 days, 14 ± 3, or the same day of the next calendar month ± 3). A family and
  // lender already found by (a) to (c) adds nothing.
  for (const g of named.values()) {
    if (found.has(key(g.family, g.provider))) continue;
    const m = median(g.outflows.map((o) => o.amount));
    const near = g.outflows
      .filter((o) => Math.abs(o.amount - m) <= STEP_D.amount_tolerance * m + 1e-9)
      .sort((a, b) => a.day - b.day || (a.id < b.id ? -1 : 1));
    if (near.length < STEP_D.min_occurrences) continue;
    const bands = near.slice(1).map((o, i) => bandOf((near[i] as Outflow).day, o.day));
    const band = bands[0];
    if (band === null || band === undefined || bands.some((b) => b !== band)) continue;
    const d = entry(g.family, g.provider);
    d.sources.push("outflow");
    const amount = median(near.map((o) => o.amount));
    d.cadence = band;
    d.occurrences = near.length;
    d.median_amount = round2(amount);
    d.monthly = round2(amount * PER_MONTH[band]);
    d.evidence = near.map((o) => o.id).sort();
    for (const o of near) if (!d.account_ids.includes(o.accountId)) d.account_ids.push(o.accountId);
  }

  const declared = new Set(
    input.declared.flatMap((l) => {
      const family = familyOfType(l.type);
      return family ? [key(family, normaliseProvider(l.provider))] : [];
    }),
  );
  const liabilities = [...found.values()]
    .map((d) => ({
      ...d,
      sources: (["account", "outflow"] as const).filter((s) => d.sources.includes(s)),
      account_ids: [...d.account_ids].sort(),
      declared: declared.has(key(d.family, d.provider)),
    }))
    .sort((a, b) => (key(a.family, a.provider) < key(b.family, b.provider) ? -1 : 1));
  return { liabilities, undisclosed: liabilities.filter((d) => !d.declared) };
}
