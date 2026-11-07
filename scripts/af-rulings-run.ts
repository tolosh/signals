// SIG-15 follow-up: a dated run of the affordability engine after the 7 November 2026 rulings
// (I-4 and I-5; Decision Record D24, D25). It records AF-T1's output and a boundary sweep that
// counts where judging the state on the rounded value differs from the unrounded one.
// Usage: npx tsx scripts/af-rulings-run.ts
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  computeAffordability,
  DEFAULT_THRESHOLDS,
  type AffordabilityInput,
} from "../src/engines/affordability/index.js";

const fixture = JSON.parse(readFileSync("test/fixtures/af-t1.json", "utf8")) as {
  input: AffordabilityInput;
};
const run = (input: AffordabilityInput) => computeAffordability(input, DEFAULT_THRESHOLDS);
const afT1 = run(fixture.input);

// Sweep net LTI across the amber boundary (from 3.5) by varying the loan amount.
const annualNet = afT1.affordability.serviceability.monthly_income * 12;
let changed = 0;
let total = 0;
const examples: { loan: number; net_unrounded: number; net_shown: number; state: string }[] = [];
for (let loan = 600_000; loan <= 680_000; loan += 1) {
  const input = { ...fixture.input, loan: { ...fixture.input.loan, amount: loan } };
  const lti = run(input).affordability.ratios.find((r) => r.key === "lti");
  const unrounded = loan / annualNet;
  const before = unrounded >= 3.5 ? "amber" : "green";
  total++;
  if (lti?.state !== before) {
    changed++;
    if (examples.length < 3)
      examples.push({
        loan,
        net_unrounded: Number(unrounded.toFixed(6)),
        net_shown: lti?.net ?? NaN,
        state: String(lti?.state),
      });
  }
}
const noGross = run({
  ...fixture.input,
  income: { ...fixture.input.income, stated_gross_annual: null },
}).affordability.ratios.filter((r) => r.key === "lti" || r.key === "dti");

const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const created_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const record = {
  run_id: `${created_at.slice(0, 10)}-sig15-rulings`,
  created_at,
  ticket: "SIG-15",
  rulings: ["I-4 (D25): states on the rounded value", "I-5 (D24): LTI and DTI badges follow net"],
  engine: { commit, thresholds_version: DEFAULT_THRESHOLDS.version },
  af_t1: {
    affordability_sha256: createHash("sha256")
      .update(JSON.stringify(afT1.affordability))
      .digest("hex"),
    states: Object.fromEntries(afT1.affordability.ratios.map((r) => [r.key, r.state])),
  },
  boundary_sweep: {
    ratio: "lti (net), amber from 3.5",
    loans: { from: 600_000, to: 680_000, step: 1 },
    cases: total,
    state_changed_by_i4: changed,
    examples,
  },
  without_gross: noGross,
};
writeFileSync(`research/runs/${record.run_id}.json`, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ run: record.run_id, ...record.boundary_sweep, examples: undefined }));
