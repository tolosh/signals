// SIG-39: EQ check results across synthetic set v1, by variant tag. Writes a run record under
// research/runs/. Usage: npx tsx scripts/eq-distribution.ts [--lookback 6|requested]
// "requested" (D22) assumes each applicant's lender asked for the history set v1 holds for it,
// floored at the 3-month minimum; a 1-month history is therefore a shortfall against 3.
// [--out research/runs] [--allow-dirty]. SIG-56: the record stores its command and commit, the
// tree must be clean, and an existing record is never overwritten.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { assessEvidence, DEFINITIONS_VERSION, type Feed } from "../src/engines/evidence/index.js";
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
const git = gitState();
requireCleanTree(git.status, args.allowDirty);
const mode = args.values.lookback ?? "6";
const lookbackFor = (historyMonths: number) =>
  mode === "requested" ? Math.max(3, historyMonths) : Number(mode);
const manifest = manifestSeed();
const hash = createHash("sha256");
const rows: Record<string, Record<string, number>> = {};
const mismatches: {
  applicant_id: string;
  tag: string;
  check: string;
  result: string;
  expected: string;
}[] = [];
for (const spec of population(manifest.seed)) {
  const a = generateApplicant(spec, manifest.seed);
  hash.update(serialise(a)).update("\n");
  const ctx = assessEvidence({
    feed: a.feed as unknown as Feed,
    feed_type: a.truth.feed_type,
    as_of: AS_OF_DATE,
    lookback_months: lookbackFor(a.truth.history.months),
  });
  const tag = spec.tags[0] ?? "salaried-base";
  const row = (rows[tag] ??= { applicants: 0 });
  row.applicants = (row.applicants ?? 0) + 1;
  for (const c of ctx.checks) row[`${c.id} ${c.result}`] = (row[`${c.id} ${c.result}`] ?? 0) + 1;
  // Expected from ground truth: EQ-01 fails only when the salary account is unshared; EQ-02
  // passes only when nothing moves to or from an unshared account; EQ-03 fails under 60%.
  const t = a.truth;
  const expected = {
    "EQ-01": t.coverage.salary_account_shared ? "pass" : "fail",
    "EQ-02":
      !t.coverage.salary_account_shared || t.coverage.unshared_transfer_accounts > 0
        ? "not pass"
        : "pass",
    "EQ-03":
      t.history.months >= lookbackFor(t.history.months)
        ? "pass"
        : t.history.months / lookbackFor(t.history.months) >= 0.6
          ? "partial"
          : "fail",
  } as const;
  for (const c of ctx.checks) {
    const e = expected[c.id];
    const ok = e === "not pass" ? c.result !== "pass" : c.result === e;
    if (!ok)
      mismatches.push({ applicant_id: spec.id, tag, check: c.id, result: c.result, expected: e });
  }
}
const setSha = hash.digest("hex");
if (setSha !== manifest.set_sha256)
  throw new Error(`set hash ${setSha} does not match the manifest`);
const commit = git.commit;
const created_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const run_id = `${created_at.slice(0, 10)}-${manifest.set}-eq-checks${mode === "6" ? "" : `-lookback-${mode}`}`;
const record = {
  run_id,
  created_at,
  ticket: "SIG-39",
  ...provenance("scripts/eq-distribution.ts", args, git),
  dataset: { set: manifest.set, seed: manifest.seed, set_sha256: setSha },
  engine: { name: "evidence-quality", commit, definitions_version: DEFINITIONS_VERSION },
  input: {
    as_of: AS_OF_DATE,
    lookback_months: mode === "requested" ? "max(3, history months)" : Number(mode),
  },
  by_tag: rows,
  mismatches,
};
writeNew(join(args.out, `${run_id}.json`), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ by_tag: rows, mismatches: mismatches.length }, null, 1));
