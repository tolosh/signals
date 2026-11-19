// SIG-57 (H2): SIG-18's detector with the alias table (research/preregistrations/SIG-57.json,
// arms.treatment and method). Steps (a) and (c) are SIG-18's; lender identity comes from the
// table, a biller name can name the lender, and disclosure is by name, or by name then amount.
// No biller code is read (D-L4-1, T7). detectLiabilities 1.0.0 and LIA are unchanged.
// Pure: no clock, no randomness, relative imports (D3).
import type { DeclaredLiability, LiabilityInput } from "../../engines/liabilities/index.js";
import { bestPairing, type Edge } from "../../engines/families/lia/pairing.js";
import { resolve, type AliasIndex } from "./aliases.js";

export const SIG57_DETECTOR_VERSION = "1.0.0";

export type Family57 = "credit_card" | "loan" | "mortgage" | "bnpl" | "sacc" | "wage_advance";
export const FAMILIES: readonly Family57[] = [
  "credit_card",
  "loan",
  "mortgage",
  "bnpl",
  "sacc",
  "wage_advance",
];
export const CATEGORY_FAMILY: Readonly<Record<string, Family57>> = {
  loan_repayment: "loan",
  mortgage: "mortgage",
  bnpl: "bnpl",
  sacc_loan: "sacc",
  wage_advance: "wage_advance",
};
export const TYPE_FAMILY: Readonly<Record<string, Family57>> = {
  credit_card: "credit_card",
  car_loan: "loan",
  personal_loan: "loan",
  loan: "loan",
  mortgage: "mortgage",
  bnpl: "bnpl",
  sacc: "sacc",
  wage_advance: "wage_advance",
};
const ACCOUNT_FAMILY: Readonly<Record<string, Family57>> = {
  CRED_AND_CHRG_CARDS: "credit_card",
  PERS_LOANS: "loan",
  RESIDENTIAL_MORTGAGES: "mortgage",
};
export const CADENCE_BANDS: ["weekly" | "fortnightly" | "monthly", number, number, number][] = [
  ["weekly", 5, 9, 52 / 12],
  ["fortnightly", 12, 16, 26 / 12],
  ["monthly", 26, 35, 1],
];
export const BSB_NUMBER = /\b\d{3}-?\d{3}\s+\d{6,10}\b/;
const DAY_MS = 86_400_000;
export const dayOf = (iso: string) =>
  Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);
const round2 = (x: number) => Math.round(x * 100) / 100;
export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

export type Disclosure =
  { disclosure: "name_only" } | { disclosure: "amount_assisted"; tolerance: number };
export type Detected57 = {
  family: Family57;
  identity: string;
  lender: string | null;
  sources: ("account" | "outflow")[];
  cadence: "weekly" | "fortnightly" | "monthly" | null;
  occurrences: number;
  median_amount: number | null;
  monthly: number | null;
  evidence: string[];
  account_ids: string[];
  declared: boolean;
  disclosed_by: "name" | "amount" | null;
};

type Txn = LiabilityInput["feed"]["accounts"][number]["transactions"][number];

/** A debit's lender family and identity under the treatment's step (b), or null. */
export function classifyOutflow(
  t: Txn,
  categories: Readonly<Record<string, string>>,
  index: AliasIndex,
): { family: Family57; identity: string; lender: string | null } | null {
  const byCategory = CATEGORY_FAMILY[categories[t.transactionId] ?? ""];
  if (byCategory) {
    const r = resolve(t.description, index);
    return r.identity === "" ? null : { family: byCategory, ...r };
  }
  const biller = t.billerName ?? "";
  if (biller === "") return null;
  const r = resolve(biller, index);
  if (!r.lender) return null;
  if (/CARD/i.test(biller)) return { family: "credit_card", ...r };
  const own = (index.families.get(r.lender) ?? []).filter((f): f is Family57 =>
    FAMILIES.includes(f as Family57),
  );
  return own.length === 1 ? { family: own[0] as Family57, ...r } : null;
}

const accountName = (productName: string) =>
  productName.replace(/\s*(credit card|car loan|personal loan|home loan|mortgage)\s*$/i, "");

export function detectWithAliases(
  input: LiabilityInput,
  index: AliasIndex,
  opts: Disclosure,
): { liabilities: Detected57[]; undisclosed: Detected57[] } {
  const end = dayOf(input.as_of);
  const found = new Map<string, Detected57>();
  const key = (f: Family57, identity: string) => `${f}|${identity}`;
  const entry = (family: Family57, r: { identity: string; lender: string | null }) => {
    const k = key(family, r.identity);
    let d = found.get(k);
    if (!d) {
      d = {
        family,
        identity: r.identity,
        lender: r.lender,
        sources: [],
        cadence: null,
        occurrences: 0,
        median_amount: null,
        monthly: null,
        evidence: [],
        account_ids: [],
        declared: false,
        disclosed_by: null,
      };
      found.set(k, d);
    }
    return d;
  };

  type Outflow = { id: string; accountId: string; day: number; amount: number };
  const groups = new Map<
    string,
    { family: Family57; r: { identity: string; lender: string | null }; outflows: Outflow[] }
  >();
  for (const { account, transactions } of input.feed.accounts) {
    const category = account.productCategory ?? "TRANS_AND_SAVINGS_ACCOUNTS";
    const accountFamily = ACCOUNT_FAMILY[category];
    if (accountFamily) {
      const d = entry(accountFamily, resolve(accountName(account.productName ?? ""), index));
      if (!d.sources.includes("account")) d.sources.push("account");
      d.account_ids.push(account.accountId);
      continue;
    }
    if (category !== "TRANS_AND_SAVINGS_ACCOUNTS") continue;
    for (const t of transactions) {
      const amount = Number(t.amount);
      const day = dayOf(t.postingDateTime ?? t.valueDateTime ?? "");
      if (!(amount < 0) || Number.isNaN(day) || day > end) continue;
      if (BSB_NUMBER.test(t.description)) continue;
      const c = classifyOutflow(t, input.categories, index);
      if (!c) continue;
      const k = key(c.family, c.identity);
      const g = groups.get(k) ?? { family: c.family, r: c, outflows: [] };
      g.outflows.push({ id: t.transactionId, accountId: t.accountId, day, amount: -amount });
      groups.set(k, g);
    }
  }

  for (const g of groups.values()) {
    const m = median(g.outflows.map((o) => o.amount));
    const near = g.outflows
      .filter((o) => Math.abs(o.amount - m) <= input.amount_tolerance * m + 1e-9)
      .sort((a, b) => a.day - b.day || (a.id < b.id ? -1 : 1));
    if (near.length < input.min_occurrences || near.length < 2) continue;
    const gap = median(near.slice(1).map((o, i) => o.day - (near[i] as Outflow).day));
    const band = CADENCE_BANDS.find(([, lo, hi]) => gap >= lo && gap <= hi);
    if (!band) continue;
    const d = entry(g.family, g.r);
    if (!d.sources.includes("outflow")) d.sources.push("outflow");
    const amount = median(near.map((o) => o.amount));
    d.cadence = band[0];
    d.occurrences = near.length;
    d.median_amount = round2(amount);
    d.monthly = round2(amount * band[3]);
    d.evidence = near.map((o) => o.id).sort();
    for (const o of near) if (!d.account_ids.includes(o.accountId)) d.account_ids.push(o.accountId);
  }

  const liabilities = [...found.values()]
    .map((d) => ({
      ...d,
      sources: (["account", "outflow"] as const).filter((s) => d.sources.includes(s)),
      account_ids: [...d.account_ids].sort(),
    }))
    .sort((a, b) => (key(a.family, a.identity) < key(b.family, b.identity) ? -1 : 1));
  disclose(liabilities, input.declared, index, opts);
  return { liabilities, undisclosed: liabilities.filter((d) => !d.declared) };
}

/** Name-only: same family and identity. Amount-assisted: then a best pairing by amount. */
function disclose(
  found: Detected57[],
  declared: readonly DeclaredLiability[],
  index: AliasIndex,
  opts: Disclosure,
) {
  const decl = declared.map((l) => ({
    family: TYPE_FAMILY[l.type],
    identity: resolve(l.provider, index).identity,
    monthly: l.repayment_monthly,
  }));
  const used = new Set<number>();
  for (const d of found) {
    const hits = decl
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => x.family === d.family && x.identity === d.identity);
    if (hits.length === 0) continue;
    d.declared = true;
    d.disclosed_by = "name";
    for (const { i } of hits) used.add(i);
  }
  if (opts.disclosure !== "amount_assisted") return;
  const left = found.filter((d) => !d.declared && d.monthly !== null);
  const right = decl.map((x, i) => ({ x, i })).filter(({ i, x }) => !used.has(i) && x.monthly);
  const edges: Edge[] = [];
  left.forEach((d, l) =>
    right.forEach(({ x }, r) => {
      const diff = Math.abs((x.monthly as number) - (d.monthly as number));
      if (x.family === d.family && diff <= opts.tolerance * (d.monthly as number) + 1e-9)
        edges.push({ left: l, right: r, cost: Math.round(diff * 100) });
    }),
  );
  for (const p of bestPairing(left.length, right.length, edges)) {
    const d = left[p.left] as Detected57;
    d.declared = true;
    d.disclosed_by = "amount";
  }
}
