// SIG-60: the generic classifiers of the adversarial leakage test (pre-registered in
// research/preregistrations/SIG-60.json). Deterministic: no randomness and no clock. Every score
// is measured on a held-out half of the applicants, so lines of one applicant never train and
// test at once.
import { createHash } from "node:crypto";

/** A feature value: a number (NaN when missing) or a category. */
export type Value = number | string;
export type Row = { group: string; label: boolean; x: Record<string, Value> };
export type FeatureKind = "num" | "cat";
export type FeatureSpec = { name: string; kind: FeatureKind };

/** Quantile cut points tried per numeric feature, and categories kept per categorical one. */
const CUTS = 64;
const TOP_CATS = 20;
const MIN_LEAF = 10;
const TREE_DEPTH = 3;
const LR_ITERATIONS = 300;
const LR_RATE = 0.5;
const LR_L2 = 0.01;
/** A stump's rule must flag at least this share of the positives in training. */
const STUMP_MIN_RECALL = 0.1;

const halves = new Map<string, boolean>();
/** The held-out half: SHA-256 of the applicant ID, so the split doesn't follow the ID's characters. */
export const isHeldOut = (group: string): boolean => {
  let h = halves.get(group);
  if (h === undefined) {
    h = createHash("sha256").update(`split|${group}`).digest().readUInt32BE(0) % 2 === 1;
    halves.set(group, h);
  }
  return h;
};

// --- encoding --------------------------------------------------------------------------------
type Split = { feature: string; kind: FeatureKind; threshold: number; category: string };
const MISSING = -1e12;
const num = (v: Value | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : MISSING;
const cat = (v: Value | undefined): string => (v === undefined ? "∅" : String(v));

/**
 * Thresholds for "at or above": every distinct value but the smallest when there are at most 64,
 * else the 64-quantiles, so a rare value (1 in 40) is still a cut.
 */
function cutPoints(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const distinct = [...new Set(sorted)];
  if (distinct.length <= CUTS) return distinct.slice(1);
  const out = new Set<number>();
  for (let k = 1; k < CUTS; k++) {
    const v = sorted[Math.floor((k * sorted.length) / CUTS)];
    if (v !== undefined && v !== sorted[0]) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}
function topCategories(rows: Row[], name: string): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(cat(r.x[name]), (counts.get(cat(r.x[name])) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, TOP_CATS)
    .map(([c]) => c);
}
function candidates(rows: Row[], features: FeatureSpec[]): Split[] {
  return features.flatMap((f) =>
    f.kind === "num"
      ? cutPoints(rows.map((r) => num(r.x[f.name]))).map((threshold) => ({
          feature: f.name,
          kind: f.kind,
          threshold,
          category: "",
        }))
      : topCategories(rows, f.name).map((category) => ({
          feature: f.name,
          kind: f.kind,
          threshold: 0,
          category,
        })),
  );
}
/** True when the row goes to the split's "yes" side: at or above the threshold, or the category. */
const yes = (s: Split, r: Row): boolean =>
  s.kind === "num" ? num(r.x[s.feature]) >= s.threshold : cat(r.x[s.feature]) === s.category;

// --- AUC ----------------------------------------------------------------------------------------
/** Area under the ROC curve, ties counted half (the Mann-Whitney statistic). */
export function auc(scores: number[], labels: boolean[]): number {
  const idx = scores.map((s, i) => ({ s, y: labels[i] ?? false }));
  idx.sort((a, b) => a.s - b.s);
  let rank = 1;
  let sumPos = 0;
  let nPos = 0;
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j < idx.length && idx[j]?.s === idx[i]?.s) j++;
    const mid = (rank + rank + (j - i) - 1) / 2;
    for (let k = i; k < j; k++)
      if (idx[k]?.y) {
        sumPos += mid;
        nPos++;
      }
    rank += j - i;
    i = j;
  }
  const nNeg = idx.length - nPos;
  if (nPos === 0 || nNeg === 0) return 0.5;
  return (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}
/** Hanley-McNeil standard error of the AUC under the null (AUC = 0.5). */
export const aucNullSe = (nPos: number, nNeg: number): number =>
  Math.sqrt((nPos + nNeg + 1) / (12 * nPos * nNeg));

// --- decision stump -----------------------------------------------------------------------------
export type Stump = { split: Split; direction: "yes" | "no" };
/**
 * The single rule (one feature, one threshold or category, either side) that best separates the
 * positives in training, by the binomial z of its precision over the base rate, among rules that
 * flag at least 10% of the positives.
 */
export function fitStump(rows: Row[], features: FeatureSpec[]): Stump | null {
  const n = rows.length;
  const pos = rows.filter((r) => r.label).length;
  if (pos === 0 || pos === n) return null;
  const base = pos / n;
  let best: { z: number; stump: Stump } | null = null;
  for (const split of candidates(rows, features)) {
    let yesN = 0;
    let yesPos = 0;
    for (const r of rows)
      if (yes(split, r)) {
        yesN++;
        if (r.label) yesPos++;
      }
    for (const [direction, flagged, tp] of [
      ["yes", yesN, yesPos],
      ["no", n - yesN, pos - yesPos],
    ] as const) {
      if (flagged === 0 || tp / pos < STUMP_MIN_RECALL) continue;
      const z = (tp / flagged - base) / Math.sqrt((base * (1 - base)) / flagged);
      if (!best || z > best.z) best = { z, stump: { split, direction } };
    }
  }
  return best?.stump ?? null;
}
export const stumpFlags = (s: Stump, r: Row): boolean =>
  yes(s.split, r) === (s.direction === "yes");

// --- depth-3 tree -------------------------------------------------------------------------------
type Node = { leaf: number } | { split: Split; yes: Node; no: Node };
const gini = (pos: number, n: number) => (n === 0 ? 0 : 2 * (pos / n) * (1 - pos / n));
function growTree(rows: Row[], features: FeatureSpec[], depth: number): Node {
  const pos = rows.filter((r) => r.label).length;
  const leaf = { leaf: rows.length === 0 ? 0 : pos / rows.length };
  if (depth === 0 || pos === 0 || pos === rows.length || rows.length < 2 * MIN_LEAF) return leaf;
  const parent = gini(pos, rows.length) * rows.length;
  let best: { gain: number; split: Split } | null = null;
  for (const split of candidates(rows, features)) {
    let yn = 0;
    let yp = 0;
    for (const r of rows)
      if (yes(split, r)) {
        yn++;
        if (r.label) yp++;
      }
    const nn = rows.length - yn;
    if (yn < MIN_LEAF || nn < MIN_LEAF) continue;
    const gain = parent - gini(yp, yn) * yn - gini(pos - yp, nn) * nn;
    if (gain > 1e-9 && (!best || gain > best.gain)) best = { gain, split };
  }
  if (!best) return leaf;
  const split = best.split;
  return {
    split,
    yes: growTree(
      rows.filter((r) => yes(split, r)),
      features,
      depth - 1,
    ),
    no: growTree(
      rows.filter((r) => !yes(split, r)),
      features,
      depth - 1,
    ),
  };
}
const treeScore = (node: Node, r: Row): number =>
  "leaf" in node ? node.leaf : treeScore(yes(node.split, r) ? node.yes : node.no, r);

// --- logistic regression ------------------------------------------------------------------------
type Encoder = { columns: ((r: Row) => number)[] };
function encoder(rows: Row[], features: FeatureSpec[]): Encoder {
  const columns: ((r: Row) => number)[] = [];
  for (const f of features) {
    if (f.kind === "num") {
      const present = rows
        .map((r) => r.x[f.name])
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      const mean = present.reduce((s, v) => s + v, 0) / Math.max(1, present.length);
      const sd =
        Math.sqrt(present.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, present.length)) ||
        1;
      columns.push((r) => {
        const v = r.x[f.name];
        return typeof v === "number" && Number.isFinite(v)
          ? Math.max(-5, Math.min(5, (v - mean) / sd))
          : 0;
      });
      columns.push((r) => {
        const v = r.x[f.name];
        return typeof v === "number" && Number.isFinite(v) ? 0 : 1;
      });
    } else
      for (const c of topCategories(rows, f.name))
        columns.push((r) => (cat(r.x[f.name]) === c ? 1 : 0));
  }
  return { columns };
}
function fitLogistic(rows: Row[], features: FeatureSpec[]): (r: Row) => number {
  const enc = encoder(rows, features);
  const X = rows.map((r) => enc.columns.map((c) => c(r)));
  const y = rows.map((r) => (r.label ? 1 : 0));
  const w = new Array<number>(enc.columns.length).fill(0);
  let b = 0;
  const n = rows.length;
  for (let it = 0; it < LR_ITERATIONS; it++) {
    const gw = new Array<number>(w.length).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const xi = X[i] ?? [];
      let z = b;
      for (let j = 0; j < w.length; j++) z += (w[j] ?? 0) * (xi[j] ?? 0);
      const err = 1 / (1 + Math.exp(-z)) - (y[i] ?? 0);
      gb += err;
      for (let j = 0; j < w.length; j++) gw[j] = (gw[j] ?? 0) + err * (xi[j] ?? 0);
    }
    b -= (LR_RATE * gb) / n;
    for (let j = 0; j < w.length; j++)
      w[j] = (w[j] ?? 0) - LR_RATE * ((gw[j] ?? 0) / n + LR_L2 * (w[j] ?? 0));
  }
  return (r) => {
    let z = b;
    enc.columns.forEach((c, j) => (z += (w[j] ?? 0) * c(r)));
    return z;
  };
}

// --- held-out evaluation ------------------------------------------------------------------------
export type Scores = {
  /** The pool. */
  n: number;
  positives: number;
  base: number;
  /** The held-out half every score is measured on. */
  test_n: number;
  test_positives: number;
  test_base: number;
  tree_auc: number;
  logistic_auc: number;
  stump: { precision: number; recall: number; flagged: number; rule: string } | null;
};
const describeStump = (s: Stump): string =>
  s.split.kind === "num"
    ? `${s.split.feature} ${s.direction === "yes" ? ">=" : "<"} ${Number(s.split.threshold.toFixed(4))}`
    : `${s.split.feature} ${s.direction === "yes" ? "==" : "!="} ${s.split.category}`;

/**
 * Scores of the three classifiers, fitted on the training half and measured on the held-out
 * half only. One split, not pooled cross-validation: pooled out-of-fold counts are correlated
 * across folds (a chance cluster draws every fold's rule), which makes the binomial and AUC nulls
 * too narrow; on a single held-out half they are exact.
 */
export function evaluate(
  rows: Row[],
  features: FeatureSpec[],
  which: { tree: boolean; logistic: boolean } = { tree: true, logistic: true },
): Scores {
  const positives = rows.filter((r) => r.label).length;
  const train = rows.filter((r) => !isHeldOut(r.group));
  const test = rows.filter((r) => isHeldOut(r.group));
  const testPositives = test.filter((r) => r.label).length;
  const labels = test.map((r) => r.label);
  let treeAuc = 0.5;
  let lrAuc = 0.5;
  let stumpScore: Scores["stump"] = null;
  if (train.length > 0 && test.length > 0) {
    if (which.tree) {
      const tree = growTree(train, features, TREE_DEPTH);
      treeAuc = auc(
        test.map((r) => treeScore(tree, r)),
        labels,
      );
    }
    if (which.logistic) {
      const lr = fitLogistic(train, features);
      lrAuc = auc(test.map(lr), labels);
    }
    const stump = fitStump(train, features);
    if (stump) {
      const flagged = test.filter((r) => stumpFlags(stump, r));
      const tp = flagged.filter((r) => r.label).length;
      stumpScore = {
        precision: flagged.length === 0 ? 0 : tp / flagged.length,
        recall: testPositives === 0 ? 0 : tp / testPositives,
        flagged: flagged.length,
        rule: describeStump(stump),
      };
    }
  }
  return {
    n: rows.length,
    positives,
    base: rows.length === 0 ? 0 : positives / rows.length,
    test_n: test.length,
    test_positives: testPositives,
    test_base: test.length === 0 ? 0 : testPositives / test.length,
    tree_auc: treeAuc,
    logistic_auc: lrAuc,
    stump: stumpScore,
  };
}
