// SIG-54 and SIG-60: writes synthetic set v2, v2.1 or v2.2 and its manifest (seed, versions, tax
// table, minimum and final counts per tag, the request-by-history table, the unseen lenders,
// per-applicant and set hashes). The applicant files regenerate from the seed and are not
// committed (research/datasets/*/ is ignored); the manifest is.
//   npx tsx scripts/generate-synthetic-v2.ts --variant 2.2 --check   set v2.2 (generator 2.2.0)
//   npx tsx scripts/generate-synthetic-v2.ts --variant 2.1 --check   set v2.1 (withdrawn)
//   npx tsx scripts/generate-synthetic-v2.ts --variant 2.0 --check   set v2 (withdrawn)
// --check regenerates in memory and compares with the committed manifest; nothing is written,
// and the exit code says whether it matches. Without it the run writes a new set: [--seed n]
// [--out research/datasets/<name>] [--allow-dirty]. The seed defaults to the set's own. Nothing is
// overwritten: an existing folder or manifest stops the run before anything is generated.
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
  type GeneratedApplicant,
} from "../src/research/generator/index.js";
import { TAX_TABLES } from "../src/research/generator/tax.js";
import {
  generateSetV22,
  GENERATOR_VERSION_V22,
  GROUND_TRUTH_SCHEMA_VERSION_V22,
  SET_V22_MINIMUMS,
  SET_V22_SEED,
  UNSEEN_PROVIDERS_V22,
} from "../src/research/generator/v22/index.js";
import {
  gitState,
  parseRunArgs,
  provenance,
  requireCleanTree,
  writeNew,
} from "./lib/run-record.js";
import { checkAgainstManifest, planOutputs } from "./lib/synthetic-outputs.js";

const VARIANTS = {
  "2.0": {
    name: "synthetic-v2",
    seed: SET_V2_SEED,
    generator: GENERATOR_VERSION_V2,
    schema: GROUND_TRUTH_SCHEMA_VERSION_V2,
    minimums: SET_V2_MINIMUMS,
    unseen: UNSEEN_PROVIDERS as Record<string, readonly string[]>,
    generate: (seed: number): GeneratedApplicant[] =>
      populationV2(seed, "2.0").map((s) => generateApplicant(s, seed)),
  },
  "2.1": {
    name: "synthetic-v2.1",
    seed: SET_V21_SEED,
    generator: GENERATOR_VERSION_V21,
    schema: GROUND_TRUTH_SCHEMA_VERSION_V21,
    minimums: SET_V21_MINIMUMS,
    unseen: UNSEEN_PROVIDERS_V21 as Record<string, readonly string[]>,
    generate: (seed: number): GeneratedApplicant[] =>
      populationV2(seed, "2.1").map((s) => generateApplicant(s, seed)),
  },
  "2.2": {
    name: "synthetic-v2.2",
    seed: SET_V22_SEED,
    generator: GENERATOR_VERSION_V22,
    schema: GROUND_TRUTH_SCHEMA_VERSION_V22,
    minimums: SET_V22_MINIMUMS,
    unseen: UNSEEN_PROVIDERS_V22 as Record<string, readonly string[]>,
    generate: (seed: number): GeneratedApplicant[] => generateSetV22(seed),
  },
} as const;

const variantArg = parseRunArgs().values.variant ?? "2.2";
if (!(variantArg in VARIANTS)) throw new Error("--variant must be 2.0, 2.1 or 2.2");
const v = VARIANTS[variantArg as keyof typeof VARIANTS];
const args = parseRunArgs(process.argv.slice(2), `research/datasets/${v.name}`);
const seed = Number(args.values.seed ?? v.seed);
if (!Number.isInteger(seed)) throw new Error("--seed must be an integer");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

if (args.values.check === "true") {
  const all = createHash("sha256");
  const files = v.generate(seed).map((a) => {
    const text = serialise(a);
    all.update(text).update("\n");
    return { id: a.truth.applicant_id, sha256: sha256(text) };
  });
  const diffs = checkAgainstManifest(
    `research/datasets/${v.name}.manifest.json`,
    seed,
    all.digest("hex"),
    files,
  );
  console.log(diffs.length === 0 ? `${v.name}: matches the committed manifest` : diffs.join("\n"));
  process.exit(diffs.length === 0 ? 0 : 1);
}

const git = gitState();
requireCleanTree(git.status, args.allowDirty);
const { folder: out, manifest: manifestPath } = planOutputs(args.out);
const set = createHash("sha256");
const crosstab: Record<string, number> = {};
const applicants = v.generate(seed).map((generated) => {
  const id = generated.truth.applicant_id;
  const text = serialise(generated);
  set.update(text).update("\n");
  writeNew(join(out, "applicants", `${id}.json`), text);
  const key = `request ${generated.truth.v2?.request.lookback_months} / history ${generated.truth.history.months}`;
  crosstab[key] = (crosstab[key] ?? 0) + 1;
  return {
    id,
    tags: generated.truth.tags,
    sha256: sha256(text),
    transactions: generated.feed.accounts.reduce((n, a) => n + a.transactions.length, 0),
  };
});

const byTag: Record<string, number> = {};
for (const a of applicants) for (const t of a.tags) byTag[t] = (byTag[t] ?? 0) + 1;
const sorted = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

const manifest = {
  set: v.name,
  seed,
  generator_version: v.generator,
  ground_truth_schema_version: v.schema,
  as_of_date: AS_OF_DATE,
  tax_table: TAX_TABLES[0],
  applicants: applicants.length,
  transactions: applicants.reduce((n, a) => n + a.transactions, 0),
  minimums: v.minimums,
  by_tag: sorted(byTag),
  request_by_history: sorted(crosstab),
  /** SIG-57 must not add these lenders to its pre-registered alias table. */
  unseen_lenders: v.unseen,
  set_sha256: set.digest("hex"),
  generated_by: provenance("scripts/generate-synthetic-v2.ts", args, git),
  files: applicants,
};
writeNew(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  JSON.stringify({
    out,
    applicants: manifest.applicants,
    transactions: manifest.transactions,
    set_sha256: manifest.set_sha256,
  }),
);
