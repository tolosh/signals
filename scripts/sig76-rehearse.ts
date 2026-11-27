// SIG-76: an in-process rehearsal of the acceptance's T3 comparison. It is engineering-
// commissioned and is not the acceptance. It builds each scenario's feed in its seeded order, runs
// assessApplicant (C first, then A, B, D and D2), and compares each output byte for byte with the
// frozen expected states (SIG-76 40801). Then a negative check: every account's lines reversed
// must fail the comparison (review 21, H10). It exits non-zero unless the seeded run matches
// everywhere and the shuffled run matches nowhere. Writes research/runs/sig76-rehearsal.json,
// never overwriting it.
//   npx tsx scripts/sig76-rehearse.ts [--out <folder>] [--allow-dirty]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { generateSetV23 } from "../src/research/generator/v23/index.js";
import { serialise } from "../src/research/generator/index.js";
import { rehearse } from "../src/research/sig76/rehearse.js";
import {
  gitState,
  manifestSeed,
  parseRunArgs,
  provenance,
  requireCleanTree,
  writeNew,
} from "./lib/run-record.js";

const args = parseRunArgs(process.argv.slice(2));
const git = gitState();
requireCleanTree(git.status, args.allowDirty);
const PREREG = "research/preregistrations/SIG-76.json";
const FROZEN = "research/preregistrations/SIG-76-expected-states.json";
const prereg = JSON.parse(readFileSync(PREREG, "utf8"));
const frozenBytes = readFileSync(FROZEN);
const frozen = JSON.parse(frozenBytes.toString("utf8"));
const manifest = manifestSeed("research/datasets/synthetic-v2.3.manifest.json");
if (manifest.seed !== prereg.data.seed || manifest.set_sha256 !== prereg.data.set_sha256)
  throw new Error("the pre-registration's set isn't the manifest's set v2.3");
const set = generateSetV23(manifest.seed);
const h = createHash("sha256");
for (const a of set) h.update(serialise(a as never)).update("\n");
if (h.digest("hex") !== manifest.set_sha256)
  throw new Error("set v2.3 doesn't regenerate to its manifest hash");

const seeded = await rehearse(set, prereg, frozen, { order: "seeded" });
const shuffled = await rehearse(set, prereg, frozen, { order: "shuffled" });
const passed = seeded.all_match && Object.values(shuffled.scenarios).every((s) => !s.matches);
const record = {
  ticket: "SIG-76",
  kind: "rehearsal: in process, engineering-commissioned; not the acceptance",
  frozen_expected_states: {
    file: FROZEN,
    file_sha256: createHash("sha256").update(frozenBytes).digest("hex"),
  },
  set: "synthetic-v2.3",
  set_sha256: manifest.set_sha256,
  seeded,
  shuffled_negative_check: {
    change: "every account's lines reversed; nothing else changed",
    ...shuffled,
  },
  passed,
  ...provenance("scripts/sig76-rehearse.ts", args, git),
};
writeNew(`${args.out}/sig76-rehearsal.json`, `${JSON.stringify(record, null, 2)}\n`);
console.log(
  JSON.stringify({
    passed,
    seeded: Object.fromEntries(Object.entries(seeded.scenarios).map(([k, v]) => [k, v.matches])),
    shuffled: Object.fromEntries(
      Object.entries(shuffled.scenarios).map(([k, v]) => [k, v.matches]),
    ),
  }),
);
if (!passed) process.exitCode = 1;
