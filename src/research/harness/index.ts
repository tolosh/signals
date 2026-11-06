// Scoring harness (SIG-13): runs an engine over a generated data set, compares what it derives
// with the ground truth, and returns a run record. The engine sees only what a lender would
// have, the application and the feed, never the ground truth. Pure: the caller supplies the
// timestamp, commit and versions.
import type { GeneratedApplicant, GroundTruth } from "../generator/index.js";

export const RUN_RECORD_SCHEMA_VERSION = "1.0.0";

/** Candidate pass conditions from the hypothesis page: income within 5%, expenses within 15%. */
export const DEFAULT_TOLERANCES = { income_pct: 0.05, expenses_pct: 0.15 };

export type FlagName =
  | "gambling"
  | "dishonours"
  | "salary_account_unshared"
  | "transfers_to_unshared"
  | "rent_on_time"
  | "cards_cleared_in_full"
  | "savings_growing";

export type DerivedLiability = { type: string; provider?: string; undisclosed?: boolean };
export type Derived = {
  income_net_monthly: number;
  expenses_total_monthly: number;
  liabilities: DerivedLiability[];
  flags: Partial<Record<FlagName, boolean>>;
};
export type EngineInput = {
  applicant_id: string;
  application: GeneratedApplicant["application"];
  feed: GeneratedApplicant["feed"];
};
export type Engine = (input: EngineInput) => Derived;

export type RunContext = {
  run_id: string;
  created_at: string;
  ticket: string;
  dataset: {
    set: string;
    seed: number;
    set_sha256: string;
    generator_version: string;
    ground_truth_schema_version: string;
  };
  engine: { name: string; commit: string; version: string };
  versions: { definitions: string; thresholds: string; taxonomy: string };
  tolerances?: typeof DEFAULT_TOLERANCES;
};

type Counts = { true_positives: number; false_positives: number; false_negatives: number };
type Rates = Counts & { precision: number | null; recall: number | null };
type ErrorStats = {
  scored: number;
  mean_abs_error: number;
  mean_abs_pct_error: number;
  mean_signed_pct_error: number;
  within_tolerance_share: number;
  tolerance_pct: number;
};
type Comparison = {
  truth: number;
  derived: number;
  abs_error: number;
  pct_error: number | null;
  within_tolerance: boolean | null;
};
export type Miss = {
  applicant_id: string;
  tags: string[];
  measure: string;
  truth: unknown;
  derived: unknown;
  error: number | null;
  /** For the researcher to tag during miss analysis. */
  cause: null;
};
export type RunRecord = {
  schema_version: string;
  run_id: string;
  ticket: string;
  created_at: string;
  dataset: RunContext["dataset"];
  engine: RunContext["engine"];
  versions: RunContext["versions"];
  tolerances: typeof DEFAULT_TOLERANCES;
  applicants: number;
  metrics: {
    income: ErrorStats;
    expenses: ErrorStats;
    liabilities: { all: Rates; undisclosed: Rates };
    flags: Record<FlagName, Rates>;
  };
  per_applicant: {
    applicant_id: string;
    tags: string[];
    income: Comparison;
    expenses: Comparison;
    liabilities: Counts & { undisclosed_false_negatives: number };
    flag_mismatches: FlagName[];
  }[];
  misses: Miss[];
};

const FLAGS: FlagName[] = [
  "gambling",
  "dishonours",
  "salary_account_unshared",
  "transfers_to_unshared",
  "rent_on_time",
  "cards_cleared_in_full",
  "savings_growing",
];

/** The true value of every scored flag, from the ground truth. */
export function truthFlags(t: GroundTruth): Record<FlagName, boolean> {
  return {
    gambling: t.behaviours.gambling_monthly !== null,
    dishonours: t.behaviours.dishonours > 0,
    salary_account_unshared: !t.coverage.salary_account_shared,
    transfers_to_unshared: t.coverage.transfers_to_unshared_count > 0,
    rent_on_time: t.behaviours.positive.rent_on_time,
    cards_cleared_in_full: t.behaviours.positive.cards_cleared_in_full,
    savings_growing: t.behaviours.positive.savings_growing,
  };
}

const ratio = (num: number, den: number) => (den === 0 ? null : num / den);
const rates = (c: Counts): Rates => ({
  ...c,
  precision: ratio(c.true_positives, c.true_positives + c.false_positives),
  recall: ratio(c.true_positives, c.true_positives + c.false_negatives),
});
const add = (a: Counts, b: Counts): Counts => ({
  true_positives: a.true_positives + b.true_positives,
  false_positives: a.false_positives + b.false_positives,
  false_negatives: a.false_negatives + b.false_negatives,
});
const ZERO: Counts = { true_positives: 0, false_positives: 0, false_negatives: 0 };

function compare(truth: number, derived: number, tolerance: number): Comparison {
  const pct = truth > 0 ? (derived - truth) / truth : null;
  return {
    truth,
    derived,
    abs_error: Math.abs(derived - truth),
    pct_error: pct,
    within_tolerance: pct === null ? null : Math.abs(pct) <= tolerance,
  };
}

function stats(rows: Comparison[], tolerance: number): ErrorStats {
  const scored = rows.filter((r) => r.pct_error !== null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  return {
    scored: scored.length,
    mean_abs_error: mean(rows.map((r) => r.abs_error)),
    mean_abs_pct_error: mean(scored.map((r) => Math.abs(r.pct_error ?? 0))),
    mean_signed_pct_error: mean(scored.map((r) => r.pct_error ?? 0)),
    within_tolerance_share: scored.length
      ? scored.filter((r) => r.within_tolerance).length / scored.length
      : 0,
    tolerance_pct: tolerance,
  };
}

/** One-to-one match on type, and on provider when the engine names one. */
function matchLiabilities(truth: GroundTruth["liabilities"]["items"], found: DerivedLiability[]) {
  const unused = [...found];
  const missed: GroundTruth["liabilities"]["items"] = [];
  let matched = 0;
  for (const item of truth) {
    const i = unused.findIndex(
      (d) =>
        d.type === item.type &&
        (d.provider === undefined || d.provider.toUpperCase() === item.provider.toUpperCase()),
    );
    if (i >= 0) {
      unused.splice(i, 1);
      matched++;
    } else missed.push(item);
  }
  return { matched, missed, extra: unused };
}

export function score(
  applicants: GeneratedApplicant[],
  engine: Engine,
  context: RunContext,
): RunRecord {
  const tolerances = context.tolerances ?? DEFAULT_TOLERANCES;
  const misses: Miss[] = [];
  let liabilitiesAll = ZERO;
  let liabilitiesUndisclosed = ZERO;
  const flagCounts = Object.fromEntries(FLAGS.map((f) => [f, ZERO])) as Record<FlagName, Counts>;

  const perApplicant = applicants.map((a) => {
    const t = a.truth;
    const id = t.applicant_id;
    const derived = engine({ applicant_id: id, application: a.application, feed: a.feed });
    const miss = (measure: string, truth: unknown, value: unknown, error: number | null) =>
      misses.push({
        applicant_id: id,
        tags: t.tags,
        measure,
        truth,
        derived: value,
        error,
        cause: null,
      });

    const income = compare(t.income.net_monthly, derived.income_net_monthly, tolerances.income_pct);
    if (income.within_tolerance === false)
      miss("income", income.truth, income.derived, income.pct_error);
    const expenses = compare(
      t.expenses.total_monthly,
      derived.expenses_total_monthly,
      tolerances.expenses_pct,
    );
    if (expenses.within_tolerance === false)
      miss("expenses", expenses.truth, expenses.derived, expenses.pct_error);

    const all = matchLiabilities(t.liabilities.items, derived.liabilities);
    for (const m of all.missed)
      miss("liability_missed", { type: m.type, provider: m.provider }, null, null);
    for (const e of all.extra) miss("liability_extra", null, e, null);
    const counts: Counts = {
      true_positives: all.matched,
      false_positives: all.extra.length,
      false_negatives: all.missed.length,
    };
    liabilitiesAll = add(liabilitiesAll, counts);

    const undisclosedTruth = t.liabilities.items.filter((l) => !l.declared);
    const undisclosedFound = derived.liabilities.filter((l) => l.undisclosed === true);
    const und = matchLiabilities(undisclosedTruth, undisclosedFound);
    const undisclosedRecall = matchLiabilities(undisclosedTruth, derived.liabilities);
    liabilitiesUndisclosed = add(liabilitiesUndisclosed, {
      true_positives: undisclosedRecall.matched,
      false_positives: und.extra.length,
      false_negatives: undisclosedRecall.missed.length,
    });

    const expected = truthFlags(t);
    const mismatches: FlagName[] = [];
    for (const f of FLAGS) {
      const said = derived.flags[f];
      if (said === undefined) continue;
      const c = flagCounts[f];
      flagCounts[f] = {
        true_positives: c.true_positives + (said && expected[f] ? 1 : 0),
        false_positives: c.false_positives + (said && !expected[f] ? 1 : 0),
        false_negatives: c.false_negatives + (!said && expected[f] ? 1 : 0),
      };
      if (said !== expected[f]) {
        mismatches.push(f);
        miss(`flag:${f}`, expected[f], said, null);
      }
    }

    return {
      applicant_id: id,
      tags: t.tags,
      income,
      expenses,
      liabilities: { ...counts, undisclosed_false_negatives: undisclosedRecall.missed.length },
      flag_mismatches: mismatches,
    };
  });

  return {
    schema_version: RUN_RECORD_SCHEMA_VERSION,
    run_id: context.run_id,
    ticket: context.ticket,
    created_at: context.created_at,
    dataset: context.dataset,
    engine: context.engine,
    versions: context.versions,
    tolerances,
    applicants: applicants.length,
    metrics: {
      income: stats(
        perApplicant.map((p) => p.income),
        tolerances.income_pct,
      ),
      expenses: stats(
        perApplicant.map((p) => p.expenses),
        tolerances.expenses_pct,
      ),
      liabilities: { all: rates(liabilitiesAll), undisclosed: rates(liabilitiesUndisclosed) },
      flags: Object.fromEntries(FLAGS.map((f) => [f, rates(flagCounts[f])])) as Record<
        FlagName,
        Rates
      >,
    },
    per_applicant: perApplicant,
    misses,
  };
}

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(2)}%`);

/** A short markdown summary to sit beside the JSON run record. */
export function summarise(r: RunRecord): string {
  const m = r.metrics;
  const rateRow = (name: string, x: Rates) =>
    `| ${name} | ${pct(x.precision)} | ${pct(x.recall)} | ${x.true_positives} | ${x.false_positives} | ${x.false_negatives} |`;
  const byMeasure = new Map<string, number>();
  for (const miss of r.misses) byMeasure.set(miss.measure, (byMeasure.get(miss.measure) ?? 0) + 1);
  return [
    `# Run ${r.run_id}`,
    "",
    `Ticket ${r.ticket} · engine ${r.engine.name} ${r.engine.version} at commit ${r.engine.commit} · created ${r.created_at}`,
    "",
    `Data set ${r.dataset.set} (seed ${r.dataset.seed}, ${r.applicants} applicants, SHA-256 ${r.dataset.set_sha256}). Versions: definitions ${r.versions.definitions}, thresholds ${r.versions.thresholds}, taxonomy ${r.versions.taxonomy}.`,
    "",
    "| Measure | Scored | Mean abs error | Mean abs % error | Mean signed % error | Within tolerance |",
    "| --- | --- | --- | --- | --- | --- |",
    `| Income (±${pct(m.income.tolerance_pct)}) | ${m.income.scored} | ${m.income.mean_abs_error.toFixed(2)} | ${pct(m.income.mean_abs_pct_error)} | ${pct(m.income.mean_signed_pct_error)} | ${pct(m.income.within_tolerance_share)} |`,
    `| Expenses (±${pct(m.expenses.tolerance_pct)}) | ${m.expenses.scored} | ${m.expenses.mean_abs_error.toFixed(2)} | ${pct(m.expenses.mean_abs_pct_error)} | ${pct(m.expenses.mean_signed_pct_error)} | ${pct(m.expenses.within_tolerance_share)} |`,
    "",
    "| Detection | Precision | Recall | TP | FP | FN |",
    "| --- | --- | --- | --- | --- | --- |",
    rateRow("Liabilities, all", m.liabilities.all),
    rateRow("Liabilities, undisclosed", m.liabilities.undisclosed),
    ...Object.entries(m.flags).map(([f, x]) => rateRow(`Flag: ${f}`, x)),
    "",
    `## Misses (${r.misses.length})`,
    "",
    r.misses.length ? [...byMeasure].map(([k, n]) => `- ${k}: ${n}`).join("\n") : "None.",
    "",
    "Each miss is listed in the JSON record with `cause` left empty for the researcher to tag.",
    "",
  ].join("\n");
}
