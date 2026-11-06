// Affordability calculation core: Product Specification 6.1 to 6.6 (AF-1, AF-T1).
// A pure function of its inputs and a threshold set. Interpretations of the specification are
// recorded in docs/adr/0001-af-t1-inputs-and-interpretations.md and cited here as I-n.
import { DEFAULT_THRESHOLDS, type Bound, type RatioRule, type ThresholdSet } from "./thresholds.js";

export { DEFAULT_THRESHOLDS, type ThresholdSet } from "./thresholds.js";

export type Cadence = "weekly" | "fortnightly" | "monthly" | "annual";
export type IncomeStream = { type: string; cadence: Cadence; amount: number };
export type LiabilityType =
  | "credit_card"
  | "charge_card"
  | "overdraft"
  | "personal_loan"
  | "car_loan"
  | "mortgage"
  | "bnpl"
  | "sacc"
  | "wage_advance"
  | "declared_only";
export type Liability = {
  type: LiabilityType;
  source: "declared" | "found" | "inferred";
  balance?: number | null;
  limit?: number | null;
  stated_repayment?: number | null;
  observed_repayment?: number | null;
  average_outflow_3m?: number | null;
  rate_pct?: number | null;
  remaining_term_months?: number | null;
};

export type AffordabilityInput = {
  product_type: "personal" | "home" | "car" | "business";
  loan: {
    amount: number;
    term_months: number;
    product_rate_pct: number;
    security_value?: number | null;
    other_secured_debt_on_security?: number | null;
  };
  policy: {
    buffer_pct: number;
    floor_rate_pct: number;
    card_commitment_factor: number;
    shading: Record<string, number>;
  };
  income: { streams: IncomeStream[]; stated_gross_annual: number | null };
  expenses: {
    confirmed_monthly: number | null;
    benchmark_monthly: number | null;
    observed_committed_monthly: number;
    observed_basic_monthly: number;
  };
  liabilities: Liability[];
  benchmark: { name: string; version: number; is_seed: boolean };
};

export type RatioState = "green" | "amber" | "red" | "unverified" | null;
export type Ratio = {
  key: "dsr" | "ndi" | "ara" | "lvr" | "benchmark_gle" | "lti" | "dti";
  label: string;
  value?: number;
  unit?: "aud";
  numerator?: number;
  denominator?: number;
  gross?: number;
  net?: number;
  state: RatioState;
};
export type TraceStep = { step: string; value: number | null; inputs: Record<string, unknown> };
export type AffordabilityResult = {
  affordability: {
    status: "complete" | "unverified";
    serviceability: {
      monthly_income: number;
      monthly_expenses_gle: number;
      monthly_repayments: number;
      proposed_repayment: number;
      total_expenses_annual: number;
    };
    ratios: Ratio[];
    benchmark: AffordabilityInput["benchmark"];
  };
  trace: TraceStep[];
  versions: { thresholds_version: number };
};

const MONTHLY: Record<Cadence, number> = {
  weekly: 52 / 12,
  fortnightly: 26 / 12,
  monthly: 1,
  annual: 1 / 12,
};

const round = (value: number, places: number) => {
  const f = 10 ** places;
  return Math.round((value + Number.EPSILON * Math.sign(value)) * f) / f;
};
const cents = (value: number) => round(value, 2);
const ratio2 = (value: number) => round(value, 2);
// I-1: monthly repayments are taken to the whole dollar before they enter any figure.
const dollars = (value: number) => round(value, 0);

/** Monthly principal-and-interest repayment. */
export function repayment(principal: number, annualRatePct: number, months: number): number {
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - (1 + r) ** -months);
}

/** Product Specification 6.4: the default monthly commitment rule for each liability. */
function commitment(l: Liability, input: AffordabilityInput, assessmentRatePct: number): number {
  const stated = l.stated_repayment ?? 0;
  const observed = l.observed_repayment ?? 0;
  switch (l.type) {
    case "credit_card":
    case "charge_card":
    case "overdraft":
      return Math.max(stated, input.policy.card_commitment_factor * (l.limit ?? 0));
    case "personal_loan":
    case "car_loan":
      return Math.max(observed, stated);
    case "mortgage":
      return l.balance != null && l.remaining_term_months
        ? repayment(l.balance, assessmentRatePct, l.remaining_term_months)
        : observed;
    case "bnpl":
    case "sacc":
    case "wage_advance":
      return l.average_outflow_3m ?? 0;
    case "declared_only":
      return stated;
  }
}

const meets = (value: number, b: Bound) =>
  b.op === "gt"
    ? value > b.value
    : b.op === "gte"
      ? value >= b.value
      : b.op === "lt"
        ? value < b.value
        : value <= b.value;

// I-4: states are judged on the unrounded value.
function stateOf(value: number, rule: RatioRule): RatioState {
  if (!rule) return null;
  if (rule.red && meets(value, rule.red)) return "red";
  return meets(value, rule.amber) ? "amber" : "green";
}

const SEVERITY: RatioState[] = ["green", "amber", "red"];
// I-5: a ratio reported on gross and net income takes the worse of the two states.
const worse = (a: RatioState, b: RatioState): RatioState =>
  SEVERITY.indexOf(a) >= SEVERITY.indexOf(b) ? a : b;

export function computeAffordability(
  input: AffordabilityInput,
  thresholds: ThresholdSet = DEFAULT_THRESHOLDS,
): AffordabilityResult {
  const trace: TraceStep[] = [];
  const step = (name: string, value: number | null, inputs: Record<string, unknown>) => {
    trace.push({ step: name, value, inputs });
    return value;
  };
  const rules = thresholds.ratios;

  // 6.2 income: recurring streams normalised to monthly, shaded by type.
  const streams = input.income.streams.map((s) => ({
    type: s.type,
    monthly: s.amount * MONTHLY[s.cadence],
    shading: input.policy.shading[s.type] ?? 0,
  }));
  const income = streams.reduce((sum, s) => sum + s.monthly * s.shading, 0);
  step("income", income, { streams });

  // 6.3 expenses: default method, the higher of confirmed, benchmark and observed committed
  // plus basic (AF-E3). I-6: only the default method is implemented.
  const observed =
    input.expenses.observed_committed_monthly + input.expenses.observed_basic_monthly;
  const gle = Math.max(
    input.expenses.confirmed_monthly ?? 0,
    input.expenses.benchmark_monthly ?? 0,
    observed,
  );
  step("gle", gle, {
    ...input.expenses,
    observed,
    method: "highest_of_confirmed_benchmark_observed",
  });

  const assessmentRate = Math.max(
    input.loan.product_rate_pct + input.policy.buffer_pct,
    input.policy.floor_rate_pct,
  );
  step("assessment_rate", assessmentRate, {
    product_rate_pct: input.loan.product_rate_pct,
    buffer_pct: input.policy.buffer_pct,
    floor_rate_pct: input.policy.floor_rate_pct,
  });

  // 6.4 liabilities.
  const commitments = input.liabilities.map((l) => ({
    type: l.type,
    source: l.source,
    monthly: dollars(commitment(l, input, assessmentRate)),
  }));
  const repayments = commitments.reduce((sum, c) => sum + c.monthly, 0);
  step("repayments", repayments, { commitments });

  const unrounded = repayment(input.loan.amount, assessmentRate, input.loan.term_months);
  const proposed = dollars(unrounded);
  step("proposed_repayment", proposed, {
    loan_amount: input.loan.amount,
    assessment_rate_pct: assessmentRate,
    term_months: input.loan.term_months,
    unrounded,
  });

  const totalExpenses = step("total_expenses", (gle + repayments + proposed) * 12, {
    gle,
    repayments,
    proposed,
  }) as number;

  // I-3: the total debt counts card and overdraft limits instead of their balances.
  const isLimit = (l: Liability) => ["credit_card", "charge_card", "overdraft"].includes(l.type);
  const totalDebt =
    input.liabilities.reduce(
      (sum, l) => sum + (isLimit(l) ? (l.limit ?? 0) : (l.balance ?? 0)),
      0,
    ) + input.loan.amount;
  step("total_debt", totalDebt, {
    loan_amount: input.loan.amount,
    liabilities: input.liabilities.length,
  });

  const verified = income > 0;
  const annualNet = income * 12;
  // I-2: gross income is the stated gross salary; grossing up from net needs the resident tax
  // table, which is not built yet, so gross ratios are unverified without a stated figure.
  const gross = input.income.stated_gross_annual;

  const ara = verified
    ? step("ara", income - gle - repayments, { income, gle, repayments })
    : step("ara", null, { reason: "no income" });
  const dsr = verified
    ? step("dsr", (gle + repayments + proposed) / income, { gle, repayments, proposed, income })
    : step("dsr", null, { reason: "no income" });
  const ndi = verified
    ? step("ndi", (income - gle) / (repayments + proposed), { income, gle, repayments, proposed })
    : step("ndi", null, { reason: "no income" });

  const security = input.loan.security_value ?? 0;
  const securedDebt = input.loan.amount + (input.loan.other_secured_debt_on_security ?? 0);
  const lvr =
    security > 0
      ? step("lvr", securedDebt / security, { securedDebt, security })
      : step("lvr", null, { reason: "no security value" });

  const benchmark = input.expenses.benchmark_monthly;
  const benchmarkGle =
    benchmark != null && gle > 0
      ? step("benchmark_gle", benchmark / gle, { benchmark, gle })
      : step("benchmark_gle", null, { reason: "no benchmark" });

  const grossOk = verified && gross != null && gross > 0;
  const ltiGross = grossOk
    ? step("lti_gross", input.loan.amount / gross, { loan: input.loan.amount, gross })
    : step("lti_gross", null, { reason: "no stated gross income" });
  const ltiNet = verified
    ? step("lti_net", input.loan.amount / annualNet, { loan: input.loan.amount, annualNet })
    : step("lti_net", null, { reason: "no income" });
  const dtiGross = grossOk
    ? step("dti_gross", totalDebt / gross, { totalDebt, gross })
    : step("dti_gross", null, { reason: "no stated gross income" });
  const dtiNet = verified
    ? step("dti_net", totalDebt / annualNet, { totalDebt, annualNet })
    : step("dti_net", null, { reason: "no income" });

  const unverified = (key: Ratio["key"], label: string): Ratio => ({
    key,
    label,
    state: "unverified",
  });
  const simple = (
    key: Ratio["key"],
    label: string,
    value: number | null,
    rule: RatioRule,
    extra: Partial<Ratio> = {},
  ): Ratio =>
    value == null
      ? unverified(key, label)
      : { key, label, value: ratio2(value), ...extra, state: stateOf(value, rule) };
  const pair = (
    key: Ratio["key"],
    label: string,
    g: number | null,
    n: number | null,
    rule: RatioRule,
  ): Ratio => {
    if (n == null) return unverified(key, label);
    const netState = stateOf(n, rule);
    if (g == null) return { key, label, net: ratio2(n), state: "unverified" };
    return {
      key,
      label,
      gross: ratio2(g),
      net: ratio2(n),
      state: worse(stateOf(g, rule), netState),
    };
  };

  const ratios: Ratio[] = [
    simple("dsr", "DSR", dsr, rules.dsr),
    simple("ndi", "NDI", ndi, rules.ndi),
    ara == null
      ? unverified("ara", "ARA")
      : { key: "ara", label: "ARA", value: cents(ara), unit: "aud", state: null },
    simple("lvr", "LVR", lvr, rules.lvr, { numerator: securedDebt, denominator: security }),
    simple("benchmark_gle", "Benchmark / GLE", benchmarkGle, rules.benchmark_gle, {
      numerator: benchmark ?? 0,
      denominator: gle,
    }),
    pair("lti", "LTI", ltiGross, ltiNet, rules.lti),
    pair("dti", "DTI", dtiGross, dtiNet, rules.dti),
  ];

  return {
    affordability: {
      status: verified ? "complete" : "unverified",
      serviceability: {
        monthly_income: cents(income),
        monthly_expenses_gle: cents(gle),
        monthly_repayments: cents(repayments),
        proposed_repayment: cents(proposed),
        total_expenses_annual: cents(totalExpenses),
      },
      ratios,
      benchmark: { ...input.benchmark },
    },
    trace,
    versions: { thresholds_version: thresholds.version },
  };
}
