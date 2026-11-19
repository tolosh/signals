// SIG-63 T7: the adversarial leakage test with the structure family, as registered in
// research/preregistrations/SIG-63.json, written as a run record. Negative controls first, in
// order; nothing later runs unless every earlier control's record is in the output folder and it
// was caught on every listed channel:
//   npx tsx scripts/sig63-leakage.ts --set v2     control: SIG-60's 10 channels
//   npx tsx scripts/sig63-leakage.ts --set v2.1   control: SIG-60's 17 channels
//   npx tsx scripts/sig63-leakage.ts --set v2.2   control: D-L4-1a to D-L4-1d
//   npx tsx scripts/sig63-leakage.ts --set v2.3   the set under test, run once
// Options: [--out research/runs] [--allow-dirty]. A record is never overwritten, and set v2.3 is
// refused if a record for it already exists in the output folder.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runSig63, verdictSig63, type Sig63Set } from "../src/research/leakage/sig63.js";
import {
  gitState,
  parseRunArgs,
  provenance,
  requireCleanTree,
  writeNew,
} from "./lib/run-record.js";

const ORDER: Sig63Set[] = ["v2", "v2.1", "v2.2", "v2.3"];
const args = parseRunArgs();
const set = (args.values.set ?? "") as Sig63Set;
if (!ORDER.includes(set)) throw new Error("--set must be v2, v2.1, v2.2 or v2.3");
const git = gitState();
requireCleanTree(git.status, args.allowDirty);

const suffix = (s: Sig63Set) => `-sig63-leakage-${s}.json`;
const files = (() => {
  try {
    return readdirSync(args.out);
  } catch {
    return [];
  }
})();
for (const earlier of ORDER.slice(0, ORDER.indexOf(set))) {
  const f = files.find((x) => x.endsWith(suffix(earlier)));
  if (!f) throw new Error(`run the negative control ${earlier} first`);
  const rec = JSON.parse(readFileSync(join(args.out, f), "utf8")) as { verdict: string };
  if (!rec.verdict.startsWith("PASS"))
    throw new Error(`control ${earlier} failed (${rec.verdict}): no later result stands`);
}
if (set === "v2.3" && files.some((x) => x.endsWith(suffix("v2.3"))))
  throw new Error(
    "set v2.3 has been run: it runs once (a re-run is a new set and pre-registration)",
  );

const result = runSig63(set);
const v = verdictSig63(result);
const control = set !== "v2.3";
const record = {
  ticket: "SIG-63",
  test: "T7 adversarial leakage test with the structure family",
  role: control ? "negative control" : "set under test",
  verdict: v.pass
    ? control
      ? "PASS: caught on every channel listed for it"
      : "PASS: every label within margin; every validity check passes"
    : `FAILS: ${v.failing.join("; ")}`,
  ...result,
  generated_by: provenance("scripts/sig63-leakage.ts", args, git),
};
const date = new Date().toISOString().slice(0, 10);
const path = join(args.out, `${date}${suffix(set)}`);
writeNew(path, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ path, verdict: record.verdict }));
