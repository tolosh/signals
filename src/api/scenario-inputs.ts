// SIG-82 candidate 1 (40786; 40802, 4; SIG-76 40801): the five scenario inputs the demo stage
// assesses, built exactly as SIG-76's in-process runs built them (scripts/sig76-expected.ts): set
// v2.3 regenerated from its manifest seed and checked against its hash, each pre-registered
// applicant's own application and feed, each account's transactions in the generator's order,
// and the pre-registered request. Built once, at build time (infra/build-demo-lambda.mjs), into the
// Lambda's asset: the hosted run then sends each feed in its seeded order, so T3 can compare its
// output with the frozen states byte for byte. Synthetic data only.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AssessmentInput } from "../assessment/assess.js";
import { serialise } from "../research/generator/index.js";
import { generateSetV23 } from "../research/generator/v23/index.js";
import type { ScenarioKey } from "./seed.js";

export type ScenarioInputs = Record<ScenarioKey, AssessmentInput>;
const KEYS: readonly ScenarioKey[] = ["A", "B", "C", "D", "D2"];

type Prereg = {
  data: { seed: number; set_sha256: string };
  scenarios: Record<ScenarioKey, { applicant_id: string }>;
  requests: { request: AssessmentInput["request"] };
};
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

export function buildScenarioInputs(
  preregPath = "research/preregistrations/SIG-76.json",
  manifestPath = "research/datasets/synthetic-v2.3.manifest.json",
): ScenarioInputs {
  const prereg = JSON.parse(readFileSync(preregPath, "utf8")) as Prereg;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    seed: number;
    set_sha256: string;
  };
  if (manifest.seed !== prereg.data.seed || manifest.set_sha256 !== prereg.data.set_sha256)
    throw new Error("the pre-registration's set isn't the manifest's set v2.3");
  const set = generateSetV23(manifest.seed) as unknown as Raw[];
  const hash = createHash("sha256");
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
  // A JSON round trip, so the value is exactly what the asset file holds.
  return JSON.parse(
    JSON.stringify(
      Object.fromEntries(KEYS.map((k) => [k, inputOf(prereg.scenarios[k].applicant_id)])),
    ),
  ) as ScenarioInputs;
}
