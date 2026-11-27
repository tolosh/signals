// SIG-82, part 1 (Colin, 27 November 2026): one assessment, composed from the engines. This is the
// code the hosted demo stage runs, and the code SIG-76's expected states are computed by (ruling
// 40732). Interpretations are in docs/adr/0012-assessment-composition.md.
//
//   1. Enrich categorises every transaction through the SIG-70 adapter: the local path, on the
//      pinned build (D58), never the API for synthetic data (D42). The record is kept, and the
//      engines read the categories stored in it.
//   2. The evidence layer, INC, LIA and observed expenses run on the feed and those categories;
//      observed expenses read LIA's repayments (SIG-81).
//   3. Their outputs are mapped onto the affordability engine's input (affordabilityInputOf).
//   4. The roll-up is the evidence layer's state and the signals that move it (RU-1). The full
//      roll-up (RU-4 to RU-7) is phase 2 (D13).
// Engines stay pure; this module only calls them and records what they return.
import {
  computeAffordability,
  repayment,
  type AffordabilityInput,
  type Liability,
  type LiabilityType,
} from "../engines/affordability/index.js";
import {
  deriveObservedExpenses,
  type ObservedExpenses,
} from "../engines/affordability/observed-expenses.js";
import type { ExpenseMethod } from "../engines/affordability/expenses.js";
import { assessEvidence, evidenceRollup, type Feed } from "../engines/evidence/index.js";
import { assessInc, type IncApplication, type IncResult } from "../engines/families/inc/index.js";
import { assessLia, type LiaResult } from "../engines/families/lia/index.js";
import type { DeclaredLiability } from "../engines/liabilities/index.js";
import { rollupMovers } from "../engines/rollup/index.js";
import type { FeedType } from "../engines/signals/definitions.js";
import { categoriseForAssessment } from "../connectors/enrich/path.js";
import { pinnedLocalEnrich } from "../connectors/enrich/pinned.js";
import { categoriesFrom } from "../connectors/enrich/replay.js";
import type { EnrichRecord, EnrichTx, TenantStatus } from "../connectors/enrich/types.js";

/**
 * 1.0.0 (SIG-82 part 1): the composition ADR 0012 records. 1.1.0 (SIG-81, rulings of 27 November,
 * 3): observed expenses read LIA's repayments, and affordability's observed basic expenses include
 * the unverified line (ADR 0013).
 */
export const ASSESSMENT_COMPOSITION_VERSION = "1.1.0";

/** The lender's request, as SIG-76's pre-registration records it. */
export type AssessmentRequest = {
  product_type: AffordabilityInput["product_type"];
  loan: AffordabilityInput["loan"];
  policy: AffordabilityInput["policy"] & { expense_method: ExpenseMethod };
  confirmed_expenses_monthly: number | null;
  benchmark: (AffordabilityInput["benchmark"] & { monthly: number }) | null;
  as_of: string;
  lookback_months: number;
  enrich: {
    tenant_status: TenantStatus;
    force_local: boolean;
    /** True only for real, consented data (SIG-70 O4). Synthetic feeds pass false. */
    real_consented: boolean;
  };
};
export type Application = {
  stated_gross_annual?: number | null;
  declared_liabilities: DeclaredLiability[];
  occupation?: string | null;
};
type FeedTx = {
  transactionId: string;
  description: string;
  amount: string;
  merchantCategoryCode?: string;
  merchantName?: string;
  billerCode?: string;
  billerName?: string;
  reference?: string;
};
export type AssessmentInput = {
  applicant_id?: string;
  feed: { accounts: { account: unknown; detail?: unknown; transactions: FeedTx[] }[] };
  feed_type: FeedType;
  application: Application;
  request: AssessmentRequest;
};

/** The category by transaction id, from the stored Enrich record (as replay reads it). */
export const categoriesOfRecord = (record: EnrichRecord): Record<string, string> =>
  categoriesFrom(record);

const statedGross = (a: Application) =>
  a.stated_gross_annual != null && a.stated_gross_annual > 0 ? a.stated_gross_annual : null;

/** The rate the proposed repayment is assessed at: the product rate plus the buffer, or the floor. */
const assessmentRate = (r: AssessmentRequest) =>
  Math.max(r.loan.product_rate_pct + r.policy.buffer_pct, r.policy.floor_rate_pct);

/** What INC reads from the application, with the loan and its proposed repayment from the request. */
export function incApplicationOf(a: Application, r: AssessmentRequest): IncApplication {
  return {
    stated_gross_annual: statedGross(a),
    occupation: a.occupation ?? null,
    loan_amount: r.loan.amount,
    proposed_repayment_monthly: Math.round(
      repayment(r.loan.amount, assessmentRate(r), r.loan.term_months),
    ),
  };
}

const DECLARED_TYPE: Record<string, LiabilityType> = {
  car_loan: "car_loan",
  personal_loan: "personal_loan",
  loan: "personal_loan",
  mortgage: "mortgage",
  credit_card: "credit_card",
  bnpl: "bnpl",
  sacc: "sacc",
  wage_advance: "wage_advance",
};
const FOUND_TYPE: Record<string, LiabilityType> = {
  loan: "personal_loan",
  credit_card: "credit_card",
  bnpl: "bnpl",
  sacc: "sacc",
  wage_advance: "wage_advance",
};
const round2 = (x: number) => Math.round(x * 100) / 100;
/** The types whose commitment is their 3-month average outflow (Product Specification 6.4). */
const BY_OUTFLOW: ReadonlySet<LiabilityType> = new Set(["bnpl", "sacc", "wage_advance"]);

type IncIncome = Pick<IncResult, "income">;
type LiaFound = { liabilities: { family: string; monthly: number | null; declared: boolean }[] };
type Expenses = Pick<
  ObservedExpenses,
  "committed_monthly" | "basic_monthly" | "unverified_monthly"
>;

/**
 * The affordability engine's input (ADR 0012): INC's streams, monthly, by type; the application's
 * stated gross; observed committed expenses, and basic expenses with the unverified line (SIG-81:
 * other_expenses, essential and unverified, inside living expenses), and the request's confirmed figure and
 * benchmark if it gives them; every declared liability at its stated repayment, and every
 * liability LIA found that matches no declaration exactly, at its observed repayment.
 */
export function affordabilityInputOf(o: {
  application: Application;
  request: AssessmentRequest;
  inc: IncIncome;
  lia: LiaFound;
  expenses: Expenses;
}): AffordabilityInput {
  const { application: a, request: r } = o;
  const declared: Liability[] = a.declared_liabilities.map((d) => {
    const type = DECLARED_TYPE[d.type] ?? "declared_only";
    const stated = d.repayment_monthly ?? null;
    return {
      type,
      source: "declared",
      stated_repayment: stated,
      ...(BY_OUTFLOW.has(type) ? { average_outflow_3m: stated } : {}),
    };
  });
  const found: Liability[] = o.lia.liabilities
    .filter((l) => !l.declared)
    .map((l) => {
      const type = FOUND_TYPE[l.family] ?? "personal_loan";
      return {
        type,
        source: "found",
        observed_repayment: l.monthly,
        ...(BY_OUTFLOW.has(type) ? { average_outflow_3m: l.monthly } : {}),
      };
    });
  return {
    product_type: r.product_type,
    loan: r.loan,
    policy: r.policy,
    income: {
      streams: o.inc.income.map((s) => ({
        type: s.type,
        cadence: "monthly",
        amount: s.observed_amount,
      })),
      stated_gross_annual: statedGross(a),
    },
    expenses: {
      confirmed_monthly: r.confirmed_expenses_monthly,
      benchmark_monthly: r.benchmark?.monthly ?? null,
      observed_committed_monthly: o.expenses.committed_monthly,
      observed_basic_monthly: round2(o.expenses.basic_monthly + o.expenses.unverified_monthly),
    },
    liabilities: [...declared, ...found],
    benchmark: r.benchmark
      ? { name: r.benchmark.name, version: r.benchmark.version, is_seed: r.benchmark.is_seed }
      : { name: "none: the expense method reads no benchmark", version: 0, is_seed: false },
  };
}

/** One assessment of one applicant, on the request. */
export async function assessApplicant(input: AssessmentInput) {
  const { request: r, application: a } = input;
  const txs: EnrichTx[] = input.feed.accounts.flatMap((acc) =>
    acc.transactions.map((t) => ({
      transactionId: t.transactionId,
      description: t.description,
      amount: t.amount,
      ...(t.merchantCategoryCode !== undefined
        ? { merchantCategoryCode: t.merchantCategoryCode }
        : {}),
      ...(t.merchantName !== undefined ? { merchantName: t.merchantName } : {}),
      ...(t.billerCode !== undefined ? { billerCode: t.billerCode } : {}),
      ...(t.billerName !== undefined ? { billerName: t.billerName } : {}),
      ...(t.reference !== undefined ? { reference: t.reference } : {}),
    })),
  );
  const enrich = await categoriseForAssessment({
    tenant: { status: r.enrich.tenant_status },
    txs,
    local: pinnedLocalEnrich(),
    api: null,
    realConsented: r.enrich.real_consented,
    forceLocal: r.enrich.force_local,
  });
  const categories = categoriesOfRecord(enrich);
  const common = {
    feed: input.feed as unknown as Feed,
    feed_type: input.feed_type,
    as_of: r.as_of,
    lookback_months: r.lookback_months,
    categories,
  };
  const ctx = assessEvidence(common);
  const inc = assessInc({ ...common, application: incApplicationOf(a, r) });
  const lia: LiaResult = assessLia({
    ...common,
    feed: input.feed as never,
    application: { declared_liabilities: a.declared_liabilities },
  });
  // SIG-81: LIA's repayments (its liabilities' evidence) are debt repayments whatever their
  // category, so never also living expenses.
  const expenses = deriveObservedExpenses({
    feed: input.feed as never,
    categories,
    as_of: r.as_of,
    lookback_months: r.lookback_months,
    one_off_threshold_aud: 5000,
    liability_repayments: [...new Set(lia.liabilities.flatMap((l) => l.evidence))].sort(),
  });
  const affordability = computeAffordability(
    affordabilityInputOf({ application: a, request: r, inc, lia, expenses }),
  );
  const evidence = { rollup: evidenceRollup(ctx), checks: ctx.checks };
  return {
    composition_version: ASSESSMENT_COMPOSITION_VERSION,
    ...(input.applicant_id !== undefined ? { applicant_id: input.applicant_id } : {}),
    enrich,
    evidence,
    inc,
    lia,
    expenses,
    affordability,
    rollup: {
      evidence: evidence.rollup.state,
      movers: rollupMovers([...inc.signals, ...lia.signals]),
    },
  };
}
export type Assessment = Awaited<ReturnType<typeof assessApplicant>>;
