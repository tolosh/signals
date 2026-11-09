// SIG-60: the evidence for set v2.2's four limits, written as a run record (ruling, 9 November
// 2026, SIG-60 comment 40197). A post-hoc diagnostic, not part of the pre-registered T7.
//   npx tsx scripts/leakage-limits.ts [--out research/runs] [--allow-dirty]
// The set regenerates from its manifest's seed and must match its hash. A record is never
// overwritten.
import { join } from "node:path";
import { limitsDiagnostic } from "../src/research/leakage/limits.js";
import {
  gitState,
  parseRunArgs,
  provenance,
  requireCleanTree,
  writeNew,
} from "./lib/run-record.js";

const args = parseRunArgs();
const git = gitState();
requireCleanTree(git.status, args.allowDirty);
const record = {
  ticket: "SIG-60",
  analysis: "the stratified evidence for set v2.2's four T7 limits (post hoc; not part of T7)",
  role: "diagnostic",
  ...limitsDiagnostic(),
  generated_by: provenance("scripts/leakage-limits.ts", args, git),
};
const created = new Date().toISOString().slice(0, 10);
const path = join(args.out, `${created}-sig60-leakage-v2.2-limits.json`);
writeNew(path, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ path }));
