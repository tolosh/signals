// SIG-74: takes the T3 baseline, once, before any SIG-74 change to src/ (LIA 1.3.5, INC 1.2.3,
// observed income 1.0.2, keyword list 1.0.0), and writes test/fixtures/sig74-baseline.json. Run from
// the repository root on a clean tree:
//   npx tsx test/engines/sig74/make-baseline.ts
// It refuses to overwrite the committed file: the baseline is taken once.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { BASELINE_74, corpusHashes, setHashes } from "./hashes.js";

if (existsSync(BASELINE_74)) throw new Error(`${BASELINE_74} exists: the baseline is taken once`);
const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" }).trim();
if (git("status", "--porcelain", "--", "src") !== "")
  throw new Error("src/ has uncommitted changes: the baseline must be taken on committed code");

const record = {
  ticket: "SIG-74",
  purpose:
    "T3: skeleton hashes (text and version fields out) and text hashes (version fields out) before any SIG-74 change",
  commit: git("rev-parse", "HEAD"),
  sets: {
    "synthetic-v1": setHashes("synthetic-v1"),
    "synthetic-v2.2": setHashes("synthetic-v2.2"),
  },
  corpus: corpusHashes(),
};
writeFileSync(BASELINE_74, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ path: BASELINE_74, commit: record.commit }));
