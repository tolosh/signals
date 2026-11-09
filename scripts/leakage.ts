// SIG-60 T7: the adversarial leakage test on one synthetic set, written as a run record.
//   npx tsx scripts/leakage.ts --set v2      negative control (withdrawn set v2)
//   npx tsx scripts/leakage.ts --set v2.1    negative control (withdrawn set v2.1)
//   npx tsx scripts/leakage.ts --set v2.2    the set under test
// Options: [--out research/runs] [--allow-dirty]. The set regenerates from its manifest's seed and
// must match its manifest's hash. Everything the test applies is read from the pre-registration
// research/preregistrations/SIG-60.json. A record is never overwritten.
import { join } from "node:path";
import { runSet, verdict, MANIFESTS, type SetName } from "../src/research/leakage/run.js";
import {
  gitState,
  parseRunArgs,
  provenance,
  requireCleanTree,
  writeNew,
} from "./lib/run-record.js";

const args = parseRunArgs();
const set = (args.values.set ?? "") as SetName;
if (!(set in MANIFESTS)) throw new Error("--set must be v2, v2.1 or v2.2");
const git = gitState();
requireCleanTree(git.status, args.allowDirty);
const result = runSet(set);
const v = verdict(result);
const record = {
  ticket: "SIG-60",
  test: "T7 adversarial leakage test",
  role: set === "v2.2" ? "set under test" : "negative control",
  verdict: v.pass
    ? set === "v2.2"
      ? "every label within margin; every validity check passes"
      : "caught on every channel its review found"
    : `FAILS: ${v.failing.join("; ")}`,
  ...result,
  generated_by: provenance("scripts/leakage.ts", args, git),
};
const created = new Date().toISOString().slice(0, 10);
const path = join(args.out, `${created}-sig60-leakage-${set}.json`);
writeNew(path, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ path, verdict: record.verdict }));
