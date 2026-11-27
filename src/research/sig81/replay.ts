// SIG-81 (ruling 40741, 4): replays observed expenses over synthetic sets v1, v2.2 and v2.3, as
// run, so a version's before and after can be reported. Each applicant's debits are categorised
// on the pinned Enrich build (1.8.0, moroku-enrich 8cdb0d9): sets v1 and v2.2 from its committed
// fixtures, set v2.3 at run time by the caller (it has no fixture). LIA runs first, as the
// assessment composition runs it, and its liabilities' repayments are passed to observed expenses
// (rule 2; a version that doesn't read them ignores them). Synthetic data only. Pure: categories
// are an input.
import { deriveObservedExpenses } from "../../engines/affordability/observed-expenses.js";
import { assessLia, type LiaFeed } from "../../engines/families/lia/index.js";
import type { DeclaredLiability } from "../../engines/liabilities/index.js";
import type { FeedType } from "../../engines/signals/definitions.js";
import { AS_OF_DATE } from "../generator/types.js";

/** SIG-17's primary configuration (research/preregistrations/SIG-17.json). */
export const PRIMARY = { lookback_months: 6, one_off_threshold_aud: 5000 } as const;
/** SIG-17's tolerance: a derived figure within 15% of truth counts as within. */
export const TOLERANCE = 0.15;

type Tx = LiaFeed["accounts"][number]["transactions"][number] & {
  merchantCategoryCode?: string;
  merchantName?: string;
  billerCode?: string;
  reference?: string;
};
export type SetApplicant = {
  truth: {
    applicant_id: string;
    feed_type: FeedType;
    expenses: { committed_monthly: number; basic_monthly: number };
  };
  application: { declared_liabilities?: DeclaredLiability[] };
  feed: {
    accounts: {
      account: LiaFeed["accounts"][number]["account"];
      detail?: LiaFeed["accounts"][number]["detail"];
      transactions?: Tx[];
      transactionList?: { data: { transactions: Tx[] } };
    }[];
  };
};

/** The feed in the shape the engines read. */
export const feedOf = (a: SetApplicant) => ({
  accounts: a.feed.accounts.map((acc) => ({
    account: acc.account,
    ...(acc.detail ? { detail: acc.detail } : {}),
    transactions: acc.transactions ?? acc.transactionList?.data.transactions ?? [],
  })),
});

/** Every debit in a set, as Enrich is given it (biller codes kept unless left out). */
export const debitsOf = (set: readonly SetApplicant[], withBillerCode: boolean) =>
  set
    .flatMap((a) => feedOf(a).accounts.flatMap((acc) => acc.transactions))
    .filter((t) => Number(t.amount) < 0)
    .map((t) => ({
      transactionId: t.transactionId,
      description: t.description,
      amount: t.amount,
      ...(t.merchantCategoryCode ? { merchantCategoryCode: t.merchantCategoryCode } : {}),
      ...(t.merchantName ? { merchantName: t.merchantName } : {}),
      ...(withBillerCode && t.billerCode ? { billerCode: t.billerCode } : {}),
      ...(t.billerName ? { billerName: t.billerName } : {}),
      ...(t.reference ? { reference: t.reference } : {}),
    }));

const round2 = (x: number) => Math.round(x * 100) / 100;

export type ApplicantReplay = {
  applicant_id: string;
  truth_living_monthly: number;
  /** The transaction IDs of LIA's liabilities' repayments (its evidence), sorted. */
  lia_repayments: string[];
  observed: ReturnType<typeof deriveObservedExpenses>;
};

/** One applicant: LIA first, then observed expenses with LIA's repayments. */
export function replayApplicant(
  a: SetApplicant,
  categories: Readonly<Record<string, string>>,
): ApplicantReplay {
  const feed = feedOf(a);
  const lia = assessLia({
    feed,
    feed_type: a.truth.feed_type,
    as_of: AS_OF_DATE,
    lookback_months: PRIMARY.lookback_months,
    categories,
    application: { declared_liabilities: a.application.declared_liabilities ?? [] },
  });
  const lia_repayments = [...new Set(lia.liabilities.flatMap((l) => l.evidence))].sort();
  // Passed as a variable, so a version without the field (1.1.1) takes the same call.
  const input = {
    feed,
    categories,
    as_of: AS_OF_DATE,
    ...PRIMARY,
    liability_repayments: lia_repayments,
  };
  return {
    applicant_id: a.truth.applicant_id,
    truth_living_monthly: round2(
      a.truth.expenses.committed_monthly + a.truth.expenses.basic_monthly,
    ),
    lia_repayments,
    observed: deriveObservedExpenses(input),
  };
}

export type SetSummary = {
  applicants: number;
  mean_living_monthly: number;
  mean_truth_living_monthly: number;
  /** Mean absolute percentage error of living against truth (SIG-17's metric), over truth > 0. */
  mape: number;
  /** Share of applicants within SIG-17's 15% tolerance. */
  share_within: number;
  mean_unverified_monthly: number | null;
  lia_repayments: number;
};

export function summarise(rows: readonly ApplicantReplay[]): SetSummary {
  const scored = rows.filter((r) => r.truth_living_monthly > 0);
  const ape = scored.map(
    (r) => Math.abs(r.observed.living_monthly - r.truth_living_monthly) / r.truth_living_monthly,
  );
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const unverified = rows.map(
    (r) => (r.observed as { unverified_monthly?: number }).unverified_monthly,
  );
  return {
    applicants: rows.length,
    mean_living_monthly: round2(mean(rows.map((r) => r.observed.living_monthly))),
    mean_truth_living_monthly: round2(mean(rows.map((r) => r.truth_living_monthly))),
    mape: Math.round(mean(ape) * 10_000) / 10_000,
    share_within:
      Math.round((ape.filter((x) => x <= TOLERANCE).length / (ape.length || 1)) * 10_000) / 10_000,
    mean_unverified_monthly: unverified.every((u) => u === undefined)
      ? null
      : round2(mean(unverified.map((u) => u ?? 0))),
    lia_repayments: rows.reduce((s, r) => s + r.lia_repayments.length, 0),
  };
}
