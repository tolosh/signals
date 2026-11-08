// SIG-60: one leakage run on one set: generate the set from its manifest's seed, check its hash,
// run the pre-registered labels and validity checks, and judge the pre-registered channels.
// Shared by scripts/leakage.ts (which writes the run record) and the T7 tests (which check the
// committed record reproduces, D28).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { UNSEEN_PROVIDERS, UNSEEN_PROVIDERS_V21 } from "../generator/catalog.js";
import {
  generateApplicant,
  populationV2,
  serialise,
  type GeneratedApplicant,
} from "../generator/index.js";
import { extractUnits, loadPreregistration, PREREGISTRATION, runLeakage, caught } from "./index.js";
import type { Scores } from "./classifiers.js";
import { generateSetV22 } from "../generator/v22/index.js";
import { UNSEEN_PROVIDERS_V22 } from "../generator/v22/catalog.js";
import { unseenLendersInCode, validityChecks, type Check } from "./validity.js";

export type SetName = "v2" | "v2.1" | "v2.2";
export const MANIFESTS: Record<SetName, string> = {
  v2: "research/datasets/synthetic-v2.manifest.json",
  "v2.1": "research/datasets/synthetic-v2.1.manifest.json",
  "v2.2": "research/datasets/synthetic-v2.2.manifest.json",
};

/** Generators by set (set v2.2's was added when it was built, after the pre-registration). */
export const GENERATORS: Partial<
  Record<SetName, (seed: number) => { applicants: GeneratedApplicant[]; unseen: string[] }>
> = {
  v2: (seed) => ({
    applicants: populationV2(seed, "2.0").map((s) => generateApplicant(s, seed)),
    unseen: Object.values(UNSEEN_PROVIDERS).flat(),
  }),
  "v2.1": (seed) => ({
    applicants: populationV2(seed, "2.1").map((s) => generateApplicant(s, seed)),
    unseen: Object.values(UNSEEN_PROVIDERS_V21).flat(),
  }),
  "v2.2": (seed) => ({
    applicants: generateSetV22(seed),
    unseen: Object.values(UNSEEN_PROVIDERS_V22).flat(),
  }),
};

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

export type LeakageResult = {
  set: SetName;
  seed: number;
  set_sha256: string;
  preregistration_sha256: string;
  labels: {
    id: string;
    status: string;
    flags: string[];
    scores: ReturnType<typeof compact>;
    leaking_families: { family: string; flags: string[]; scores: ReturnType<typeof compact> }[];
  }[];
  validity: Check[];
  channels: { id: string; caught: boolean; by: string[] }[];
};

export function runSet(set: SetName): LeakageResult {
  const manifest = JSON.parse(readFileSync(MANIFESTS[set], "utf8")) as {
    seed: number;
    set_sha256: string;
  };
  const generate = GENERATORS[set];
  if (!generate) throw new Error(`no generator for set ${set}`);
  const { applicants, unseen } = generate(manifest.seed);
  const hash = createHash("sha256");
  for (const a of applicants) hash.update(serialise(a)).update("\n");
  const setSha = hash.digest("hex");
  if (setSha !== manifest.set_sha256)
    throw new Error(
      `set ${set} regenerated to ${setSha}, not its manifest's ${manifest.set_sha256}`,
    );
  const pre = loadPreregistration();
  const results = runLeakage(extractUnits({ name: set, seed: manifest.seed, applicants }), pre);
  const validity = [...validityChecks(applicants), unseenLendersInCode(unseen)];
  const channels = (
    pre as unknown as {
      channels: {
        set: string;
        id: string;
        caught_by: ({ label: string; family: string } | { check: string })[];
      }[];
    }
  ).channels
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
    seed: manifest.seed,
    set_sha256: setSha,
    preregistration_sha256: createHash("sha256")
      .update(readFileSync(PREREGISTRATION))
      .digest("hex"),
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

/** The verdict: set v2.2 passes when every label is present and within margin and every check
 * passes; a control passes (as a control) when it is caught on every listed channel. */
export function verdict(r: LeakageResult): { pass: boolean; failing: string[] } {
  if (r.set === "v2.2") {
    const failing = [
      ...r.labels.filter((l) => l.status !== "within margin").map((l) => `${l.id}: ${l.status}`),
      ...r.validity.filter((v) => !v.pass).map((v) => v.id),
    ];
    return { pass: failing.length === 0, failing };
  }
  const failing = r.channels.filter((c) => !c.caught).map((c) => `${c.id}: not caught`);
  return { pass: failing.length === 0 && r.channels.length > 0, failing };
}
