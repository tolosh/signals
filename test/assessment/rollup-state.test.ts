// SIG-82 (Colin's mandate 40777, and ruling 40775, 2): the composition's optional roll-up state.
// rollup.state is set only when the evidence layer's state is unverified (RU-4); otherwise it is
// absent, and the roll-up carries the signals that move it (RU-1). No overall state is invented
// before RU-4 to RU-7 exist (ADR 0012, limit 5). Written before the change and pushed failing.
// Synthetic set v2.3 applicants only; the Enrich path is local, on the pinned build.
import { beforeAll, describe, expect, it } from "vitest";
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

beforeAll(async () => {
  m = await load();
  set = generateSetV23(623) as unknown as Raw[];
}, 300_000);

describe("the roll-up's optional state (40775, 2; 40777)", () => {
  it("evidence unverified: rollup.state is unverified, with the evidence state and the movers", async () => {
    const r = await m.assessApplicant?.({ ...byId(IDS[2] as string), request: REQUEST });
    expect(r?.evidence.rollup.state).toBe("unverified");
    expect(r?.rollup).toEqual({
      state: "unverified",
      evidence: "unverified",
      movers: rollupMovers([...(r?.inc.signals ?? []), ...(r?.lia.signals ?? [])]),
    });
  });
  it.each([IDS[0], IDS[1]])(
    "%s: evidence not unverified, so rollup.state is absent, not invented",
    async (id) => {
      const r = await m.assessApplicant?.({ ...byId(id as string), request: REQUEST });
      expect(r?.evidence.rollup.state).toBeNull();
      expect(r?.rollup).toBeDefined();
      expect(Object.keys(r?.rollup ?? {})).not.toContain("state");
      expect(r?.rollup).toEqual({
        evidence: null,
        movers: rollupMovers([...(r?.inc.signals ?? []), ...(r?.lia.signals ?? [])]),
      });
    },
  );
  it("the composition is 1.2.0", () => {
    expect(m.ASSESSMENT_COMPOSITION_VERSION).toBe("1.2.0");
  });
});
