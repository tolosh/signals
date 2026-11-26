// SIG-82, part 1 (Colin, 27 November 2026): one assessment, composed from the engines, the code
// the demo stage runs and SIG-76's expected states are computed by (ruling 40732). Written before
// the composition. Synthetic set v2.3 applicants only; the Enrich path is local, on the pinned
// 1.8.0 build (SIG-70), and never the API.
import { beforeAll, describe, expect, it } from "vitest";
import { computeAffordability } from "../../src/engines/affordability/index.js";
import { deriveObservedExpenses } from "../../src/engines/affordability/observed-expenses.js";
import { assessEvidence, evidenceRollup } from "../../src/engines/evidence/index.js";
import { assessInc } from "../../src/engines/families/inc/index.js";
import { assessLia } from "../../src/engines/families/lia/index.js";
import { rollupMovers } from "../../src/engines/rollup/index.js";
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
  enrich: { tenant_status: "none", force_local: true, synthetic: true },
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

beforeAll(async () => {
  m = await load();
  set = generateSetV23(623) as unknown as Raw[];
}, 300_000);

describe("SIG-82 part 1: one assessment, composed from the engines", () => {
  it("assessApplicant runs the SIG-70 adapter on the local path, on the pinned build", async () => {
    expect(typeof m.assessApplicant).toBe("function");
    const a = byId(IDS[0] as string);
    const r = await m.assessApplicant?.({ ...a, request: REQUEST });
    expect(r?.enrich.path).toBe("local");
    expect(r?.enrich.api_refused ?? null).toBeNull();
    expect(r?.enrich.build).toEqual({
      commit: "8cdb0d926f7a9473051655fdeed5d69c1ceffaeb",
      version: "1.8.0",
      dist_sha256: "134909daf5c246ae76104bd653dfdfc68814d112f14b2ebbb335cef92ce9e421",
    });
    const txs = a.feed.accounts.reduce((n, acc) => n + acc.transactions.length, 0);
    expect(r?.enrich.transactions).toBe(txs);
  });
  it("each engine's output is the engine's own, on the categories the adapter stored", async () => {
    const a = byId(IDS[1] as string);
    const r = await m.assessApplicant?.({ ...a, request: REQUEST });
    expect(r).toBeDefined();
    const categories = m.categoriesOfRecord?.(r?.enrich) as Record<string, string>;
    expect(Object.keys(categories ?? {})).toHaveLength(r?.enrich.transactions ?? -1);
    const common = {
      feed: a.feed as never,
      feed_type: a.feed_type,
      as_of: REQUEST.as_of,
      lookback_months: 6,
      categories,
    };
    const ctx = assessEvidence(common);
    expect(r?.evidence.rollup).toEqual(evidenceRollup(ctx));
    expect(r?.evidence.checks).toEqual(ctx.checks);
    const inc = assessInc({ ...common, application: m.incApplicationOf?.(a.application, REQUEST) });
    expect(r?.inc).toEqual(inc);
    const lia = assessLia({
      ...common,
      application: { declared_liabilities: a.application.declared_liabilities },
    });
    expect(r?.lia).toEqual(lia);
    const expenses = deriveObservedExpenses({
      feed: a.feed as never,
      categories,
      as_of: REQUEST.as_of,
      lookback_months: 6,
      one_off_threshold_aud: 5000,
    });
    expect(r?.expenses).toEqual(expenses);
    expect(r?.affordability).toEqual(
      computeAffordability(
        m.affordabilityInputOf?.({
          application: a.application,
          request: REQUEST,
          inc,
          lia,
          expenses,
        }),
      ),
    );
  });
  it("the roll-up is the evidence layer's state and the signals that move it (RU-1; the full roll-up is phase 2, D13)", async () => {
    const r = await m.assessApplicant?.({ ...byId(IDS[1] as string), request: REQUEST });
    expect(r).toBeDefined();
    const signals = [...(r?.inc.signals ?? []), ...(r?.lia.signals ?? [])];
    expect(r?.rollup).toEqual({
      evidence: r?.evidence.rollup.state ?? null,
      movers: rollupMovers(signals),
    });
  });
});

describe("the mapping onto the affordability engine (ADR 0012)", () => {
  it("income streams are INC's, monthly, by type; stated gross is the application's", () => {
    expect(typeof m.affordabilityInputOf).toBe("function");
    const inc = {
      income: [
        {
          payer: "ACME",
          cadence: "fortnightly",
          observed_amount: 5000,
          type: "salary",
          shading: 1,
          assessed_amount: 5000,
        },
      ],
    };
    const input = m.affordabilityInputOf?.({
      application: { stated_gross_annual: 90000, declared_liabilities: [] },
      request: REQUEST,
      inc,
      lia: { liabilities: [] },
      expenses: { committed_monthly: 1200, basic_monthly: 800 },
    });
    expect(input?.income).toEqual({
      streams: [{ type: "salary", cadence: "monthly", amount: 5000 }],
      stated_gross_annual: 90000,
    });
    expect(input?.expenses).toEqual({
      confirmed_monthly: null,
      benchmark_monthly: null,
      observed_committed_monthly: 1200,
      observed_basic_monthly: 800,
    });
    expect(input?.policy).toEqual(REQUEST.policy);
    expect(input?.loan).toEqual(REQUEST.loan);
  });
  it("a stated gross of 0 is no stated gross", () => {
    const input = m.affordabilityInputOf?.({
      application: { stated_gross_annual: 0, declared_liabilities: [] },
      request: REQUEST,
      inc: { income: [] },
      lia: { liabilities: [] },
      expenses: { committed_monthly: 0, basic_monthly: 0 },
    });
    expect(input?.income.stated_gross_annual).toBeNull();
  });
  it("liabilities: every declared one at its stated repayment, and every one found but not declared", () => {
    const input = m.affordabilityInputOf?.({
      application: {
        stated_gross_annual: 90000,
        declared_liabilities: [
          { type: "car_loan", provider: "Money 3", repayment_monthly: 443 },
          { type: "credit_card", provider: "ANZ", repayment_monthly: 700 },
          { type: "sacc", provider: "Cash Stop", repayment_monthly: 450 },
        ],
      },
      request: REQUEST,
      inc: { income: [] },
      lia: {
        liabilities: [
          { family: "loan", provider: "MONEY3", monthly: 443, declared: true },
          { family: "loan", provider: "COMMBANK", monthly: 512.4, declared: false },
          { family: "bnpl", provider: "ZIP", monthly: 60, declared: false },
          { family: "credit_card", provider: "AMEX", monthly: null, declared: false },
        ],
      },
      expenses: { committed_monthly: 0, basic_monthly: 0 },
    });
    expect(input?.liabilities).toEqual([
      { type: "car_loan", source: "declared", stated_repayment: 443 },
      { type: "credit_card", source: "declared", stated_repayment: 700 },
      { type: "sacc", source: "declared", stated_repayment: 450, average_outflow_3m: 450 },
      { type: "personal_loan", source: "found", observed_repayment: 512.4 },
      { type: "bnpl", source: "found", observed_repayment: 60, average_outflow_3m: 60 },
      { type: "credit_card", source: "found", observed_repayment: null },
    ]);
  });
});

describe("determinism, and no hard-coded output", () => {
  it("the same input gives byte-identical output", async () => {
    const a = byId(IDS[0] as string);
    const one = JSON.stringify(await m.assessApplicant?.({ ...a, request: REQUEST }));
    const two = JSON.stringify(await m.assessApplicant?.({ ...a, request: REQUEST }));
    expect(typeof m.assessApplicant).toBe("function");
    expect(one).toBe(two);
    expect(String(one).length).toBeGreaterThan(100);
  });
  it("changing one salary credit by $100 changes the result", async () => {
    const a = byId(IDS[0] as string);
    const credits = a.feed.accounts
      .flatMap((acc) => acc.transactions)
      .filter((t) => Number(t.amount) > 1000);
    const last = credits.sort((x, y) =>
      String(y.postingDateTime) < String(x.postingDateTime) ? -1 : 1,
    )[0];
    expect(last).toBeDefined();
    const changed = {
      ...a,
      feed: {
        accounts: a.feed.accounts.map((acc) => ({
          ...acc,
          transactions: acc.transactions.map((t) =>
            t === last ? { ...t, amount: (Number(t.amount) + 100).toFixed(2) } : t,
          ),
        })),
      },
    };
    const before = await m.assessApplicant?.({ ...a, request: REQUEST });
    const after = await m.assessApplicant?.({ ...changed, request: REQUEST });
    expect(JSON.stringify(after?.inc)).not.toBe(JSON.stringify(before?.inc));
  });
  it("the unshared-salary applicant is unverified, with no guessed income (the SIG-76 negative control's shape)", async () => {
    const r = await m.assessApplicant?.({ ...byId(IDS[2] as string), request: REQUEST });
    expect(r?.evidence.rollup.state).toBe("unverified");
  });
});
