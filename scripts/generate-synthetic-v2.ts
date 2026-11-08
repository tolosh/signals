// SIG-54: writes synthetic set v2 or v2.1 and its manifest (seed, versions, tax table, minimum and
// final counts per tag, the request-by-history table, the unseen lenders, per-applicant and set
// hashes). The applicant files regenerate from the seed and are not committed (research/datasets/
// */ is ignored); the manifest is.
//   npx tsx scripts/generate-synthetic-v2.ts --variant 2.1   set v2.1 (generator 2.1.0), seed 541
//   npx tsx scripts/generate-synthetic-v2.ts --variant 2.0   set v2 (withdrawn from experiments)
// Options: [--seed n] [--out research/datasets/synthetic-v2.1] [--allow-dirty]. The seed defaults
// to the set's own. Nothing is overwritten: an existing folder or manifest stops the run, so a
// regeneration goes to a new --out and is compared with the committed manifest.
// On the shared run-record helpers since the set v2 review (8 November 2026).
import { createHash } from "node:crypto";
import { join } from "node:path";
import { UNSEEN_PROVIDERS, UNSEEN_PROVIDERS_V21 } from "../src/research/generator/catalog.js";
import {
  AS_OF_DATE,
  GENERATOR_VERSION_V2,
  GENERATOR_VERSION_V21,
  GROUND_TRUTH_SCHEMA_VERSION_V2,
  GROUND_TRUTH_SCHEMA_VERSION_V21,
  SET_V2_MINIMUMS,
  SET_V2_SEED,
  SET_V21_MINIMUMS,
  SET_V21_SEED,
  generateApplicant,
  populationV2,
  serialise,
} from "../src/research/generator/index.js";
import { TAX_TABLES } from "../src/research/generator/tax.js";
import {
  gitState,
  parseRunArgs,
  provenance,
  requireCleanTree,
  writeNew,
} from "./lib/run-record.js";

const variantArg = parseRunArgs().values.variant ?? "2.1";
if (variantArg !== "2.0" && variantArg !== "2.1") throw new Error("--variant must be 2.0 or 2.1");
const variant: "2.0" | "2.1" = variantArg;
const v21 = variant === "2.1";
const name = v21 ? "synthetic-v2.1" : "synthetic-v2";
const args = parseRunArgs(process.argv.slice(2), `research/datasets/${name}`);
const git = gitState();
requireCleanTree(git.status, args.allowDirty);
const seed = Number(args.values.seed ?? (v21 ? SET_V21_SEED : SET_V2_SEED));
if (!Number.isInteger(seed)) throw new Error("--seed must be an integer");
const out = args.out;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const set = createHash("sha256");
const crosstab: Record<string, number> = {};
const applicants = populationV2(seed, variant).map((spec) => {
  const generated = generateApplicant(spec, seed);
  const text = serialise(generated);
  set.update(text).update("\n");
  writeNew(join(out, "applicants", `${spec.id}.json`), text);
  const key = `request ${generated.truth.v2?.request.lookback_months} / history ${generated.truth.history.months}`;
  crosstab[key] = (crosstab[key] ?? 0) + 1;
  return {
    id: spec.id,
    tags: spec.tags,
    sha256: sha256(text),
    transactions: generated.feed.accounts.reduce((n, a) => n + a.transactions.length, 0),
  };
});

const byTag: Record<string, number> = {};
for (const a of applicants) for (const t of a.tags) byTag[t] = (byTag[t] ?? 0) + 1;
const sorted = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

const manifest = {
  set: name,
  seed,
  generator_version: v21 ? GENERATOR_VERSION_V21 : GENERATOR_VERSION_V2,
  ground_truth_schema_version: v21
    ? GROUND_TRUTH_SCHEMA_VERSION_V21
    : GROUND_TRUTH_SCHEMA_VERSION_V2,
  as_of_date: AS_OF_DATE,
  tax_table: TAX_TABLES[0],
  applicants: applicants.length,
  transactions: applicants.reduce((n, a) => n + a.transactions, 0),
  minimums: v21 ? SET_V21_MINIMUMS : SET_V2_MINIMUMS,
  by_tag: sorted(byTag),
  request_by_history: sorted(crosstab),
  /** SIG-57 must not add these lenders to its pre-registered alias table. */
  unseen_lenders: v21 ? UNSEEN_PROVIDERS_V21 : UNSEEN_PROVIDERS,
  set_sha256: set.digest("hex"),
  generated_by: provenance("scripts/generate-synthetic-v2.ts", args, git),
  files: applicants,
};
writeNew(`${out}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  JSON.stringify({
    out,
    applicants: manifest.applicants,
    transactions: manifest.transactions,
    set_sha256: manifest.set_sha256,
  }),
);
