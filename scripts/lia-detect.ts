// SIG-18 (H2): hidden liabilities across synthetic set v1, as pre-registered in
// research/preregistrations/SIG-18.json. Run the negative control first:
//   npx tsx scripts/lia-detect.ts --mode control   rotated declarations, primary configuration
//   npx tsx scripts/lia-detect.ts --mode primary   min occurrences 3, tolerance 15%: the result
//   npx tsx scripts/lia-detect.ts --mode grid      min occurrences 2 and 3 x tolerance 5% and 15%
// Each record stores its command line, refuses a dirty working tree (so engine.commit is the code
// that ran), and never overwrites an existing record. Records carry IDs, families and providers
// only: never a transaction description.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { LIABILITY_METHOD_VERSION } from "../src/engines/liabilities/index.js";
import { loadSet, scoreSet, type Config } from "../src/research/liabilities-score.js";

const args = process.argv.slice(2);
const mode = args[args.indexOf("--mode") + 1] ?? "";
if (!args.includes("--mode") || !["control", "primary", "grid"].includes(mode))
  throw new Error("Usage: --mode control|primary|grid");
const out = `research/runs/2026-11-07-synthetic-v1-liabilities-v${LIABILITY_METHOD_VERSION}-${mode}.json`;
if (existsSync(out)) throw new Error(`${out} exists; records are never overwritten`);
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
if (dirty) throw new Error(`Uncommitted changes; commit before recording engine.commit:\n${dirty}`);
const prereg = JSON.parse(readFileSync("research/preregistrations/SIG-18.json", "utf8")) as {
  primary_configuration: Config;
  variables: { min_occurrences: number[]; amount_tolerance: number[] };
};
if (mode !== "control" && !existsSync(out.replace(`-${mode}.json`, "-control.json")))
  throw new Error("Run the negative control first (--mode control)");

const { manifest, applicants, categories, enrich } = loadSet();
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

const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const record = {
  ticket: "SIG-18",
  hypothesis: "H2",
  run:
    mode === "control"
      ? "negative control"
      : mode === "primary"
        ? "primary (the result)"
        : "grid (sensitivity)",
  date: "2026-11-07",
  command: `npx tsx scripts/lia-detect.ts ${args.join(" ")}`,
  preregistration: "research/preregistrations/SIG-18.json",
  set: {
    name: manifest.set,
    seed: manifest.seed,
    set_sha256: manifest.set_sha256,
    applicants: applicants.length,
  },
  engine: { name: "liabilities", method_version: LIABILITY_METHOD_VERSION, commit },
  categoriser: { ...enrich, source: "research/enrich/synthetic-v1-categories.json" },
  runs,
};
writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
for (const r of runs)
  console.log(
    `${r.variant} min ${r.config.min_occurrences} tol ${r.config.amount_tolerance}: precision ${r.precision}, recall ${r.recall} (tp ${r.true_positives}, fp ${r.false_positives}, fn ${r.false_negatives})`,
  );
console.log(`wrote ${out}`);
