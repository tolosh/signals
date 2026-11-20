// SIG-57 T4 (D28) and T5: the committed primary run and the set v1 regression reproduce from the
// committed inputs. CI checks reproduction, not the target.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadAliases, loadSet, scoreRun, type RunSpec } from "../../src/research/sig57/score.js";

const record = (m: string, set = "synthetic-v2.2") =>
  JSON.parse(readFileSync(`research/runs/2026-11-19-${set}-sig57-${m}.json`, "utf8")) as {
    alias_table: { sha256: string };
    categories: { sha256: string };
    results: (ReturnType<typeof scoreRun> & { spec: RunSpec })[];
  };
const headline = (r: ReturnType<typeof scoreRun>) => ({
  precision: r.precision,
  recall: r.recall,
  tp: r.true_positives,
  fp: r.false_positives,
  fn: r.false_negatives,
  fp_causes: r.false_positive_causes,
  fn_causes: r.false_negative_causes,
});

describe("SIG-57 reproduces its records (D28)", () => {
  const aliases = loadAliases();

  it("T4: the primary run on set v2.2", () => {
    const rec = record("primary");
    const set = loadSet("synthetic-v2.2");
    expect(aliases.sha256).toBe(rec.alias_table.sha256);
    expect(set.categories_sha256).toBe(rec.categories.sha256);
    const want = rec.results[0]!;
    expect(headline(scoreRun(set, aliases.index, want.spec))).toEqual(headline(want));
  }, 300_000);

  it("T5: set v1 stays at 1.00 / 1.00", () => {
    const rec = record("v1", "synthetic-v1");
    const r = scoreRun(loadSet("synthetic-v1"), aliases.index, rec.results[0]!.spec);
    expect([r.precision, r.recall]).toEqual([1, 1]);
    expect(headline(r)).toEqual(headline(rec.results[0]!));
  }, 300_000);
});
