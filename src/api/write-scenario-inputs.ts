// SIG-82 candidate 1: writes SIG-76's five scenario inputs for the demo Lambda's asset.
//   node --import tsx src/api/write-scenario-inputs.ts <out file>
import { writeFileSync } from "node:fs";
import { buildScenarioInputs } from "./scenario-inputs.js";

const out = process.argv[2];
if (!out) throw new Error("usage: write-scenario-inputs.ts <out file>");
writeFileSync(out, JSON.stringify(buildScenarioInputs()));
