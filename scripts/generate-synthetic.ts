// SIG-12: writes synthetic set v1 and its manifest (seed, versions, per-applicant and set hashes).
// The applicant files are reproducible from the seed and are not committed; the manifest is.
// Usage: npx tsx scripts/generate-synthetic.ts [--seed 42] [--out research/datasets/synthetic-v1]
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  GENERATOR_VERSION,
  GROUND_TRUTH_SCHEMA_VERSION,
  AS_OF_DATE,
  generateApplicant,
  population,
  serialise,
} from "../src/research/generator/index.js";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const seed = Number(arg("seed", "42"));
const out = arg("out", "research/datasets/synthetic-v1");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "applicants"), { recursive: true });

const set = createHash("sha256");
const applicants = population(seed).map((spec) => {
  const generated = generateApplicant(spec, seed);
  const text = serialise(generated);
  set.update(text).update("\n");
  writeFileSync(join(out, "applicants", `${spec.id}.json`), text);
  return {
    id: spec.id,
    tags: spec.tags,
    sha256: sha256(text),
    transactions: generated.feed.accounts.reduce((n, a) => n + a.transactions.length, 0),
  };
});

const byTag: Record<string, number> = {};
for (const a of applicants) for (const t of a.tags) byTag[t] = (byTag[t] ?? 0) + 1;

const manifest = {
  set: "synthetic-v1",
  seed,
  generator_version: GENERATOR_VERSION,
  ground_truth_schema_version: GROUND_TRUTH_SCHEMA_VERSION,
  as_of_date: AS_OF_DATE,
  applicants: applicants.length,
  transactions: applicants.reduce((n, a) => n + a.transactions, 0),
  by_tag: byTag,
  set_sha256: set.digest("hex"),
  files: applicants,
};
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  JSON.stringify({
    out,
    applicants: manifest.applicants,
    transactions: manifest.transactions,
    set_sha256: manifest.set_sha256,
  }),
);
