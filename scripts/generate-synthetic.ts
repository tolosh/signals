// SIG-12: writes synthetic set v1 and its manifest (seed, versions, per-applicant and set hashes).
// The applicant files are reproducible from the seed and are not committed; the manifest is.
// The seed comes from the committed manifest (research/datasets/synthetic-v1.manifest.json).
// Usage: npx tsx scripts/generate-synthetic.ts [--out research/datasets/synthetic-v1]
//        [--allow-dirty] [--check]
// --check (SIG-60): regenerate in memory and compare with the committed manifest; nothing is
// written, and the exit code says whether it matches.
// On the shared run-record helpers since the SIG-42 review ruling (8 November 2026). The output
// folder is cleared first, as before, so each file is new; the manifest records how it was made.
import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  GENERATOR_VERSION,
  GROUND_TRUTH_SCHEMA_VERSION,
  AS_OF_DATE,
  generateApplicant,
  population,
  serialise,
} from "../src/research/generator/index.js";
import {
  gitState,
  manifestSeed,
  parseRunArgs,
  provenance,
  requireCleanTree,
  writeNew,
} from "./lib/run-record.js";
import { checkAgainstManifest } from "./lib/synthetic-outputs.js";

const args = parseRunArgs(process.argv.slice(2), "research/datasets/synthetic-v1");
if (args.values.check === "true") {
  const { seed: checkSeed } = manifestSeed();
  const all = createHash("sha256");
  const files = population(checkSeed).map((spec) => {
    const text = serialise(generateApplicant(spec, checkSeed));
    all.update(text).update("\n");
    return { id: spec.id, sha256: createHash("sha256").update(text).digest("hex") };
  });
  const diffs = checkAgainstManifest(
    "research/datasets/synthetic-v1.manifest.json",
    checkSeed,
    all.digest("hex"),
    files,
  );
  console.log(
    diffs.length === 0 ? "synthetic-v1: matches the committed manifest" : diffs.join("\n"),
  );
  process.exit(diffs.length === 0 ? 0 : 1);
}
const git = gitState();
requireCleanTree(git.status, args.allowDirty);
const { seed } = manifestSeed();
const out = args.out;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "applicants"), { recursive: true });

const set = createHash("sha256");
const applicants = population(seed).map((spec) => {
  const generated = generateApplicant(spec, seed);
  const text = serialise(generated);
  set.update(text).update("\n");
  writeNew(join(out, "applicants", `${spec.id}.json`), text);
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
writeNew(
  join(out, "manifest.json"),
  `${JSON.stringify({ ...manifest, generated_by: provenance("scripts/generate-synthetic.ts", args, git) }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    out,
    applicants: manifest.applicants,
    transactions: manifest.transactions,
    set_sha256: manifest.set_sha256,
  }),
);
