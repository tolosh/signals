// SIG-54: writes synthetic set v2 and its manifest (seed, versions, tax table, minimum and final
// counts per tag, the request-by-history table, the unseen lenders, per-applicant and set hashes).
// The applicant files regenerate from the seed and are not committed (research/datasets/*/ is
// ignored); the manifest is. Set v1 and its script are unchanged.
// Usage: npx tsx scripts/generate-synthetic-v2.ts [--out research/datasets/synthetic-v2]
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UNSEEN_PROVIDERS } from "../src/research/generator/catalog.js";
import {
  AS_OF_DATE,
  GENERATOR_VERSION_V2,
  GROUND_TRUTH_SCHEMA_VERSION_V2,
  SET_V2_MINIMUMS,
  SET_V2_SEED,
  generateApplicant,
  populationV2,
  serialise,
} from "../src/research/generator/index.js";
import { TAX_TABLES } from "../src/research/generator/tax.js";

const i = process.argv.indexOf("--out");
const out = i > 0 ? (process.argv[i + 1] ?? "") : "research/datasets/synthetic-v2";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "applicants"), { recursive: true });

const set = createHash("sha256");
const crosstab: Record<string, number> = {};
const applicants = populationV2(SET_V2_SEED).map((spec) => {
  const generated = generateApplicant(spec, SET_V2_SEED);
  const text = serialise(generated);
  set.update(text).update("\n");
  writeFileSync(join(out, "applicants", `${spec.id}.json`), text);
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
  set: "synthetic-v2",
  seed: SET_V2_SEED,
  generator_version: GENERATOR_VERSION_V2,
  ground_truth_schema_version: GROUND_TRUTH_SCHEMA_VERSION_V2,
  as_of_date: AS_OF_DATE,
  tax_table: TAX_TABLES[0],
  applicants: applicants.length,
  transactions: applicants.reduce((n, a) => n + a.transactions, 0),
  minimums: SET_V2_MINIMUMS,
  by_tag: sorted(byTag),
  request_by_history: sorted(crosstab),
  /** SIG-57 must not add these lenders to its pre-registered alias table. */
  unseen_lenders: UNSEEN_PROVIDERS,
  set_sha256: set.digest("hex"),
  files: applicants,
};
writeFileSync(`${out}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  JSON.stringify({
    out,
    applicants: manifest.applicants,
    transactions: manifest.transactions,
    set_sha256: manifest.set_sha256,
  }),
);
