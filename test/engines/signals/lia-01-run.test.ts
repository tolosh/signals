// SIG-18 T4, in the D28 form: CI asserts that the pre-registered runs reproduce their recorded
// result from the committed inputs (set v1 regenerated from its seed and hash-checked, and the
// committed category cache), not that the result meets its target. The verdict is in the run
// records, the ticket and the hypothesis page Results log.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadSet, scoreSet } from "../../../src/research/liabilities-score.js";

type Run = ReturnType<typeof scoreSet>;
const record = (mode: string) =>
  JSON.parse(
    readFileSync(`research/runs/2026-11-07-synthetic-v1-liabilities-v1.0.0-${mode}.json`, "utf8"),
  ) as { runs: Run[] };
const counts = (r: Partial<Run>) => ({
  precision: r.precision,
  recall: r.recall,
  true_positives: r.true_positives,
  false_positives: r.false_positives,
  false_negatives: r.false_negatives,
  false_positive_causes: r.false_positive_causes,
  false_negative_causes: r.false_negative_causes,
  by_family: r.by_family,
});

let set: ReturnType<typeof loadSet>;
beforeAll(() => {
  set = loadSet();
}, 120_000);

describe("T4 the SIG-18 runs reproduce their records (D28)", () => {
  it("the negative control (rotated declarations) reproduces", () => {
    const [recorded] = record("control").runs;
    if (!recorded) throw new Error("no control run");
    const now = scoreSet(set.applicants, set.categories, recorded.config, recorded.variant);
    expect(counts(now)).toEqual(counts(recorded));
    expect(now.false_positives_list).toEqual(recorded.false_positives_list);
  }, 120_000);

  it("the primary run reproduces exactly", () => {
    const [recorded] = record("primary").runs;
    if (!recorded) throw new Error("no primary run");
    const now = scoreSet(set.applicants, set.categories, recorded.config, recorded.variant);
    expect(counts(now)).toEqual(counts(recorded));
    expect(now.false_negatives_list).toEqual(recorded.false_negatives_list);
    expect(now.false_positives_list).toEqual(recorded.false_positives_list);
  }, 120_000);

  it("every grid setting reproduces", () => {
    for (const recorded of record("grid").runs) {
      const now = scoreSet(set.applicants, set.categories, recorded.config, recorded.variant);
      expect(counts(now)).toEqual(counts(recorded));
    }
  }, 120_000);
});
