// SIG-81 (narrow), wired into the assessment (rulings of 27 November, item 3; 40767). Written
// before the wiring and pushed failing. Observed expenses 1.2.0 reads LIA's repayments (its
// liabilities' evidence), so a repayment LIA counts is never also a living expense; and the
// affordability engine's observed basic expenses are basic plus unverified (other_expenses).
// Synthetic set v2.3 applicants only; the Enrich path is local, on the pinned build.
import { beforeAll, describe, expect, it } from "vitest";
import { computeAffordability } from "../../src/engines/affordability/index.js";
import { deriveObservedExpenses } from "../../src/engines/affordability/observed-expenses.js";
import { assessLia } from "../../src/engines/families/lia/index.js";
import { generateSetV23 } from "../../src/research/generator/v23/index.js";

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const MODULE = "../../src/assessment/assess.js";
const load = async (): Promise<Mod> => {
  try {
    return (await import(/* @vite-ignore */ MODULE)) as Mod;
  } catch {
    return {};
  }
};

const REQUEST = {
  product_type: "personal",
  loan: { amount: 20000, term_months: 60, product_rate_pct: 11.5 },
  policy: {
    buffer_pct: 3,
    floor_rate_pct: 5.5,
    card_commitment_factor: 0.03,
    shading: {
      salary: 1,
      overtime_bonus: 0.8,
      commission: 0.8,
      rental: 0.8,
      gig_platform: 0.8,
      government_benefit: 0,
      other: 1,
    },
    expense_method: "observed",
  },
  confirmed_expenses_monthly: null,
  benchmark: null,
  as_of: "2026-10-31",
  lookback_months: 6,
  // SIG-82 (ruling 40765, 2): SIG-70's realConsented mark replaces `synthetic` (disclosed).
  enrich: { tenant_status: "none", force_local: true, real_consented: false },
} as const;

type Raw = {
  truth: { applicant_id: string; feed_type: "cdr" };
  application: {
    stated_gross_annual: number;
    declared_liabilities: { type: string; provider: string; repayment_monthly?: number }[];
  };
  feed: {
    accounts: {
      account: Record<string, unknown>;
      detail?: unknown;
      transactions?: Record<string, unknown>[];
      transactionList?: { data: { transactions: Record<string, unknown>[] } };
    }[];
  };
};
const applicantOf = (a: Raw) => ({
  applicant_id: a.truth.applicant_id,
  feed_type: a.truth.feed_type,
  application: a.application,
  feed: {
    accounts: a.feed.accounts.map((acc) => ({
      account: acc.account,
      ...(acc.detail ? { detail: acc.detail } : {}),
      transactions: acc.transactions ?? acc.transactionList?.data.transactions ?? [],
    })),
  },
});

let m: Mod;
let set: Raw[];
const byId = (id: string) => {
  const a = set.find((x) => x.truth.applicant_id === id);
  if (!a) throw new Error(`no ${id}`);
  return applicantOf(a);
};
// Set v2.3 applicants used as fixtures: a regular salary, a hidden loan, an unshared salary.
const IDS = ["syn-v23-18936492246e52ae", "syn-v23-9bd03ecbd72ba13e", "syn-v23-13cfd6ef54467a35"];
// A set v2.3 applicant whose LIA repayments Enrich put outside the liability categories
// (lia_repayments_in_other_categories > 0 in research/runs/sig81-observed-expenses-1.2.0.json).
const LIA_OTHER = "syn-v23-4fd4c2c93870abc4";

beforeAll(async () => {
  m = await load();
  set = generateSetV23(623) as unknown as Raw[];
}, 300_000);

describe("SIG-81 wired: observed expenses read LIA's repayments", () => {
  it.each([...IDS, LIA_OTHER])(
    "%s: the assessment's expenses are observed expenses with LIA's evidence",
    async (id) => {
      const a = byId(id);
      const r = await m.assessApplicant?.({ ...a, request: REQUEST });
      expect(r).toBeDefined();
      const categories = m.categoriesOfRecord?.(r?.enrich) as Record<string, string>;
      const common = {
        feed: a.feed as never,
        feed_type: a.feed_type,
        as_of: REQUEST.as_of,
        lookback_months: 6,
        categories,
      };
      const lia = assessLia({
        ...common,
        application: { declared_liabilities: a.application.declared_liabilities },
      });
      expect(r?.lia).toEqual(lia);
      const repayments = [...new Set(lia.liabilities.flatMap((l) => l.evidence))].sort();
      const expenses = deriveObservedExpenses({
        feed: a.feed as never,
        categories,
        as_of: REQUEST.as_of,
        lookback_months: 6,
        one_off_threshold_aud: 5000,
        liability_repayments: repayments,
      });
      expect(r?.expenses).toEqual(expenses);
      expect(r?.affordability).toEqual(
        computeAffordability(
          m.affordabilityInputOf?.({
            application: a.application,
            request: REQUEST,
            inc: r?.inc,
            lia,
            expenses,
          }),
        ),
      );
    },
  );
  it("the wiring is observable: an LIA repayment in another category isn't also a living expense", async () => {
    const a = byId(LIA_OTHER);
    const r = await m.assessApplicant?.({ ...a, request: REQUEST });
    expect(r).toBeDefined();
    expect(r?.expenses.lia_repayments_in_other_categories).toBeGreaterThan(0);
    const categories = m.categoriesOfRecord?.(r?.enrich) as Record<string, string>;
    const bare = deriveObservedExpenses({
      feed: a.feed as never,
      categories,
      as_of: REQUEST.as_of,
      lookback_months: 6,
      one_off_threshold_aud: 5000,
    });
    expect(r?.expenses.living_monthly).toBeLessThan(bare.living_monthly);
  });
});

describe("SIG-81 wired: basic plus unverified goes to affordability", () => {
  const input = (expenses: Record<string, number>) =>
    m.affordabilityInputOf?.({
      application: { stated_gross_annual: 90000, declared_liabilities: [] },
      request: REQUEST,
      inc: { income: [] },
      lia: { liabilities: [] },
      expenses,
    });
  it("observed basic is basic plus unverified; committed is unchanged", () => {
    expect(typeof m.affordabilityInputOf).toBe("function");
    expect(
      input({ committed_monthly: 1200, basic_monthly: 800.1, unverified_monthly: 250.25 })
        ?.expenses,
    ).toEqual({
      confirmed_monthly: null,
      benchmark_monthly: null,
      observed_committed_monthly: 1200,
      observed_basic_monthly: 1050.35,
    });
  });
  it("no unverified spend leaves basic as it is", () => {
    expect(
      input({ committed_monthly: 1200, basic_monthly: 800, unverified_monthly: 0 })?.expenses
        .observed_basic_monthly,
    ).toBe(800);
  });
});
