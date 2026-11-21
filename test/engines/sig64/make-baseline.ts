// SIG-64: takes the T5 and replay baseline, once, before any SIG-64 change to src/ (LIA 1.3.4,
// INC 1.2.2, observed income 1.0.1, LENDER_NAMES 1.1.0), and writes test/fixtures/
// sig64-baseline.json. Run from the repository root on a clean tree:
//   npx tsx test/engines/sig64/make-baseline.ts
// It refuses to overwrite the committed file: the baseline is taken once.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { probeCorpus } from "./probes.js";
import { BASELINE, loadReplaySet, replay, skeleton } from "./replay.js";

if (existsSync(BASELINE)) throw new Error(`${BASELINE} exists: the baseline is taken once`);
const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" }).trim();
if (git("status", "--porcelain", "--", "src") !== "")
  throw new Error("src/ has uncommitted changes: the baseline must be taken on committed code");

const probes = probeCorpus();
const hash = (xs: unknown[]) => {
  const h = createHash("sha256");
  for (const x of xs) h.update(skeleton(x)).update("\n");
  return h.digest("hex");
};
const record = {
  ticket: "SIG-64",
  purpose:
    "T5 and the observed-income replay (ruling 40524, 1): skeleton hashes (every text and version field taken out) before any SIG-64 change",
  commit: git("rev-parse", "HEAD"),
  sets: {
    "synthetic-v1": replay(loadReplaySet("synthetic-v1")),
    "synthetic-v2.2": replay(loadReplaySet("synthetic-v2.2")),
  },
  probes: {
    count: probes.length,
    lia: hash(probes.map((p) => p.lia)),
    inc: hash(probes.map((p) => p.inc)),
    income: hash(probes.map((p) => p.income)),
    expenses: hash(probes.map((p) => p.expenses)),
  },
};
writeFileSync(BASELINE, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ path: BASELINE, commit: record.commit }));
