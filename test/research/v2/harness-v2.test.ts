// SIG-54: the scoring harness (SIG-13) reads ground truth 2.0.0 and still reads 1.0.0. Set v1 has
// no dishonours, so the dishonours flag scored null there (SIG-13's known limit); on set v2 it
// is scored, against the dated dishonour groups.
import { describe, expect, it } from "vitest";
import {
  SET_V2_SEED,
  generateApplicant,
  population,
  populationV2,
  type GeneratedApplicant,
} from "../../../src/research/generator/index.js";
import {
  score,
  truthFlags,
  type Engine,
  type RunContext,
} from "../../../src/research/harness/index.js";

const ctx = (set: string, seed: number, version: string): RunContext => ({
  run_id: "test",
  created_at: "2026-11-08T00:00:00Z",
  ticket: "SIG-54",
  dataset: {
    set,
    seed,
    set_sha256: "test",
    generator_version: version,
    ground_truth_schema_version: version,
  },
  engine: { name: "oracle", commit: "0000000", version: "test" },
  versions: { definitions: "none", thresholds: "none", taxonomy: "1.4" },
});
const oracle = (applicants: GeneratedApplicant[]): Engine => {
  const byId = new Map(applicants.map((a) => [a.truth.applicant_id, a.truth]));
  return ({ applicant_id }) => {
    const t = byId.get(applicant_id)!;
    return {
      income_net_monthly: t.income.net_monthly,
      expenses_total_monthly: t.expenses.total_monthly,
      liabilities: t.liabilities.items.map((l) => ({ type: l.type, provider: l.provider })),
      flags: truthFlags(t),
    };
  };
};

describe("the harness reads both schemas", () => {
  const v1 = population(42)
    .filter((_, i) => i % 10 === 0)
    .map((s) => generateApplicant(s, 42));
  const v2 = populationV2(SET_V2_SEED)
    .filter((_, i) => i % 5 === 0)
    .map((s) => generateApplicant(s, SET_V2_SEED));

  it("1.0.0: scores a set v1 slice perfectly with the oracle, and dishonours stays unscored", () => {
    const r = score(v1, oracle(v1), ctx("synthetic-v1", 42, "1.0.0"));
    expect(r.metrics.income.mean_abs_pct_error).toBe(0);
    expect(r.metrics.flags.dishonours.precision).toBeNull();
  });

  it("2.0.0: scores a set v2 slice perfectly, and the dishonours flag is now scored", () => {
    expect(v2.every((a) => a.truth.schema_version === "2.0.0")).toBe(true);
    const r = score(v2, oracle(v2), ctx("synthetic-v2", SET_V2_SEED, "2.0.0"));
    expect(r.metrics.income.mean_abs_pct_error).toBe(0);
    expect(r.metrics.flags.dishonours.true_positives).toBeGreaterThan(0);
    expect(r.metrics.flags.dishonours.precision).toBe(1);
    expect(r.dataset.ground_truth_schema_version).toBe("2.0.0");
  });
});
