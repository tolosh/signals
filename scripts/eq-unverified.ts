// SIG-39 (ruling, 7 November 2026, on the independent review): how many set v1 applicants are
// unverified (RU-4: EQ-01 or EQ-03 fails) under an assumed lender request.
//   npx tsx scripts/eq-unverified.ts --mode result       a 6-month request for everyone (the D22
//                                                          default): the reported result
//   npx tsx scripts/eq-unverified.ts --mode sensitivity  requests of 3, 6 and 12 months, and the
//                                                          max(3, history) proxy: a sensitivity range,
//                                                          never a result
// Options: [--out research/runs] [--allow-dirty].
// Set v1 records no lender request, so every figure here depends on the assumed request.
// On the shared run-record helpers since the SIG-42 review ruling (8 November 2026); the record
// now also states the EQ method version applied.
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  assessEvidence,
  DEFINITIONS_VERSION,
  EQ_METHOD_VERSION,
  type Feed,
} from "../src/engines/evidence/index.js";
import {
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

const args = parseRunArgs();
const mode = args.values.mode;
if (mode !== "result" && mode !== "sensitivity")
  throw new Error("Usage: --mode result|sensitivity [--out folder] [--allow-dirty]");
const git = gitState();
requireCleanTree(git.status, args.allowDirty);

type Request = number | "max(3, history)";
const requests: Request[] = mode === "result" ? [6] : [3, 6, 12, "max(3, history)"];
const manifest = manifestSeed();

const hash = createHash("sha256");
const applicants = population(manifest.seed).map((spec) => {
  const a = generateApplicant(spec, manifest.seed);
  hash.update(serialise(a)).update("\n");
  return a;
});
const setSha = hash.digest("hex");
if (setSha !== manifest.set_sha256)
  throw new Error(`set hash ${setSha} does not match the manifest`);

const results = requests.map((request) => {
  const byHistory: Record<string, { applicants: number; unverified: number }> = {};
  let eq01Fail = 0;
  let eq03Fail = 0;
  let eq03Partial = 0;
  let unverified = 0;
  for (const a of applicants) {
    const months = a.truth.history.months;
    const lookback = request === "max(3, history)" ? Math.max(3, months) : request;
    const ctx = assessEvidence({
      feed: a.feed as unknown as Feed,
      feed_type: a.truth.feed_type,
      as_of: AS_OF_DATE,
      lookback_months: lookback,
    });
    const r = (id: string) => ctx.checks.find((c) => c.id === id)?.result;
    const blocked = r("EQ-01") === "fail" || r("EQ-03") === "fail";
    if (r("EQ-01") === "fail") eq01Fail++;
    if (r("EQ-03") === "fail") eq03Fail++;
    if (r("EQ-03") === "partial") eq03Partial++;
    if (blocked) unverified++;
    const row = (byHistory[`${months} months`] ??= { applicants: 0, unverified: 0 });
    row.applicants++;
    if (blocked) row.unverified++;
  }
  return {
    assumed_request_months: request,
    applicants: applicants.length,
    unverified,
    unverified_pct: Math.round((unverified / applicants.length) * 1000) / 10,
    eq01_fail: eq01Fail,
    eq03_fail: eq03Fail,
    eq03_partial: eq03Partial,
    by_history: byHistory,
  };
});

const created_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const run_id = `${created_at.slice(0, 10)}-${manifest.set}-eq-unverified-${mode === "result" ? "request-6" : "sensitivity"}`;
const record = {
  run_id,
  created_at,
  ticket: "SIG-39",
  ...provenance("scripts/eq-unverified.ts", args, git),
  reported_as:
    mode === "result"
      ? "Result: the D22 default request of 6 months for every applicant"
      : "Sensitivity range across assumed requests only, never a result (ruling, 7 November 2026)",
  dataset: { set: manifest.set, seed: manifest.seed, set_sha256: setSha },
  engine: {
    name: "evidence-quality",
    commit: git.commit,
    definitions_version: DEFINITIONS_VERSION,
    eq_method_version: EQ_METHOD_VERSION,
  },
  input: { as_of: AS_OF_DATE, unverified_rule: "RU-4: EQ-01 or EQ-03 fails" },
  results,
};
writeNew(join(args.out, `${run_id}.json`), `${JSON.stringify(record, null, 2)}\n`);
console.log(
  JSON.stringify(
    results.map((r) => [r.assumed_request_months, r.unverified, r.unverified_pct]),
    null,
    0,
  ),
);
