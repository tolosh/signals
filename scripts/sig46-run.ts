// SIG-46 T2: gross-up accuracy on synthetic set v2.2, as pre-registered in
// research/preregistrations/SIG-46.json. The negative control runs first; nothing else runs unless
// its record is in the output folder and it passed:
//   npx tsx scripts/sig46-run.ts --mode control   derived gross against the next applicant's truth
//   npx tsx scripts/sig46-run.ts --mode primary   end to end: observed net (SIG-16), grossed up
//   npx tsx scripts/sig46-run.ts --mode method    truth net grossed up (reported separately)
// Options: [--out research/runs] [--allow-dirty]. Records are never overwritten. They carry IDs,
// tags and figures only.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GROSSUP_METHOD_VERSION } from "../src/engines/affordability/grossup.js";
import { INCOME_METHOD_VERSION } from "../src/engines/affordability/income.js";
import { loadV22, scoreT2, type Mode } from "../src/research/sig46-grossup.js";
import {
  gitState,
  parseRunArgs,
  provenance,
  requireCleanTree,
  writeNew,
} from "./lib/run-record.js";

const args = parseRunArgs();
const mode = (args.values.mode ?? "") as Mode;
if (!["control", "primary", "method"].includes(mode))
  throw new Error("Usage: --mode control|primary|method [--out folder] [--allow-dirty]");
const git = gitState();
requireCleanTree(git.status, args.allowDirty);

const PREREG = "research/preregistrations/SIG-46.json";
const preregRaw = readFileSync(PREREG);
const date = new Date().toISOString().slice(0, 10);
const suffix = (m: string) => `-synthetic-v2.2-sig46-grossup-${m}.json`;
if (mode !== "control") {
  const files = (() => {
    try {
      return readdirSync(args.out);
    } catch {
      return [];
    }
  })();
  const control = files.find((f) => f.endsWith(suffix("control")));
  if (!control) throw new Error("run the negative control first (--mode control)");
  const rec = JSON.parse(readFileSync(join(args.out, control), "utf8")) as { passed: boolean };
  if (!rec.passed) throw new Error("the negative control failed: no T2 result stands");
}

const set = loadV22();
const result = scoreT2(set, mode);
const share = result.share_within_2pct ?? 0;
const record = {
  ticket: "SIG-46",
  test: "T2",
  mode,
  date,
  ...provenance("scripts/sig46-run.ts", args, git),
  preregistration: { file: PREREG, sha256: createHash("sha256").update(preregRaw).digest("hex") },
  set: { name: "synthetic-v2.2", set_sha256: set.set_sha256, as_of: set.as_of },
  versions: { grossup: GROSSUP_METHOD_VERSION, observed_income: INCOME_METHOD_VERSION },
  ...(mode === "control"
    ? { expected: "share within 2% below 0.50", passed: share < 0.5 }
    : mode === "primary"
      ? { target: "share within 2% at least 0.95", met: share >= 0.95 }
      : { note: "method level, reported separately; near-exact under X-3 by construction" }),
  result,
};
const path = join(args.out, `${date}${suffix(mode)}`);
writeNew(path, `${JSON.stringify(record, null, 2)}\n`);
console.log(
  JSON.stringify({
    path,
    applicants: result.applicants,
    share_within_2pct: result.share_within_2pct,
    median_ape: result.median_ape,
    unverified: result.unverified,
    table: result.table,
  }),
);
