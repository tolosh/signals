// SIG-41: family 1 INC states across synthetic set v1, by variant tag. Writes a run record under
// research/runs/. Usage: npx tsx scripts/inc-distribution.ts
// Production defaults: no gross-up (SIG-46 on hold, so INC-02 is unverified), no occupation pay
// bands and no application data, which set v1 does not carry. The requested lookback is taken as
// max(3, history months), as in the SIG-39 D22 re-run, because set v1 records no request.
// Expected from ground truth: set v1's salaried pay has zero variability (SIG-16), so the
// salaried base group should show no amber or red INC signal.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { Feed } from "../src/engines/evidence/index.js";
import { assessInc, INC_VERSION } from "../src/engines/families/inc/index.js";
import {
  AS_OF_DATE,
  generateApplicant,
  population,
  serialise,
} from "../src/research/generator/index.js";

const manifest = JSON.parse(
  readFileSync("research/datasets/synthetic-v1.manifest.json", "utf8"),
) as { set: string; seed: number; set_sha256: string };
const hash = createHash("sha256");
const byTag: Record<
  string,
  { applicants: number; states: Record<string, Record<string, number>> }
> = {};
const salariedFlags: { applicant_id: string; signal: string; state: string; reason: string }[] = [];
for (const spec of population(manifest.seed)) {
  const a = generateApplicant(spec, manifest.seed);
  hash.update(serialise(a)).update("\n");
  const r = assessInc({
    feed: a.feed as unknown as Feed,
    feed_type: a.truth.feed_type,
    as_of: AS_OF_DATE,
    lookback_months: Math.max(3, a.truth.history.months),
  });
  const tag = spec.tags[0] ?? "salaried-base";
  const row = (byTag[tag] ??= { applicants: 0, states: {} });
  row.applicants++;
  for (const s of r.signals) {
    const counts = (row.states[s.id] ??= {});
    counts[s.state] = (counts[s.state] ?? 0) + 1;
    if (tag === "salaried-base" && (s.state === "amber" || s.state === "red"))
      salariedFlags.push({ applicant_id: spec.id, signal: s.id, state: s.state, reason: s.reason });
  }
}
const setSha = hash.digest("hex");
if (setSha !== manifest.set_sha256)
  throw new Error(`set hash ${setSha} does not match the manifest`);
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const created_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const run_id = `${created_at.slice(0, 10)}-${manifest.set}-inc-family-v${INC_VERSION}`;
const record = {
  run_id,
  created_at,
  ticket: "SIG-41",
  dataset: { set: manifest.set, seed: manifest.seed, set_sha256: setSha },
  engine: { name: "inc-family", version: INC_VERSION, commit },
  input: {
    as_of: AS_OF_DATE,
    lookback_months: "max(3, history months)",
    application: "none",
    gross_up: "none (SIG-46 on hold)",
    config: "production defaults",
  },
  by_tag: byTag,
  salaried_base_amber_or_red: salariedFlags,
};
writeFileSync(`research/runs/${run_id}.json`, `${JSON.stringify(record, null, 2)}\n`);
console.log(
  JSON.stringify(
    { run_id, salaried_base_amber_or_red: salariedFlags.length, tags: Object.keys(byTag) },
    null,
    1,
  ),
);
