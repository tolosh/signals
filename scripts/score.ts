// SIG-13: score an engine against a synthetic set and write a dated run record (JSON and markdown)
// under research/runs/. The set is regenerated from the manifest's seed and refused unless its
// hash matches the published one.
// Usage: npx tsx scripts/score.ts --engine <name> [--manifest research/datasets/synthetic-v1.manifest.json]
//        [--definitions none] [--thresholds none] [--taxonomy 1.4]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  generateApplicant,
  population,
  serialise,
  type GeneratedApplicant,
} from "../src/research/generator/index.js";
import { score, summarise, truthFlags, type Engine } from "../src/research/harness/index.js";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const engineName = arg("engine", "");
const manifestPath = arg("manifest", "research/datasets/synthetic-v1.manifest.json");

type Manifest = {
  set: string;
  seed: number;
  set_sha256: string;
  generator_version: string;
  ground_truth_schema_version: string;
};
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

const hash = createHash("sha256");
const applicants: GeneratedApplicant[] = population(manifest.seed).map((spec) => {
  const a = generateApplicant(spec, manifest.seed);
  hash.update(serialise(a)).update("\n");
  return a;
});
const setSha = hash.digest("hex");
if (setSha !== manifest.set_sha256) {
  throw new Error(
    `Regenerated set hash ${setSha} does not match the manifest ${manifest.set_sha256}`,
  );
}

// Calibration engines read the ground truth, so they test the harness, not a method. Real
// engines (SIG-16 to SIG-18) are added here and see only the application and the feed.
const truth = new Map(applicants.map((a) => [a.truth.applicant_id, a.truth]));
const oracle =
  (incomeFactor: number): Engine =>
  ({ applicant_id }) => {
    const t = truth.get(applicant_id);
    if (!t) throw new Error(`no truth for ${applicant_id}`);
    return {
      income_net_monthly: t.income.net_monthly * incomeFactor,
      expenses_total_monthly: t.expenses.total_monthly,
      liabilities: t.liabilities.items.map((l) => ({ type: l.type, provider: l.provider })),
      flags: truthFlags(t),
    };
  };
const ENGINES: Record<string, { engine: Engine; version: string }> = {
  oracle: { engine: oracle(1), version: "calibration" },
  "oracle-income-plus-10": { engine: oracle(1.1), version: "calibration" },
};
const chosen = ENGINES[engineName];
if (!chosen) throw new Error(`--engine must be one of: ${Object.keys(ENGINES).join(", ")}`);

const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const runId = `${createdAt.slice(0, 10)}-${manifest.set}-${engineName}`;

const record = score(applicants, chosen.engine, {
  run_id: runId,
  created_at: createdAt,
  ticket: arg("ticket", "SIG-13"),
  dataset: {
    set: manifest.set,
    seed: manifest.seed,
    set_sha256: setSha,
    generator_version: manifest.generator_version,
    ground_truth_schema_version: manifest.ground_truth_schema_version,
  },
  engine: { name: engineName, commit, version: chosen.version },
  versions: {
    definitions: arg("definitions", "none"),
    thresholds: arg("thresholds", "none"),
    taxonomy: arg("taxonomy", "1.4"),
  },
});

const base = `research/runs/${runId}`;
writeFileSync(`${base}.json`, `${JSON.stringify(record, null, 2)}\n`);
writeFileSync(`${base}.md`, summarise(record));
console.log(
  JSON.stringify({
    run: base,
    income_mean_abs_pct_error: record.metrics.income.mean_abs_pct_error,
    liabilities: record.metrics.liabilities.all,
    misses: record.misses.length,
  }),
);
