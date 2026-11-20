// SIG-57 (H2): the alias experiment, as pre-registered in research/preregistrations/SIG-57.json.
// Runs in the registered order; the negative control first, and nothing else runs unless its
// record is in the output folder and it passed:
//   npx tsx scripts/sig57-run.ts --mode control         rotated declarations, treatment, primary
//   npx tsx scripts/sig57-run.ts --mode primary         treatment, name-only, BPAY lines in
//   npx tsx scripts/sig57-run.ts --mode bpay-excluded   treatment, name-only, BPAY lines removed
//   npx tsx scripts/sig57-run.ts --mode amount          treatment, amount-assisted at 5% and 15%
//   npx tsx scripts/sig57-run.ts --mode baseline        SIG-18 1.0.0, BPAY lines in and removed
//   npx tsx scripts/sig57-run.ts --mode grid            min occurrences 2, 3 x tolerance 5%, 15%
//   npx tsx scripts/sig57-run.ts --mode v1              set v1 regression, treatment, primary
// Options: [--out research/runs] [--allow-dirty]. Records are never overwritten. They carry IDs,
// families and identities only, never a transaction description.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LIABILITY_METHOD_VERSION } from "../src/engines/liabilities/index.js";
import { SIG57_ALIAS_METHOD_VERSION } from "../src/research/sig57/aliases.js";
import { SIG57_DETECTOR_VERSION } from "../src/research/sig57/detect.js";
import {
  loadAliases,
  loadSet,
  scoreRun,
  type LoadedSet,
  type RunSpec,
} from "../src/research/sig57/score.js";
import {
  gitState,
  parseRunArgs,
  provenance,
  requireCleanTree,
  writeNew,
} from "./lib/run-record.js";

const MODES = ["control", "primary", "bpay-excluded", "amount", "baseline", "grid", "v1"];
const args = parseRunArgs();
const mode = args.values.mode ?? "";
if (!MODES.includes(mode)) throw new Error(`Usage: --mode ${MODES.join("|")} [--out folder]`);
const git = gitState();
requireCleanTree(git.status, args.allowDirty);

const PREREG = "research/preregistrations/SIG-57.json";
const preregRaw = readFileSync(PREREG);
const prereg = JSON.parse(preregRaw.toString("utf8")) as {
  primary_configuration: { min_occurrences: number; amount_tolerance: number };
  variables: { min_occurrences: number[]; amount_tolerance: number[] };
  alias_table: { sha256: string };
};
const aliases = loadAliases();
if (aliases.sha256 !== prereg.alias_table.sha256)
  throw new Error("the alias table differs from the pre-registered one");

const date = new Date().toISOString().slice(0, 10);
const suffix = (set: string, m: string) => `-${set}-sig57-${m}.json`;
const inOut = (() => {
  try {
    return readdirSync(args.out);
  } catch {
    return [];
  }
})();
if (mode !== "control") {
  const control = inOut.find((f) => f.endsWith(suffix("synthetic-v2.2", "control")));
  if (!control) throw new Error("run the negative control first (--mode control)");
  const rec = JSON.parse(readFileSync(join(args.out, control), "utf8")) as { passed: boolean };
  if (!rec.passed) throw new Error("the negative control failed: no other SIG-57 result stands");
}

const set: LoadedSet = loadSet(mode === "v1" ? "synthetic-v1" : "synthetic-v2.2");
const { min_occurrences, amount_tolerance } = prereg.primary_configuration;
const primary: RunSpec = {
  arm: "treatment",
  disclosure: { disclosure: "name_only" },
  min_occurrences,
  amount_tolerance,
  variant: "as-generated",
  bpay: "in",
};
const specs: RunSpec[] = (() => {
  switch (mode) {
    case "control":
      return [{ ...primary, variant: "rotated-declarations" }];
    case "primary":
    case "v1":
      return [primary];
    case "bpay-excluded":
      return [{ ...primary, bpay: "excluded" }];
    case "amount":
      return [0.05, 0.15].map((tolerance) => ({
        ...primary,
        disclosure: { disclosure: "amount_assisted", tolerance },
      }));
    case "baseline":
      return (["in", "excluded"] as const).map((bpay) => ({ ...primary, arm: "baseline", bpay }));
    default:
      return prereg.variables.min_occurrences.flatMap((m) =>
        prereg.variables.amount_tolerance.map((t) => ({
          ...primary,
          min_occurrences: m,
          amount_tolerance: t,
        })),
      );
  }
})();
const results = specs.map((s) => scoreRun(set, aliases.index, s));
const first = results[0] as ReturnType<typeof scoreRun>;
const passed =
  mode === "control"
    ? first.precision !== null && first.precision < 0.5
    : mode === "v1"
      ? first.precision === 1 && first.recall === 1
      : undefined;

const record = {
  ticket: "SIG-57",
  mode,
  date,
  ...provenance("scripts/sig57-run.ts", args, git),
  preregistration: { file: PREREG, sha256: createHash("sha256").update(preregRaw).digest("hex") },
  set: { name: set.set, set_sha256: set.set_sha256, applicants_scored: set.applicants.length },
  categories: {
    file: set.categories_file,
    sha256: set.categories_sha256,
    enrich: set.enrich,
    biller_code_given: set.biller_code_given,
  },
  alias_table: { sha256: aliases.sha256 },
  versions: {
    sig57_detector: SIG57_DETECTOR_VERSION,
    sig57_alias_method: SIG57_ALIAS_METHOD_VERSION,
    baseline_detector: LIABILITY_METHOD_VERSION,
  },
  ...(passed === undefined ? {} : { passed }),
  ...(mode === "control"
    ? { expected: "precision below 0.50 (negative_control.expected)" }
    : mode === "v1"
      ? { expected: "precision and recall 1.00 / 1.00 (T5)" }
      : {}),
  results,
};
const path = join(args.out, `${date}${suffix(set.set, mode)}`);
writeNew(path, `${JSON.stringify(record, null, 2)}\n`);
console.log(
  JSON.stringify({
    path,
    passed,
    results: results.map((r) => ({
      spec: r.spec,
      precision: r.precision,
      recall: r.recall,
      tp: r.true_positives,
      fp: r.false_positives,
      fn: r.false_negatives,
    })),
  }),
);
