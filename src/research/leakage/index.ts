// SIG-60: the adversarial leakage test. For each pre-registered truth label, generic classifiers
// on every feature except the label's intended evidence try to recover the label; a label leaks
// when one beats its base rate by more than the pre-registered margin, or when it has no
// unlabelled twins. Everything it applies (features, families, labels, pools' intended
// evidence, margins, the row cap) is read from research/preregistrations/SIG-60.json.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  aucNullSe,
  evaluate,
  type FeatureSpec,
  type Row,
  type Scores,
  type Value,
} from "./classifiers.js";
import { type Unit, type UnitKind } from "./units.js";

export { extractUnits, type SetInput, type Unit } from "./units.js";

export type LabelSpec = {
  id: string;
  unit: UnitKind;
  pool: string;
  label: string;
  intended_evidence: string[];
  twin: boolean;
};
export type Preregistration = {
  families: Record<string, string[]>;
  labels: LabelSpec[];
  margins: {
    auc_max: number;
    auc_z: number;
    stump_lift: number;
    stump_min_recall: number;
    stump_p: number;
    twin_max_base: number;
  };
  row_cap: number;
};

export const PREREGISTRATION = "research/preregistrations/SIG-60.json";
export const loadPreregistration = (path = PREREGISTRATION): Preregistration =>
  JSON.parse(readFileSync(path, "utf8")) as Preregistration;

export type Flag = "auc" | "stump" | "twins";
export type FamilyResult = { family: string; scores: Scores; flags: Flag[] };
export type LabelResult = {
  id: string;
  status: "absent" | "within margin" | "leak";
  scores: Scores | null;
  flags: Flag[];
  families: FamilyResult[];
};

/** A unit's place in the row cap's order: SHA-256 of its ID, label-blind. */
const capKey = (id: string): number =>
  createHash("sha256").update(`cap|${id}`).digest().readUInt32BE(0);

/** P(X >= k) for X ~ Binomial(n, p), exactly (in log space). */
export function binomialTail(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  const lp = Math.log(p);
  const lq = Math.log(1 - p);
  let logC = 0; // log C(n, 0)
  let total = 0;
  for (let i = 0; i <= n; i++) {
    if (i > 0) logC += Math.log(n - i + 1) - Math.log(i);
    if (i >= k) total += Math.exp(logC + i * lp + (n - i) * lq);
  }
  return Math.min(1, total);
}

function flagsOf(s: Scores, m: Preregistration["margins"], twin: boolean): Flag[] {
  const flags: Flag[] = [];
  const pos = s.test_positives;
  const neg = s.test_n - pos;
  const base = s.test_base;
  if (pos > 0 && neg > 0) {
    const best = Math.max(s.tree_auc, s.logistic_auc);
    if (best > m.auc_max && (best - 0.5) / aucNullSe(pos, neg) > m.auc_z) flags.push("auc");
    const st = s.stump;
    if (st && st.flagged > 0) {
      const margin = Math.min(m.stump_lift * base, base + (1 - base) / 2);
      const tp = Math.round(st.precision * st.flagged);
      const p = binomialTail(tp, st.flagged, base);
      if (st.precision > margin && st.recall >= m.stump_min_recall && p < m.stump_p)
        flags.push("stump");
    }
  }
  if (twin && s.base > m.twin_max_base) flags.push("twins");
  return flags;
}

/** The leakage test on one set's units, for every pre-registered label. */
export function runLeakage(
  units: Unit[],
  pre: Preregistration = loadPreregistration(),
): LabelResult[] {
  const familyOf = new Map<string, string>();
  for (const [family, names] of Object.entries(pre.families))
    for (const n of names) familyOf.set(n, family);
  return pre.labels.map((spec) => {
    let pool = units.filter((u) => u.kind === spec.unit && spec.id in u.y);
    if (pool.length > pre.row_cap)
      pool = [...pool]
        .sort((a, b) => capKey(a.id) - capKey(b.id) || (a.id < b.id ? -1 : 1))
        .slice(0, pre.row_cap);
    const positives = pool.filter((u) => u.y[spec.id]).length;
    if (positives === 0)
      return { id: spec.id, status: "absent", scores: null, flags: [], families: [] };
    const excluded = new Set(spec.intended_evidence);
    const names = Object.keys(pool[0]?.x ?? {}).filter((n) => {
      const family = familyOf.get(n);
      if (family === undefined) throw new Error(`feature ${n} is in no pre-registered family`);
      return !excluded.has(family);
    });
    const features: FeatureSpec[] = names.map((name) => ({
      name,
      kind: pool.some((u) => typeof u.x[name] === "string") ? "cat" : "num",
    }));
    const rows: Row[] = pool.map((u) => ({
      group: u.group,
      label: u.y[spec.id] === true,
      x: u.x as Record<string, Value>,
    }));
    const scores = evaluate(rows, features);
    const flags = flagsOf(scores, pre.margins, spec.twin);
    const families = [...new Set(names.map((n) => familyOf.get(n) ?? ""))].sort().map((family) => {
      const fs = features.filter((f) => familyOf.get(f.name) === family);
      const s = evaluate(rows, fs, { tree: true, logistic: false });
      return { family, scores: s, flags: flagsOf(s, pre.margins, false) };
    });
    return {
      id: spec.id,
      status: flags.length > 0 ? "leak" : "within margin",
      scores,
      flags,
      families,
    };
  });
}

/** True when this label leaks through this family (or, for "twins", has no unlabelled twins). */
export const caught = (results: LabelResult[], label: string, family: string): boolean => {
  const r = results.find((x) => x.id === label);
  if (!r) return false;
  if (family === "twins") return r.flags.includes("twins");
  return r.families.some((f) => f.family === family && f.flags.length > 0);
};
