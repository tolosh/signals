// SIG-60: the leakage test's classifiers and margins behave as pre-registered on data where the
// answer is known: a random label is within margin (the false-alarm control), and a planted leak
// of each kind is caught.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { auc, evaluate, type Row } from "../../../src/research/leakage/classifiers.js";
import { runLeakage, type Preregistration } from "../../../src/research/leakage/index.js";
import type { Unit } from "../../../src/research/leakage/units.js";

/** A uniform draw in [0, 1) from SHA-256 of the key. */
const u = (k: string) => createHash("sha256").update(k).digest().readUInt32BE(0) / 2 ** 32;

/** 800 applicants with noise features; the label is set by `label`. */
function units(label: (i: number) => boolean, leak?: (i: number, y: boolean) => number): Unit[] {
  return Array.from({ length: 800 }, (_, i) => {
    const y = label(i);
    return {
      kind: "applicant" as const,
      group: `a${i}`,
      id: `a${i}`,
      x: {
        noise_a: u(`a|${i}`),
        noise_b: Math.floor(u(`b|${i}`) * 5),
        noise_c: ["x", "y", "z"][Math.floor(u(`c|${i}`) * 3)] ?? "x",
        planted: leak ? leak(i, y) : u(`p|${i}`),
      },
      y: { L: y },
    };
  });
}
const pre: Preregistration = {
  families: { noise: ["noise_a", "noise_b", "noise_c"], planted: ["planted"] },
  labels: [
    { id: "L", unit: "applicant", pool: "all", label: "L", intended_evidence: [], twin: true },
  ],
  margins: {
    auc_max: 0.6,
    auc_z: 3.09,
    stump_lift: 1.5,
    stump_min_recall: 0.1,
    stump_p: 0.001,
    twin_max_base: 0.5,
  },
  row_cap: 12000,
};

describe("classifiers", () => {
  it("AUC is the Mann-Whitney statistic, ties counted half", () => {
    expect(auc([0.1, 0.4, 0.35, 0.8], [false, false, true, true])).toBe(0.75);
    expect(auc([1, 1, 1, 1], [false, true, false, true])).toBe(0.5);
  });
  it("scores out of fold: a unique ID that fits the training rows isn't rewarded", () => {
    const rows: Row[] = Array.from({ length: 400 }, (_, i) => ({
      group: `g${i}`,
      label: u(`l|${i}`) < 0.2,
      x: { id: i },
    }));
    const s = evaluate(rows, [{ name: "id", kind: "num" }]);
    expect(s.tree_auc).toBeLessThan(0.6);
  });
});

describe("margins (the false-alarm control and planted leaks)", () => {
  it("a label drawn at random, at base rates from 2.5% to 40%, is within margin", () => {
    for (const p of [0.025, 0.1, 0.4]) {
      const r = runLeakage(
        units((i) => u(`y|${p}|${i}`) < p),
        pre,
      )[0];
      expect(r?.status, `base ${p}`).toBe("within margin");
    }
  });
  it("a planted feature that marks a 2.5% label exactly is caught, and attributed to its family", () => {
    const r = runLeakage(
      units(
        (i) => i % 40 === 0,
        (_i, y) => (y ? 1 : 0),
      ),
      pre,
    )[0];
    expect(r?.status).toBe("leak");
    expect(r?.families.find((f) => f.family === "planted")?.flags.length).toBeGreaterThan(0);
    expect(r?.families.find((f) => f.family === "noise")?.flags).toEqual([]);
  });
  it("a partial leak (a feature that shifts with the label) is caught by the AUC rule", () => {
    const r = runLeakage(
      units(
        (i) => u(`y|${i}`) < 0.25,
        (i, y) => u(`p|${i}`) + (y ? 0.5 : 0),
      ),
      pre,
    )[0];
    expect(r?.flags).toContain("auc");
  });
  it("a twin label with more labelled than unlabelled units is a leak (no twins to hide among)", () => {
    const r = runLeakage(
      units((i) => i % 4 !== 0),
      pre,
    )[0];
    expect(r?.flags).toContain("twins");
  });
  it("an intended-evidence family is left out", () => {
    const first = pre.labels[0]!;
    const withIntended: Preregistration = {
      ...pre,
      labels: [{ ...first, intended_evidence: ["planted"] }],
    };
    const r = runLeakage(
      units(
        (i) => i % 40 === 0,
        (_i, y) => (y ? 1 : 0),
      ),
      withIntended,
    )[0];
    expect(r?.status).toBe("within margin");
  });
});
