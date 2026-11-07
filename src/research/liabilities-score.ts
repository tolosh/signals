// SIG-18 (H2): scores the hidden-liability detector against set v1's ground truth, as
// pre-registered in research/preregistrations/SIG-18.json. Used by scripts/lia-detect.ts and by
// T4 (test/engines/signals/lia-01-run.test.ts), which asserts the recorded result reproduces (D28).
// Records carry IDs, families and providers only: never a transaction description.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  detectLiabilities,
  normaliseProvider,
  type DeclaredLiability,
  type Family,
  type LiabilityFeed,
} from "../engines/liabilities/index.js";
import {
  AS_OF_DATE,
  generateApplicant,
  population,
  serialise,
  type GeneratedApplicant,
} from "./generator/index.js";

export type Config = { min_occurrences: number; amount_tolerance: number };
export type Variant = "as-generated" | "rotated-declarations";
const FAMILY: Record<string, Family> = {
  credit_card: "credit_card",
  car_loan: "loan",
  personal_loan: "loan",
  bnpl: "bnpl",
  sacc: "sacc",
  wage_advance: "wage_advance",
};
const CREDIT: Record<string, Family> = {
  loan_repayment: "loan",
  bnpl: "bnpl",
  sacc_loan: "sacc",
  wage_advance: "wage_advance",
};
const BSB_NUMBER = /\b\d{3}-?\d{3}\s+\d{6,10}\b/;
const CADENCES: [number, number][] = [
  [5, 9],
  [12, 16],
  [26, 35],
];
const DAY_MS = 86_400_000;
const dayOf = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

type RawAccount = {
  account: { accountId: string; productCategory?: string; productName?: string };
  transactionList: { data: { transactions: LiabilityFeed["accounts"][number]["transactions"] } };
};
type Application = { declared_liabilities: DeclaredLiability[] };
type TruthItem = {
  id: string;
  type: string;
  provider: string;
  declared: boolean;
  account_shared: boolean;
};

export function loadSet(manifestPath = "research/datasets/synthetic-v1.manifest.json") {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    set: string;
    seed: number;
    set_sha256: string;
  };
  const hash = createHash("sha256");
  const applicants = population(manifest.seed).map((spec) => {
    const a = generateApplicant(spec, manifest.seed);
    hash.update(serialise(a)).update("\n");
    return a;
  });
  const sha = hash.digest("hex");
  if (sha !== manifest.set_sha256) throw new Error(`set hash ${sha} does not match the manifest`);
  const cache = JSON.parse(
    readFileSync("research/enrich/synthetic-v1-categories.json", "utf8"),
  ) as {
    set_sha256: string;
    enrich: { engine_version: string; taxonomy_version: string };
    categories: Record<string, string>;
  };
  if (cache.set_sha256 !== manifest.set_sha256)
    throw new Error("category cache is for another set");
  return { manifest, applicants, categories: cache.categories, enrich: cache.enrich };
}

const feedOf = (a: GeneratedApplicant): LiabilityFeed => ({
  accounts: (a.feed as unknown as { accounts: RawAccount[] }).accounts.map((acc) => ({
    account: acc.account,
    transactions: acc.transactionList.data.transactions,
  })),
});

type Miss = { applicant_id: string; family: Family; provider: string; cause: string };

export function scoreSet(
  applicants: GeneratedApplicant[],
  categories: Readonly<Record<string, string>>,
  config: Config,
  variant: Variant,
) {
  const declarations = applicants.map(
    (a) => (a.application as unknown as Application).declared_liabilities,
  );
  let tp = 0;
  const fps: Miss[] = [];
  const fns: Miss[] = [];
  const byFamily: Record<string, { truth: number; tp: number; fp: number }> = {};
  const fam = (f: string) => (byFamily[f] ??= { truth: 0, tp: 0, fp: 0 });

  applicants.forEach((a, i) => {
    const declared =
      variant === "rotated-declarations"
        ? (declarations[(i + 1) % declarations.length] ?? [])
        : (declarations[i] ?? []);
    const feed = feedOf(a);
    const result = detectLiabilities({
      feed,
      categories,
      declared,
      as_of: AS_OF_DATE,
      ...config,
    });
    const items = (a.truth.liabilities.items as unknown as TruthItem[]).map((t) => ({
      ...t,
      family: FAMILY[t.type] as Family,
      key: `${FAMILY[t.type]}|${normaliseProvider(t.provider)}`,
    }));
    const hidden = items.filter((t) => !t.declared);
    for (const t of hidden) fam(t.family).truth++;
    const matched = new Set<string>();
    const id = a.truth.applicant_id;

    for (const d of result.undisclosed) {
      const k = `${d.family}|${d.provider}`;
      const hit = hidden.find((t) => t.key === k && !matched.has(t.id));
      if (hit) {
        matched.add(hit.id);
        tp++;
        fam(d.family).tp++;
        continue;
      }
      fam(d.family).fp++;
      const cause = items.some((t) => t.declared && t.key === k)
        ? "FP1 declared liability not matched"
        : hidden.some((t) => t.key === k)
          ? "FP3 duplicate"
          : "FP2 not a liability";
      fps.push({ applicant_id: id, family: d.family, provider: d.provider, cause });
    }

    for (const t of hidden.filter((h) => !matched.has(h.id))) {
      const provider = normaliseProvider(t.provider);
      fns.push({
        applicant_id: id,
        family: t.family,
        provider,
        cause: missCause(feed, categories, config, result.liabilities, t.family, provider),
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
  return {
    config,
    variant,
    undisclosed_truth: truth,
    detected_undisclosed: detected,
    true_positives: tp,
    false_positives: fps.length,
    false_negatives: fns.length,
    precision: detected === 0 ? null : Math.round((tp / detected) * 10000) / 10000,
    recall: truth === 0 ? null : Math.round((tp / truth) * 10000) / 10000,
    by_family: byFamily,
    false_positive_causes: count(fps),
    false_negative_causes: count(fns),
    false_positives_list: fps,
    false_negatives_list: fns,
  };
}

/** True when the normalised text holds the provider's name as whole words. */
const names = (text: string, provider: string) =>
  provider !== "" && ` ${text} `.includes(` ${provider} `);

/**
 * The pre-registered miss causes, FN1 to FN6, in order of precedence. A debit is "to the provider"
 * when its narrative (or card biller) names the provider among other words, not only when the
 * whole narrative is the name (SIG-18 review, follow-up 4). Two tags fall outside the
 * pre-registered list and say so: a miss the detector found under a noisier provider name, and a
 * miss nothing explains. FN6 is only for a detection read as disclosed.
 */
export function missCause(
  feed: LiabilityFeed,
  categories: Readonly<Record<string, string>>,
  config: Config,
  found: { family: Family; provider: string; declared: boolean }[],
  family: Family,
  provider: string,
): string {
  if (found.some((d) => d.family === family && d.provider === provider && d.declared))
    return "FN6 matched as disclosed";
  const end = dayOf(AS_OF_DATE);
  const toProvider: { amount: number; day: number; lender: boolean }[] = [];
  let accountInGrant = false;
  for (const { account, transactions } of feed.accounts) {
    const cat = account.productCategory ?? "TRANS_AND_SAVINGS_ACCOUNTS";
    if (cat !== "TRANS_AND_SAVINGS_ACCOUNTS") {
      if (normaliseProvider(account.productName ?? "").startsWith(provider)) accountInGrant = true;
      continue;
    }
    for (const t of transactions) {
      const amount = Number(t.amount);
      const day = dayOf(t.postingDateTime ?? t.valueDateTime ?? "");
      if (!(amount < 0) || day > end || BSB_NUMBER.test(t.description)) continue;
      const card = /^(.*?)CREDIT CARD/i.exec(t.billerName ?? "");
      const texts = [
        normaliseProvider(t.description),
        card ? normaliseProvider(card[1] ?? "") : "",
      ];
      if (!texts.some((text) => names(text, provider))) continue;
      const lender =
        CREDIT[categories[t.transactionId] ?? ""] === family ||
        (family === "credit_card" && !!card);
      toProvider.push({ amount: -amount, day, lender });
    }
  }
  if (toProvider.length === 0 && !accountInGrant) return "FN1 no visible repayment";
  const lender = toProvider.filter((o) => o.lender);
  if (lender.length === 0) return "FN2 not identified as a lender";
  if (lender.length < config.min_occurrences) return "FN3 too few occurrences";
  const m = median(lender.map((o) => o.amount));
  const near = lender
    .filter((o) => Math.abs(o.amount - m) <= config.amount_tolerance * m + 1e-9)
    .sort((x, y) => x.day - y.day);
  if (near.length < config.min_occurrences) return "FN4 amount varies";
  const gap = median(near.slice(1).map((o, i) => o.day - (near[i] as { day: number }).day));
  if (!CADENCES.some(([lo, hi]) => gap >= lo && gap <= hi)) return "FN5 cadence";
  if (
    found.some((d) => d.family === family && d.provider !== provider && names(d.provider, provider))
  )
    return "unregistered: detected under another provider name";
  return "unregistered: not explained";
}
