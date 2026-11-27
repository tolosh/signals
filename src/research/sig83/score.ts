// SIG-83's scorer (research/preregistrations/SIG-83.json, scorer): SIG-57's metric applied to
// LIA's liabilities. Undisclosed liabilities are matched to undisclosed ground truth one-to-one by
// family and identity; identities are resolved through SIG-57's alias table 1.0.0, for scoring
// only, in both arms alike (the rule never reads it, ruling 40766, 1). Records carry IDs,
// families, identities and counts only, never a narrative. Synthetic data only. Pure: the sets,
// categories and alias index are inputs.
import { createHash } from "node:crypto";
import { assessLia, type LiaConfig, type LiaFeed } from "../../engines/families/lia/index.js";
import type { DeclaredLiability, DetectedLiability } from "../../engines/liabilities/index.js";
import type { FeedType } from "../../engines/signals/definitions.js";
import { resolve, type AliasIndex } from "../sig57/aliases.js";
import { TYPE_FAMILY } from "../sig57/detect.js";

/** The liability categories (1.0.0's step (b)); a debit in any other is in a non-liability one. */
export const LIABILITY_CATEGORIES = new Set([
  "loan_repayment",
  "bnpl",
  "sacc_loan",
  "wage_advance",
]);

type Tx = LiaFeed["accounts"][number]["transactions"][number];
export type Applicant83 = {
  id: string;
  months: number;
  feed_type: FeedType;
  feed: LiaFeed;
  declared: DeclaredLiability[];
  items: { id: string; type: string; provider: string; declared: boolean }[];
};

type RawAccount = {
  account: LiaFeed["accounts"][number]["account"];
  detail?: LiaFeed["accounts"][number]["detail"];
  transactions?: Tx[];
  transactionList?: { data: { transactions: Tx[] } };
};
export type RawApplicant = {
  truth: {
    applicant_id: string;
    feed_type: FeedType;
    history?: { months: number };
    liabilities: { items: Applicant83["items"] };
  };
  application: { declared_liabilities?: DeclaredLiability[] };
  feed: { accounts: RawAccount[] };
};

/** A set's applicant in the shape LIA reads, with its truth. */
export const toApplicant = (a: RawApplicant): Applicant83 => ({
  id: a.truth.applicant_id,
  months: a.truth.history?.months ?? 0,
  feed_type: a.truth.feed_type,
  feed: {
    accounts: a.feed.accounts.map((acc) => ({
      account: acc.account,
      ...(acc.detail ? { detail: acc.detail } : {}),
      transactions: acc.transactions ?? acc.transactionList?.data.transactions ?? [],
    })),
  },
  declared: a.application.declared_liabilities ?? [],
  items: a.truth.liabilities.items,
});

/** The arms: LIA as it was (step (d) off) and as changed. */
export type Arm = "1.3.6" | "1.4.0";
/** LIA's config for an arm. Step (d) is LIA 1.4.0's `category_independent`. */
export const armConfig = (arm: Arm): Partial<LiaConfig> =>
  ({ category_independent: arm === "1.4.0" }) as Partial<LiaConfig>;

export type ScoreInput = {
  applicants: readonly Applicant83[];
  categories: Readonly<Record<string, string>>;
  as_of: string;
  index: AliasIndex;
  arm: Arm;
  /** The feed as scored (the negative control rotates it). */
  feedOf?: (a: Applicant83) => LiaFeed;
};

const ratio = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 10000) / 10000);

/** LIA's liabilities for one applicant on an arm. */
export function liabilitiesOf(
  a: Applicant83,
  feed: LiaFeed,
  categories: Readonly<Record<string, string>>,
  as_of: string,
  arm: Arm,
): DetectedLiability[] {
  return assessLia({
    feed,
    feed_type: a.feed_type,
    as_of,
    categories,
    application: { declared_liabilities: a.declared },
    config: armConfig(arm),
  }).liabilities;
}

export function scoreArm(input: ScoreInput) {
  const scored = input.applicants.filter((a) => a.months >= 3);
  let tp = 0;
  let tpNonLiability = 0;
  let truthTotal = 0;
  const fps: { applicant_id: string; family: string; identity: string; cause: string }[] = [];
  const fns: { applicant_id: string; family: string; identity: string }[] = [];
  const byFamily: Record<string, { truth: number; tp: number; fp: number }> = {};
  const fam = (f: string) => (byFamily[f] ??= { truth: 0, tp: 0, fp: 0 });
  /** Each applicant's liabilities, hashed, so arms compare byte for byte without any text. */
  const perApplicant: { applicant_id: string; liabilities_sha256: string }[] = [];
  const key = (f: string, id: string) => `${f}|${id}`;

  for (const a of scored) {
    const feed = input.feedOf ? input.feedOf(a) : a.feed;
    const found = liabilitiesOf(a, feed, input.categories, input.as_of, input.arm);
    perApplicant.push({
      applicant_id: a.id,
      liabilities_sha256: createHash("sha256").update(JSON.stringify(found)).digest("hex"),
    });
    const items = a.items
      .map((t) => ({
        ...t,
        family: TYPE_FAMILY[t.type] as string | undefined,
        identity: resolve(t.provider, input.index).identity,
      }))
      .filter((t): t is typeof t & { family: string } => t.family !== undefined);
    const hidden = items.filter((t) => !t.declared);
    for (const t of hidden) fam(t.family).truth++;
    truthTotal += hidden.length;
    const matched = new Set<string>();
    for (const d of found.filter((x) => !x.declared)) {
      const identity = resolve(d.provider, input.index).identity;
      const k = key(d.family, identity);
      const hit = hidden.find((t) => key(t.family, t.identity) === k && !matched.has(t.id));
      if (hit) {
        matched.add(hit.id);
        tp++;
        fam(d.family).tp++;
        if (
          d.evidence.length > 0 &&
          d.evidence.every((id) => !LIABILITY_CATEGORIES.has(input.categories[id] ?? ""))
        )
          tpNonLiability++;
        continue;
      }
      fam(d.family).fp++;
      const cause = items.some((t) => t.declared && key(t.family, t.identity) === k)
        ? "FP1 declared liability not matched"
        : hidden.some((t) => key(t.family, t.identity) === k)
          ? "FP3 duplicate"
          : "FP2 not a liability";
      fps.push({ applicant_id: a.id, family: d.family, identity, cause });
    }
    for (const t of hidden.filter((h) => !matched.has(h.id)))
      fns.push({ applicant_id: a.id, family: t.family, identity: t.identity });
  }

  const detected = tp + fps.length;
  const causes = Object.fromEntries(
    [...new Set(fps.map((x) => x.cause))]
      .sort()
      .map((c) => [c, fps.filter((x) => x.cause === c).length]),
  );
  return {
    arm: input.arm,
    applicants: scored.length,
    undisclosed_truth: truthTotal,
    detected_undisclosed: detected,
    true_positives: tp,
    false_positives: fps.length,
    false_negatives: fns.length,
    precision: ratio(tp, detected),
    recall: ratio(tp, truthTotal),
    true_positives_from_non_liability_categories: tpNonLiability,
    recall_from_non_liability_categories: ratio(tpNonLiability, truthTotal),
    by_family: byFamily,
    false_positive_causes: causes,
    false_positives_list: fps,
    false_negatives_list: fns,
    per_applicant: perApplicant,
  };
}

export type ArmScore = ReturnType<typeof scoreArm>;

/** The control's pre-registered pass: no recall gain from non-liability categories, no fall in precision. */
export function controlPasses(before: ArmScore, after: ArmScore): boolean {
  const r0 = before.recall_from_non_liability_categories ?? 0;
  const r1 = after.recall_from_non_liability_categories ?? 0;
  const p0 = before.precision ?? 0;
  const p1 = after.precision ?? 0;
  return r1 <= r0 && p1 >= p0;
}
