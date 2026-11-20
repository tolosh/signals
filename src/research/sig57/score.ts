// SIG-57 (H2): scores an arm against ground truth, as pre-registered in
// research/preregistrations/SIG-57.json (metric, arms, runs_in_order, pre_run_amendments). Lender
// identity for scoring is resolved through the alias table the same way in every arm. Records
// carry IDs, families and identities only: never a transaction description.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  detectLiabilities,
  normaliseProvider,
  type DeclaredLiability,
  type LiabilityFeed,
} from "../../engines/liabilities/index.js";
import { generateApplicant, population, serialise } from "../generator/index.js";
import { generateSetV22 } from "../generator/v22/index.js";
import { aliasIndex, resolve, type AliasIndex, type AliasTable } from "./aliases.js";
import {
  BSB_NUMBER,
  CADENCE_BANDS,
  classifyOutflow,
  dayOf,
  detectWithAliases,
  median,
  TYPE_FAMILY,
  type Disclosure,
  type Family57,
} from "./detect.js";

export const ALIAS_TABLE_PATH = "research/aliases/lender-aliases-1.0.0.json";
const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

export function loadAliases() {
  const raw = readFileSync(ALIAS_TABLE_PATH);
  return { index: aliasIndex(JSON.parse(raw.toString("utf8")) as AliasTable), sha256: sha256(raw) };
}

type TruthItem = { id: string; type: string; provider: string; declared: boolean };
type TruthV2 = {
  id: string;
  unseen_lender: boolean;
  biller_cue: boolean;
  paid_from_shared: boolean;
  repayment_transaction_ids: string[];
  account_id?: string;
};
export type Applicant57 = {
  id: string;
  months: number;
  tags: string[];
  feed: LiabilityFeed;
  declared: DeclaredLiability[];
  items: TruthItem[];
  v2: Map<string, TruthV2>;
};
export type LoadedSet = {
  set: string;
  set_sha256: string;
  as_of: string;
  applicants: Applicant57[];
  categories: Record<string, string>;
  categories_file: string;
  categories_sha256: string;
  enrich: { engine_version: string; taxonomy_version: string };
  biller_code_given: boolean;
};

type RawAccount = {
  account: LiabilityFeed["accounts"][number]["account"];
  transactions?: LiabilityFeed["accounts"][number]["transactions"];
  transactionList?: { data: { transactions: LiabilityFeed["accounts"][number]["transactions"] } };
};
type Raw = {
  truth: {
    applicant_id: string;
    tags?: string[];
    history?: { months: number };
    liabilities: { items: unknown[] };
    v2?: { liabilities?: unknown[] };
  };
  application: unknown;
  feed: unknown;
};

function toApplicant(a: Raw): Applicant57 {
  const accounts = (a.feed as { accounts: RawAccount[] }).accounts.map((acc) => ({
    account: acc.account,
    transactions: acc.transactions ?? acc.transactionList?.data.transactions ?? [],
  }));
  return {
    id: a.truth.applicant_id,
    months: a.truth.history?.months ?? 0,
    tags: a.truth.tags ?? [],
    feed: { accounts },
    declared: (a.application as { declared_liabilities: DeclaredLiability[] }).declared_liabilities,
    items: a.truth.liabilities.items as TruthItem[],
    v2: new Map(((a.truth.v2?.liabilities ?? []) as TruthV2[]).map((l) => [l.id, l])),
  };
}

function loadCache(path: string, setSha: string) {
  const raw = readFileSync(path);
  const cache = JSON.parse(raw.toString("utf8")) as {
    set_sha256: string;
    enrich: { engine_version: string; taxonomy_version: string };
    biller_code_given?: boolean;
    categories: Record<string, string>;
  };
  if (cache.set_sha256 !== setSha) throw new Error("category cache is for another set");
  return { cache, sha: sha256(raw) };
}

export function loadSet(which: "synthetic-v2.2" | "synthetic-v1"): LoadedSet {
  const manifestPath = `research/datasets/${which}.manifest.json`;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    set: string;
    seed: number;
    set_sha256: string;
    as_of_date?: string;
  };
  const generated =
    which === "synthetic-v2.2"
      ? generateSetV22(manifest.seed)
      : population(manifest.seed).map((spec) => generateApplicant(spec, manifest.seed));
  const hash = createHash("sha256");
  for (const a of generated) hash.update(serialise(a)).update("\n");
  const setSha = hash.digest("hex");
  if (setSha !== manifest.set_sha256) throw new Error(`set hash ${setSha} does not match`);
  const categoriesFile =
    which === "synthetic-v2.2"
      ? "research/enrich/synthetic-v2.2-categories-no-biller-code.json"
      : "research/enrich/synthetic-v1-categories.json";
  const { cache, sha } = loadCache(categoriesFile, setSha);
  if (which === "synthetic-v2.2" && cache.biller_code_given !== false)
    throw new Error("set v2.2 must use the cache made without biller codes (A1)");
  return {
    set: manifest.set,
    set_sha256: setSha,
    as_of: manifest.as_of_date ?? "2026-10-31",
    applicants: (generated as unknown as Raw[])
      .map(toApplicant)
      .filter((a) => a.months >= 3)
      .sort((x, y) => (x.id < y.id ? -1 : 1)),
    categories: cache.categories,
    categories_file: categoriesFile,
    categories_sha256: sha,
    enrich: cache.enrich,
    biller_code_given: cache.biller_code_given ?? true,
  };
}

export type RunSpec = {
  arm: "treatment" | "baseline";
  disclosure: Disclosure;
  min_occurrences: number;
  amount_tolerance: number;
  variant: "as-generated" | "rotated-declarations";
  bpay: "in" | "excluded";
};

const isBpay = (t: { billerName?: string; description: string }) =>
  (t.billerName ?? "") !== "" || /\bBPAY\b/i.test(t.description);
const withoutBpay = (feed: LiabilityFeed): LiabilityFeed => ({
  accounts: feed.accounts.map((a) => ({
    ...a,
    transactions: a.transactions.filter((t) => !isBpay(t)),
  })),
});

type Found = { family: Family57; identity: string; declared: boolean };
type Classified = { family: Family57; identity: string } | null;

/** The baseline's step (b), as SIG-18 1.0.0 reads a debit, with identity resolved for scoring. */
function baselineClassify(
  t: LiabilityFeed["accounts"][number]["transactions"][number],
  categories: Readonly<Record<string, string>>,
  index: AliasIndex,
): Classified {
  const BASE: Record<string, Family57> = {
    loan_repayment: "loan",
    bnpl: "bnpl",
    sacc_loan: "sacc",
    wage_advance: "wage_advance",
  };
  const family = BASE[categories[t.transactionId] ?? ""];
  if (family) {
    const p = normaliseProvider(t.description);
    return p === "" ? null : { family, identity: resolve(p, index).identity };
  }
  const card = /^(.*?)CREDIT CARD/i.exec(t.billerName ?? "");
  if (!card) return null;
  const p = normaliseProvider(card[1] ?? "");
  return p === "" ? null : { family: "credit_card", identity: resolve(p, index).identity };
}

type Miss = {
  applicant_id: string;
  family: Family57;
  identity: string;
  cause: string;
  unseen_lender: boolean | null;
  resolved: boolean;
  sub_tag?: "FN7 unseen lender unresolved";
};
type Tally = { truth: number; tp: number };
const tally = () => ({ truth: 0, tp: 0 });
const ratio = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 10000) / 10000);

export function scoreRun(set: LoadedSet, index: AliasIndex, spec: RunSpec) {
  const decls = set.applicants.map((a) => a.declared);
  let tp = 0;
  const fps: Miss[] = [];
  const fns: Miss[] = [];
  const byFamily: Record<string, { truth: number; tp: number; fp: number }> = {};
  const fam = (f: string) => (byFamily[f] ??= { truth: 0, tp: 0, fp: 0 });
  const unseen = { unseen: tally(), listed_or_known: tally() };
  const noCardCue = tally();
  const unshared = tally();
  const pool = {
    natural: { applicants: 0, truth: 0, tp: 0, fp: 0 },
    other: { applicants: 0, truth: 0, tp: 0, fp: 0 },
  };
  const disclosedBy = { name: 0, amount: 0 };

  set.applicants.forEach((a, i) => {
    const declared =
      spec.variant === "rotated-declarations"
        ? (decls[(i + 1) % decls.length] ?? [])
        : (decls[i] ?? []);
    const feed = spec.bpay === "excluded" ? withoutBpay(a.feed) : a.feed;
    const input = {
      feed,
      categories: set.categories,
      declared,
      as_of: set.as_of,
      min_occurrences: spec.min_occurrences,
      amount_tolerance: spec.amount_tolerance,
    };
    let found: Found[];
    let classify: (t: (typeof feed.accounts)[number]["transactions"][number]) => Classified;
    if (spec.arm === "treatment") {
      const r = detectWithAliases(input, index, spec.disclosure);
      for (const d of r.liabilities) if (d.disclosed_by) disclosedBy[d.disclosed_by] += 1;
      found = r.liabilities;
      classify = (t) => classifyOutflow(t, set.categories, index);
    } else {
      const r = detectLiabilities(input);
      found = r.liabilities.map((d) => ({
        family: d.family as Family57,
        identity: resolve(d.provider, index).identity,
        declared: d.declared,
      }));
      classify = (t) => baselineClassify(t, set.categories, index);
    }
    const items = a.items
      .map((t) => {
        const r = resolve(t.provider, index);
        const family = TYPE_FAMILY[t.type] as Family57;
        return { ...t, family, identity: r.identity, resolved: r.lender !== null };
      })
      .filter((t) => t.family !== undefined);
    const key = (f: string, id: string) => `${f}|${id}`;
    const hidden = items.filter((t) => !t.declared);
    const inPool = a.declared.length >= 2;
    const poolSide = a.tags.includes("natural-declarations") ? pool.natural : pool.other;
    if (inPool) poolSide.applicants++;
    const matched = new Set<string>();
    for (const t of hidden) {
      fam(t.family).truth++;
      const v = a.v2.get(t.id);
      if (v) {
        (v.unseen_lender ? unseen.unseen : unseen.listed_or_known).truth++;
        if (!v.biller_cue) noCardCue.truth++;
        if (!v.paid_from_shared) unshared.truth++;
      }
      if (inPool) poolSide.truth++;
    }
    for (const d of found.filter((x) => !x.declared)) {
      const k = key(d.family, d.identity);
      const hit = hidden.find((t) => key(t.family, t.identity) === k && !matched.has(t.id));
      if (hit) {
        matched.add(hit.id);
        tp++;
        fam(d.family).tp++;
        const v = a.v2.get(hit.id);
        if (v) {
          (v.unseen_lender ? unseen.unseen : unseen.listed_or_known).tp++;
          if (!v.biller_cue) noCardCue.tp++;
          if (!v.paid_from_shared) unshared.tp++;
        }
        if (inPool) poolSide.tp++;
        continue;
      }
      fam(d.family).fp++;
      if (inPool) poolSide.fp++;
      const declaredTruth = items.find((t) => t.declared && key(t.family, t.identity) === k);
      const cause = declaredTruth
        ? "FP1 declared liability not matched"
        : hidden.some((t) => key(t.family, t.identity) === k)
          ? "FP3 duplicate"
          : "FP2 not a liability";
      const v = declaredTruth ? a.v2.get(declaredTruth.id) : undefined;
      const resolved = d.identity !== "" && /^[a-z0-9_]+$/.test(d.identity);
      fps.push({
        applicant_id: a.id,
        family: d.family,
        identity: d.identity,
        cause,
        unseen_lender: v ? v.unseen_lender : null,
        resolved,
        ...(cause.startsWith("FP1") && !resolved
          ? { sub_tag: "FN7 unseen lender unresolved" as const }
          : {}),
      });
    }
    for (const t of hidden.filter((h) => !matched.has(h.id))) {
      const v = a.v2.get(t.id);
      const cause = v
        ? missCause(feed, found, classify, spec, t, v)
        : "untagged (set v1 has no repayment IDs)";
      fns.push({
        applicant_id: a.id,
        family: t.family,
        identity: t.identity,
        cause,
        unseen_lender: v ? v.unseen_lender : null,
        resolved: t.resolved,
        ...(cause.startsWith("FN2") && !t.resolved
          ? { sub_tag: "FN7 unseen lender unresolved" as const }
          : {}),
      });
    }
  });

  const detected = tp + fps.length;
  const truth = tp + fns.length;
  const count = (xs: Miss[]) =>
    Object.fromEntries(
      [...new Set(xs.map((x) => x.cause))]
        .sort()
        .map((c) => [c, xs.filter((x) => x.cause === c).length]),
    );
  const withRecall = (t: Tally) => ({ ...t, recall: ratio(t.tp, t.truth) });
  const poolOut = (p: typeof pool.natural) => ({
    ...p,
    precision: ratio(p.tp, p.tp + p.fp),
    recall: ratio(p.tp, p.truth),
  });
  return {
    spec,
    applicants: set.applicants.length,
    undisclosed_truth: truth,
    detected_undisclosed: detected,
    true_positives: tp,
    false_positives: fps.length,
    false_negatives: fns.length,
    precision: ratio(tp, detected),
    recall: ratio(tp, truth),
    by_family: byFamily,
    breakdowns: {
      unseen_lenders: withRecall(unseen.unseen),
      other_lenders: withRecall(unseen.listed_or_known),
      no_card_cue: withRecall(noCardCue),
      repaid_from_unshared: withRecall(unshared),
      natural_declarations_pool: {
        rule: "applicants with 2 or more declarations only; 30% of the other declarations also differ (40387)",
        natural: poolOut(pool.natural),
        other: poolOut(pool.other),
      },
      disclosed_by: disclosedBy,
    },
    false_positive_causes: count(fps),
    false_negative_causes: count(fns),
    fn7_sub_tags: [...fps, ...fns].filter((m) => m.sub_tag).length,
    false_positives_list: fps,
    false_negatives_list: fns,
  };
}

/** FN1 to FN6 in SIG-18's order, from the item's repayment IDs (A5). */
function missCause(
  feed: LiabilityFeed,
  found: Found[],
  classify: (t: LiabilityFeed["accounts"][number]["transactions"][number]) => Classified,
  spec: RunSpec,
  t: { family: Family57; identity: string },
  v: TruthV2,
): string {
  if (found.some((d) => d.family === t.family && d.identity === t.identity && d.declared))
    return "FN6 matched as disclosed";
  const ids = new Set(v.repayment_transaction_ids);
  const shared = feed.accounts.filter(
    (a) =>
      (a.account.productCategory ?? "TRANS_AND_SAVINGS_ACCOUNTS") === "TRANS_AND_SAVINGS_ACCOUNTS",
  );
  const inGrant =
    v.account_id !== undefined && feed.accounts.some((a) => a.account.accountId === v.account_id);
  const visible = shared.flatMap((a) =>
    a.transactions.filter((x) => ids.has(x.transactionId) && !BSB_NUMBER.test(x.description)),
  );
  if (visible.length === 0 && !inGrant) return "FN1 no visible repayment";
  if (visible.length === 0)
    return found.some((d) => d.family === t.family && !d.declared)
      ? "unregistered: account in grant, detected under another identity"
      : "unregistered: account in grant, not explained";
  const lender = visible
    .map((x) => ({ x, c: classify(x) }))
    .filter(({ c }) => c !== null && c.family === t.family);
  if (lender.length === 0) return "FN2 not identified as a lender";
  if (lender.length < spec.min_occurrences) return "FN3 too few occurrences";
  const amounts = lender.map(({ x }) => -Number(x.amount));
  const m = median(amounts);
  const near = lender
    .map(({ x }) => ({
      amount: -Number(x.amount),
      day: dayOf(x.postingDateTime ?? x.valueDateTime ?? ""),
    }))
    .filter((o) => Math.abs(o.amount - m) <= spec.amount_tolerance * m + 1e-9)
    .sort((p, q) => p.day - q.day);
  if (near.length < spec.min_occurrences) return "FN4 amount varies";
  const gap = median(near.slice(1).map((o, i) => o.day - (near[i] as { day: number }).day));
  if (!CADENCE_BANDS.some(([, lo, hi]) => gap >= lo && gap <= hi)) return "FN5 cadence";
  if (lender.some(({ c }) => c !== null && c.identity !== t.identity))
    return "unregistered: detected under another identity";
  return "unregistered: not explained";
}
