// SIG-63: T7 as SIG-63 registers it (research/preregistrations/SIG-63.json). SIG-60's T7 runs
// unchanged (its pre-registration is read from SIG-60.json and checked by hash), with the
// structure family added to every label; on set v2.3 the drift-pair labels replace the drift-line
// labels, and validity checks V7 to V11 are added. Sets v2, v2.1 and v2.2 are negative controls.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { serialise, type GeneratedApplicant } from "../generator/index.js";
import { generateSetV23, UNSEEN_PROVIDERS_V23 } from "../generator/v23/index.js";
import type { Scores } from "./classifiers.js";
import {
  caught,
  extractUnits,
  loadPreregistration,
  PREREGISTRATION,
  runLeakage,
  type LabelSpec,
  type Preregistration,
} from "./index.js";
import { GENERATORS, MANIFESTS, type SetName } from "./run.js";
import { addStructureFeatures, SIG63_PREREGISTRATION, STRUCTURE_FAMILIES } from "./structure.js";
import { validityChecksV23 } from "./validity-v23.js";
import { unseenLendersInCode, validityChecks, type Check } from "./validity.js";

export type Sig63Set = SetName | "v2.3";
const MANIFEST_V23 = "research/datasets/synthetic-v2.3.manifest.json";
const ASIC_RECORD = "research/datasets/synthetic-v2.3.reserved-names-asic.json";

type Channel = {
  set: string;
  id: string;
  caught_by: ({ label: string; family: string } | { check: string })[];
};
type Sig63File = {
  t7_carried: { file: string; sha256: string };
  labels_added: (LabelSpec & { applies_to?: string; intended_evidence_in_words?: string })[];
  labels_re_registered: Record<string, string>;
  channels_added: Channel[];
};
const sig63File = () => JSON.parse(readFileSync(SIG63_PREREGISTRATION, "utf8")) as Sig63File;
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** SIG-60's pre-registration, unchanged, with the structure family; v2.3's drift labels swapped. */
export function preregistrationFor(set: string): Preregistration {
  const f = sig63File();
  if (sha(f.t7_carried.file) !== f.t7_carried.sha256)
    throw new Error(`${f.t7_carried.file} has changed: T7 isn't carried unchanged`);
  const base = loadPreregistration(PREREGISTRATION);
  const families = { ...base.families, ...STRUCTURE_FAMILIES };
  if (set !== "v2.3") return { ...base, families };
  const replacement = new Map(f.labels_added.map((l) => [l.id.replace("-pair-", "-line-"), l]));
  const labels = base.labels.map((l) => {
    const r = replacement.get(l.id);
    if (!r || !(l.id in f.labels_re_registered)) return l;
    const spec: LabelSpec = {
      id: r.id,
      unit: r.unit,
      pool: r.pool,
      label: r.label,
      intended_evidence: r.intended_evidence,
      twin: r.twin,
    };
    return spec;
  });
  return { ...base, families, labels };
}

function load(set: Sig63Set) {
  const path = set === "v2.3" ? MANIFEST_V23 : MANIFESTS[set];
  const manifest = JSON.parse(readFileSync(path, "utf8")) as { seed: number; set_sha256: string };
  const g: { applicants: GeneratedApplicant[]; unseen: string[] } | undefined =
    set === "v2.3"
      ? {
          applicants: generateSetV23(manifest.seed),
          unseen: Object.values(UNSEEN_PROVIDERS_V23).flat(),
        }
      : GENERATORS[set]?.(manifest.seed);
  if (!g) throw new Error(`no generator for set ${set}`);
  const hash = createHash("sha256");
  for (const a of g.applicants) hash.update(serialise(a)).update("\n");
  const setSha = hash.digest("hex");
  if (setSha !== manifest.set_sha256)
    throw new Error(`set ${set} regenerated to ${setSha}, not ${manifest.set_sha256}`);
  return { ...g, seed: manifest.seed, setSha };
}

/** V8: the committed ASIC check record lists every reserved name on both registers, no match. */
function reservedNames(names: string[]): Check {
  if (!existsSync(ASIC_RECORD))
    return { id: "V8-reserved-names", pass: false, detail: { record: "missing" } };
  const rec = JSON.parse(readFileSync(ASIC_RECORD, "utf8")) as {
    checks: { name: string; register: string; result: string }[];
  };
  const missing = names.filter(
    (n) =>
      !["credit licensees", "credit representatives"].every((r) =>
        rec.checks.some((c) => c.name === n && c.register === r && c.result === "no match"),
      ),
  );
  return {
    id: "V8-reserved-names",
    pass: missing.length === 0,
    detail: { names: names.length, not_cleared: missing.join(", ") },
  };
}

const round = (x: number) => (Number.isFinite(x) ? Math.round(x * 10_000) / 10_000 : null);
const compact = (s: Scores | null) =>
  s && {
    n: s.n,
    positives: s.positives,
    base: round(s.base),
    test_n: s.test_n,
    test_positives: s.test_positives,
    tree_auc: round(s.tree_auc),
    logistic_auc: round(s.logistic_auc),
    stump: s.stump && {
      rule: s.stump.rule,
      precision: round(s.stump.precision),
      recall: round(s.stump.recall),
      flagged: s.stump.flagged,
    },
  };

export function runSig63(set: Sig63Set) {
  const { applicants, unseen, seed, setSha } = load(set);
  const pre = preregistrationFor(set);
  const units = addStructureFeatures(extractUnits({ name: set, seed, applicants }), applicants);
  if (set === "v2.3") {
    // The drift-pair labels: SIG-60's drift-line pools, labelled by the pair (either descriptor).
    const pair = new Set(
      applicants.flatMap(
        (a) =>
          (a.truth.v2 as unknown as { drift: { pair_transaction_ids: string[] } | null }).drift
            ?.pair_transaction_ids ?? [],
      ),
    );
    for (const u of units) {
      if ("T-drift-line-main" in u.y) u.y["T-drift-pair-main"] = pair.has(u.id);
      if ("T-drift-line-second" in u.y) u.y["T-drift-pair-second"] = pair.has(u.id);
    }
  }
  const results = runLeakage(units, pre);
  const validity = [
    ...validityChecks(applicants),
    unseenLendersInCode(unseen),
    ...(set === "v2.3" ? [reservedNames(unseen), ...validityChecksV23(applicants)] : []),
  ];
  const s60 = pre as unknown as { channels: Channel[] };
  const channels = [...s60.channels, ...sig63File().channels_added]
    .filter((c) => c.set === set)
    .map((c) => {
      const by = c.caught_by.flatMap((e) =>
        "check" in e
          ? validity.some((v) => v.id === e.check && !v.pass)
            ? [e.check]
            : []
          : caught(results, e.label, e.family)
            ? [`${e.label} / ${e.family}`]
            : [],
      );
      return { id: c.id, caught: by.length > 0, by };
    });
  return {
    set,
    seed,
    set_sha256: setSha,
    preregistration_sha256: sha(SIG63_PREREGISTRATION),
    t7_carried_sha256: sha(PREREGISTRATION),
    labels: results.map((r) => ({
      id: r.id,
      status: r.status,
      flags: r.flags,
      scores: compact(r.scores),
      leaking_families: r.families
        .filter((f) => f.flags.length > 0)
        .map((f) => ({ family: f.family, flags: f.flags, scores: compact(f.scores) })),
    })),
    validity,
    channels,
  };
}
export type Sig63Result = ReturnType<typeof runSig63>;

/**
 * SIG-63's pass rule. Set v2.3: every label present and within margin on every family (the
 * structure family included), and every validity check passes. A control passes, as a control,
 * when it is caught on every channel listed for it.
 */
export function verdictSig63(r: Sig63Result): { pass: boolean; failing: string[] } {
  if (r.set === "v2.3") {
    const failing = [
      ...r.labels.filter((l) => l.status !== "within margin").map((l) => `${l.id}: ${l.status}`),
      ...r.validity.filter((v) => !v.pass).map((v) => v.id),
    ];
    return { pass: failing.length === 0, failing };
  }
  const failing = r.channels.filter((c) => !c.caught).map((c) => `${c.id}: not caught`);
  return { pass: failing.length === 0 && r.channels.length > 0, failing };
}
