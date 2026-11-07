// SIG-13 section 6 tests: the scoring harness against stub engines with known errors.
import { describe, expect, it } from "vitest";
import {
  generateApplicant,
  population,
  type GeneratedApplicant,
} from "../../src/research/generator/index.js";
import {
  RUN_RECORD_SCHEMA_VERSION,
  score,
  summarise,
  truthFlags,
  type Derived,
  type Engine,
  type RunContext,
} from "../../src/research/harness/index.js";

const SEED = 42;
// A small, mixed slice of set v1 keeps the tests quick; every variant is represented.
const applicants: GeneratedApplicant[] = population(SEED)
  .filter((_, i) => i % 19 === 0 || i >= 200)
  .filter((_, i) => i % 3 === 0)
  .map((spec) => generateApplicant(spec, SEED));
const truthById = new Map(applicants.map((a) => [a.truth.applicant_id, a.truth]));

/** Test-only oracle: answers with the ground truth the harness never shows an engine. */
const oracle =
  (tweak: (d: Derived) => Derived = (d) => d): Engine =>
  ({ applicant_id }) => {
    const t = truthById.get(applicant_id);
    if (!t) throw new Error(`no truth for ${applicant_id}`);
    return tweak({
      income_net_monthly: t.income.net_monthly,
      expenses_total_monthly: t.expenses.total_monthly,
      liabilities: t.liabilities.items.map((l) => ({ type: l.type, provider: l.provider })),
      flags: truthFlags(t),
    });
  };

const context: RunContext = {
  run_id: "test-run",
  created_at: "2026-11-07T00:00:00Z",
  ticket: "SIG-13",
  dataset: {
    set: "synthetic-v1",
    seed: SEED,
    set_sha256: "test",
    generator_version: "1.0.0",
    ground_truth_schema_version: "1.0.0",
  },
  engine: { name: "oracle", commit: "0000000", version: "test" },
  versions: { definitions: "none", thresholds: "none", taxonomy: "1.4" },
};
const run = (engine: Engine, ctx: RunContext = context) => score(applicants, engine, ctx);

describe("T1 an engine that returns ground truth scores perfectly", () => {
  const record = run(oracle());

  it("has zero income and expense error", () => {
    expect(record.metrics.income.mean_abs_pct_error).toBe(0);
    expect(record.metrics.income.mean_abs_error).toBe(0);
    expect(record.metrics.expenses.mean_abs_pct_error).toBe(0);
    expect(record.metrics.income.within_tolerance_share).toBe(1);
  });

  it("has precision and recall of 1 for liabilities and every flag that occurs", () => {
    expect(record.metrics.liabilities.all.precision).toBe(1);
    expect(record.metrics.liabilities.all.recall).toBe(1);
    expect(record.metrics.liabilities.undisclosed.recall).toBe(1);
    const scored = Object.values(record.metrics.flags).filter((f) => f.precision !== null);
    expect(scored.length).toBeGreaterThan(3);
    for (const f of scored) {
      expect(f.precision).toBe(1);
      expect(f.recall).toBe(1);
    }
    expect(record.misses).toEqual([]);
  });
});

describe("T2 an engine that adds 10% to income", () => {
  const record = run(oracle((d) => ({ ...d, income_net_monthly: d.income_net_monthly * 1.1 })));

  it("shows a mean income error of 10% ± 0.01", () => {
    expect(Math.abs(record.metrics.income.mean_abs_pct_error - 0.1)).toBeLessThanOrEqual(0.0001);
    expect(Math.abs(record.metrics.income.mean_signed_pct_error - 0.1)).toBeLessThanOrEqual(0.0001);
  });

  it("puts every scored applicant outside the 5% income tolerance, and expenses stay exact", () => {
    expect(record.metrics.income.within_tolerance_share).toBe(0);
    expect(record.metrics.expenses.mean_abs_pct_error).toBe(0);
    expect(record.misses.every((m) => m.measure === "income" && m.cause === null)).toBe(true);
  });

  it("negative control: an engine that finds no liabilities has recall 0", () => {
    const blind = run(oracle((d) => ({ ...d, liabilities: [] })));
    expect(blind.metrics.liabilities.all.recall).toBe(0);
    expect(blind.metrics.liabilities.all.precision).toBeNull();
  });

  it("negative control: an engine that invents a liability loses precision", () => {
    const invents = run(
      oracle((d) => ({ ...d, liabilities: [...d.liabilities, { type: "sacc" }] })),
    );
    expect(invents.metrics.liabilities.all.precision).toBeLessThan(1);
    expect(invents.metrics.liabilities.all.recall).toBe(1);
  });
});

describe("T3 the same inputs twice give identical records apart from the timestamp", () => {
  it("is identical once created_at is set aside", () => {
    const a = run(oracle((d) => ({ ...d, income_net_monthly: d.income_net_monthly * 0.97 })));
    const b = run(
      oracle((d) => ({ ...d, income_net_monthly: d.income_net_monthly * 0.97 })),
      { ...context, created_at: "2026-11-08T09:30:00Z" },
    );
    expect(a.created_at).not.toBe(b.created_at);
    expect(JSON.stringify({ ...a, created_at: null })).toBe(
      JSON.stringify({ ...b, created_at: null }),
    );
  });
});

describe("T4 the run record carries every field in the expected outcome", () => {
  const record = run(oracle());

  it("has the data set hash, engine commit, versions, metrics and per-applicant errors", () => {
    expect(record.schema_version).toBe(RUN_RECORD_SCHEMA_VERSION);
    expect(record.dataset.set_sha256).toBe("test");
    expect(record.engine.commit).toBe("0000000");
    expect(Object.keys(record.versions).sort()).toEqual(["definitions", "taxonomy", "thresholds"]);
    expect(record.metrics.income).toBeDefined();
    expect(record.metrics.expenses).toBeDefined();
    expect(record.metrics.liabilities).toBeDefined();
    expect(record.per_applicant).toHaveLength(applicants.length);
    expect(record.per_applicant[0]).toHaveProperty("income.pct_error");
    expect(record.per_applicant[0]).toHaveProperty("expenses.pct_error");
    expect(record.per_applicant[0]).toHaveProperty("liabilities.false_negatives");
  });

  it("has a short markdown summary naming the data set, commit and headline metrics", () => {
    const md = summarise(record);
    expect(md).toContain("synthetic-v1");
    expect(md).toContain("0000000");
    expect(md).toMatch(/Income/);
    expect(md).toMatch(/Misses/);
  });

  it("never passes ground truth to the engine", () => {
    const seen: string[] = [];
    run((input) => {
      seen.push(Object.keys(input).sort().join(","));
      return { income_net_monthly: 0, expenses_total_monthly: 0, liabilities: [], flags: {} };
    });
    expect(new Set(seen)).toEqual(new Set(["applicant_id,application,feed"]));
  });
});

// SIG-17: living expenses are scored against committed plus basic (AF-E1, AF-E3), not the total
// that includes discretionary spend. The default stays the SIG-13 behaviour.
describe("expense_truth selects which ground-truth expense figure is scored", () => {
  const committedPlusBasic = oracle((d) => d);
  it("defaults to total_monthly, as in SIG-13", () => {
    expect(run(oracle()).expense_truth).toBe("total_monthly");
  });

  it("committed_plus_basic scores against committed + basic", () => {
    const engine: Engine = (input) => {
      const t = truthById.get(input.applicant_id);
      if (!t) throw new Error("no truth");
      return {
        ...committedPlusBasic(input),
        expenses_total_monthly: t.expenses.committed_monthly + t.expenses.basic_monthly,
      };
    };
    const record = run(engine, { ...context, expense_truth: "committed_plus_basic" });
    expect(record.expense_truth).toBe("committed_plus_basic");
    expect(record.metrics.expenses.mean_abs_pct_error).toBe(0);
    expect(run(engine).metrics.expenses.mean_abs_pct_error).toBeGreaterThan(0);
  });
});
