// SIG-17, exploratory and NOT pre-registered (SIG-56 item 5): reproduces the 96.9% figure, with
// BPAY bills that the categoriser called "transfer" counted as committed. Writes a new record;
// it changes no SIG-17 record. The method is in src/research/sig17-bpay-exploratory.ts.
// Usage: npx tsx scripts/sig17-bpay-exploratory.ts [--manifest <path>] [--out research/runs] [--allow-dirty]
import { join } from "node:path";
import { BPAY_EXPLORATORY, bpayBillsAsCommitted } from "../src/research/sig17-bpay-exploratory.js";
import {
  DEFAULT_MANIFEST,
  gitState,
  parseRunArgs,
  provenance,
  requireCleanTree,
  writeNew,
} from "./lib/run-record.js";

const args = parseRunArgs();
const git = gitState();
requireCleanTree(git.status, args.allowDirty);
const result = bpayBillsAsCommitted(args.values.manifest ?? DEFAULT_MANIFEST);
const created_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const run_id = `${created_at.slice(0, 10)}-${result.set}-sig17-bpay-bills-as-committed-exploratory`;
const record = {
  run_id,
  created_at,
  ticket: "SIG-17",
  status: "exploratory, not pre-registered; reproduces a figure, not a result (SIG-56)",
  ...provenance("scripts/sig17-bpay-exploratory.ts", args, git),
  dataset: { set: result.set, seed: result.seed, set_sha256: result.set_sha256 },
  method: {
    ...BPAY_EXPLORATORY,
    population: "fully covered (no unshared account), 3 months of history or more",
    change_from_primary:
      "debits categorised 'transfer' whose narrative starts 'BPAY ' and is not a credit-card payment are counted as committed bills",
  },
  result: {
    applicants: result.applicants,
    within_15_pct: result.within,
    share: Math.round(result.share * 10000) / 10000,
    recategorised_debits: result.recategorised_debits,
  },
};
writeNew(join(args.out, `${run_id}.json`), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ run_id, ...record.result }));
