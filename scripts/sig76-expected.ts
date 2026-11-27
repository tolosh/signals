// SIG-76 (rulings 40730 and 40732): computes the demo's expected states with the code the demo stage
// runs, assessApplicant (src/assessment/assess.ts; SIG-82 part 1), on the SIG-70 adapter's local
// path and the pinned Enrich build, for the scenarios and the request research/preregistrations/
// SIG-76.json records. The negative control, scenario C, runs first: if it isn't unverified, nothing
// is written. Writes research/preregistrations/SIG-76-expected-states.json, never overwriting it.
//   npx tsx scripts/sig76-expected.ts [--allow-dirty]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  ASSESSMENT_COMPOSITION_VERSION,
  assessApplicant,
  type AssessmentInput,
} from "../src/assessment/assess.js";
import { OBSERVED_EXPENSES_METHOD_VERSION } from "../src/engines/affordability/observed-expenses.js";
import { EQ_METHOD_VERSION } from "../src/engines/evidence/checks.js";
import { INC_VERSION } from "../src/engines/families/inc/index.js";
import { LIA_VERSION } from "../src/engines/families/lia/index.js";
import { generateSetV23 } from "../src/research/generator/v23/index.js";
import {
  gitState,
  manifestSeed,
  parseRunArgs,
  provenance,
  requireCleanTree,
  writeNew,
} from "./lib/run-record.js";

const args = parseRunArgs(process.argv.slice(2), "research/preregistrations");
const git = gitState();
requireCleanTree(git.status, args.allowDirty);
const PREREG = "research/preregistrations/SIG-76.json";
type Prereg = {
  data: { seed: number; set_sha256: string };
  scenarios: Record<"A" | "B" | "C" | "D", { applicant_id: string }>;
  requests: { request: AssessmentInput["request"] };
};
const prereg = JSON.parse(readFileSync(PREREG, "utf8")) as Prereg;
const manifest = manifestSeed("research/datasets/synthetic-v2.3.manifest.json");
if (manifest.seed !== prereg.data.seed || manifest.set_sha256 !== prereg.data.set_sha256)
  throw new Error("the pre-registration's set isn't the manifest's set v2.3");

type Raw = {
  truth: { applicant_id: string; feed_type: AssessmentInput["feed_type"] };
  application: AssessmentInput["application"];
  feed: {
    accounts: {
      account: unknown;
      detail?: unknown;
      transactions?: AssessmentInput["feed"]["accounts"][number]["transactions"];
      transactionList?: {
        data: { transactions: AssessmentInput["feed"]["accounts"][number]["transactions"] };
      };
    }[];
  };
};
const set = generateSetV23(manifest.seed) as unknown as Raw[];
const hash = createHash("sha256");
// The set's hash, as the generator's --check computes it (one serialised applicant per line).
const { serialise } = await import("../src/research/generator/index.js");
for (const a of set) hash.update(serialise(a as never)).update("\n");
if (hash.digest("hex") !== manifest.set_sha256)
  throw new Error("set v2.3 doesn't regenerate to its manifest hash");

const inputOf = (id: string): AssessmentInput => {
  const a = set.find((x) => x.truth.applicant_id === id);
  if (!a) throw new Error(`no applicant ${id} in set v2.3`);
  return {
    applicant_id: id,
    feed_type: a.truth.feed_type,
    application: a.application,
    feed: {
      accounts: a.feed.accounts.map((acc) => ({
        account: acc.account,
        ...(acc.detail ? { detail: acc.detail } : {}),
        transactions: acc.transactions ?? acc.transactionList?.data.transactions ?? [],
      })),
    },
    request: prereg.requests.request,
  };
};

// The negative control first (SIG-76 T2): scenario C must be unverified. Then A, B and D
// (ruling 40776, 4).
const order = ["C", "A", "B", "D"] as const;
const outputs: Record<string, Awaited<ReturnType<typeof assessApplicant>>> = {};
for (const k of order) {
  outputs[k] = await assessApplicant(inputOf(prereg.scenarios[k].applicant_id));
  if (k === "C" && outputs.C?.rollup.evidence !== "unverified")
    throw new Error("the negative control, scenario C, isn't unverified: stop (SIG-76 T2)");
}

const summary = (o: Awaited<ReturnType<typeof assessApplicant>>) => ({
  enrich: {
    path: o.enrich.path,
    build: o.enrich.build,
    engine_version: o.enrich.engine_version,
    taxonomy_version: o.enrich.taxonomy_version,
    transactions: o.enrich.transactions,
  },
  rollup: o.rollup,
  evidence_checks: o.evidence.checks.map((c) => ({ id: c.id, result: c.result })),
  affordability: {
    status: o.affordability.affordability.status,
    serviceability: o.affordability.affordability.serviceability,
    ratios: o.affordability.affordability.ratios.map((r) => ({
      key: r.key,
      state: r.state,
      ...(r.value !== undefined ? { value: r.value } : {}),
    })),
  },
  inc: o.inc.signals.map((s) => ({ id: s.id, state: s.state, value: s.value })),
  lia: o.lia.signals.map((s) => ({ id: s.id, state: s.state, value: s.value })),
});
const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
/**
 * The output as committed: the Enrich response's rows (each holding the raw narrative, as
 * merchant.normalised_from) are replaced by their count and SHA-256. Raw narratives belong in the
 * assessment store, not in a committed file; output_sha256 is still taken over the whole output.
 */
const committed = (o: Awaited<ReturnType<typeof assessApplicant>>) => ({
  ...o,
  enrich: {
    ...o.enrich,
    response: {
      engine_version: o.enrich.response.engine_version,
      taxonomy_version: o.enrich.response.taxonomy_version,
      results: o.enrich.response.results.length,
      results_sha256: sha(o.enrich.response.results),
    },
  },
});
const record = {
  ticket: "SIG-76",
  set: "synthetic-v2.3",
  set_sha256: manifest.set_sha256,
  computed_by: `assessApplicant (src/assessment/assess.ts, composition ${ASSESSMENT_COMPOSITION_VERSION}), on the SIG-70 adapter's local path and the pinned Enrich build (vendor/moroku-enrich/pin.json)`,
  versions: {
    composition: ASSESSMENT_COMPOSITION_VERSION,
    lia: LIA_VERSION,
    inc: INC_VERSION,
    eq_method: EQ_METHOD_VERSION,
    observed_expenses: OBSERVED_EXPENSES_METHOD_VERSION,
  },
  order_run: order,
  negative_control: { scenario: "C", rollup_evidence: outputs.C?.rollup.evidence },
  scenarios: Object.fromEntries(
    (["A", "B", "C", "D"] as const).map((k) => [
      k,
      {
        applicant_id: prereg.scenarios[k].applicant_id,
        output_sha256: sha(outputs[k]),
        summary: summary(outputs[k] as Awaited<ReturnType<typeof assessApplicant>>),
        output: committed(outputs[k] as Awaited<ReturnType<typeof assessApplicant>>),
      },
    ]),
  ),
  ...provenance("scripts/sig76-expected.ts", args, git),
};
writeNew(`${args.out}/SIG-76-expected-states.json`, `${JSON.stringify(record, null, 2)}\n`);
console.log(
  JSON.stringify(
    Object.fromEntries(Object.entries(record.scenarios).map(([k, v]) => [k, v.output_sha256])),
  ),
);
