// SIG-18 (H2): hidden liabilities across synthetic set v1, as pre-registered in
// research/preregistrations/SIG-18.json. Run the negative control first:
//   npx tsx scripts/lia-detect.ts --mode control   rotated declarations, primary configuration
//   npx tsx scripts/lia-detect.ts --mode primary   min occurrences 3, tolerance 15%: the result
//   npx tsx scripts/lia-detect.ts --mode grid      min occurrences 2 and 3 x tolerance 5% and 15%
// Options: [--out research/runs] [--allow-dirty]. A re-run of a committed record goes to another
// folder with --out, because records are never overwritten; the control must already be in that
// folder. Records carry IDs, families and providers only, never a transaction description.
// On the shared run-record helpers since the SIG-42 review ruling (8 November 2026).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LIABILITY_METHOD_VERSION } from "../src/engines/liabilities/index.js";
import { loadSet, scoreSet, type Config } from "../src/research/liabilities-score.js";
import {
  gitState,
  parseRunArgs,
  provenance,
  requireCleanTree,
  writeNew,
} from "./lib/run-record.js";

const args = parseRunArgs();
const mode = args.values.mode ?? "";
if (!["control", "primary", "grid"].includes(mode))
  throw new Error("Usage: --mode control|primary|grid [--out folder] [--allow-dirty]");
const git = gitState();
requireCleanTree(git.status, args.allowDirty);

const prereg = JSON.parse(readFileSync("research/preregistrations/SIG-18.json", "utf8")) as {
  primary_configuration: Config;
  variables: { min_occurrences: number[]; amount_tolerance: number[] };
};
const { manifest, applicants, categories, enrich } = loadSet();
const suffix = (m: string) => `-${manifest.set}-liabilities-v${LIABILITY_METHOD_VERSION}-${m}.json`;
const inOut = (() => {
  try {
    return readdirSync(args.out);
  } catch {
    return [];
  }
})();
if (mode !== "control" && !inOut.some((f) => f.endsWith(suffix("control"))))
  throw new Error(`Run the negative control first (--mode control) into ${args.out}`);

const primary = prereg.primary_configuration;
const runs =
  mode === "control"
    ? [scoreSet(applicants, categories, primary, "rotated-declarations")]
    : mode === "primary"
      ? [scoreSet(applicants, categories, primary, "as-generated")]
      : prereg.variables.min_occurrences.flatMap((min_occurrences) =>
          prereg.variables.amount_tolerance.map((amount_tolerance) => {
            const r = scoreSet(
              applicants,
              categories,
              { min_occurrences, amount_tolerance },
              "as-generated",
            );
            // The grid keeps the counts; the primary record carries the lists.
            return Object.fromEntries(
              Object.entries(r).filter(([k]) => !k.endsWith("_list")),
            ) as Omit<typeof r, "false_positives_list" | "false_negatives_list">;
          }),
        );

const date = new Date().toISOString().slice(0, 10);
const record = {
  ticket: "SIG-18",
  hypothesis: "H2",
  run:
    mode === "control"
      ? "negative control"
      : mode === "primary"
        ? "primary (the result)"
        : "grid (sensitivity)",
  date,
  ...provenance("scripts/lia-detect.ts", args, git),
  preregistration: "research/preregistrations/SIG-18.json",
  set: {
    name: manifest.set,
    seed: manifest.seed,
    set_sha256: manifest.set_sha256,
    applicants: applicants.length,
  },
  engine: { name: "liabilities", method_version: LIABILITY_METHOD_VERSION, commit: git.commit },
  categoriser: { ...enrich, source: "research/enrich/synthetic-v1-categories.json" },
  runs,
};
const out = join(args.out, `${date}${suffix(mode)}`);
writeNew(out, `${JSON.stringify(record, null, 2)}\n`);
for (const r of runs)
  console.log(
    `${r.variant} min ${r.config.min_occurrences} tol ${r.config.amount_tolerance}: precision ${r.precision}, recall ${r.recall} (tp ${r.true_positives}, fp ${r.false_positives}, fn ${r.false_negatives})`,
  );
console.log(`wrote ${out}`);
