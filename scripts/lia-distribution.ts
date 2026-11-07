// SIG-42: family 3 LIA states across synthetic set v1, by variant tag. A sanity run of the
// apparatus, not an experiment: the scored tests are the scripted cases in test/families/lia/.
// Usage: npx tsx scripts/lia-distribution.ts [--out research/runs] [--allow-dirty]
// Production defaults; a 6-month request for everyone (the D22 default); declarations from the
// application; no assessed surplus (set v1's application carries none), so LIA-01 is at most amber.
import { join } from "node:path";
import { LIA_VERSION, assessLia, type LiaFeed } from "../src/engines/families/lia/index.js";
import { AS_OF_DATE } from "../src/research/generator/index.js";
import { loadSet } from "../src/research/liabilities-score.js";
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
const { manifest, applicants, categories, enrich } = loadSet();

type Raw = {
  account: LiaFeed["accounts"][number]["account"];
  detail?: LiaFeed["accounts"][number]["detail"];
  transactionList: { data: { transactions: LiaFeed["accounts"][number]["transactions"] } };
};
const byTag: Record<
  string,
  { applicants: number; states: Record<string, Record<string, number>> }
> = {};
for (const a of applicants) {
  const feed: LiaFeed = {
    accounts: (a.feed as unknown as { accounts: Raw[] }).accounts.map((x) => ({
      account: x.account,
      ...(x.detail ? { detail: x.detail } : {}),
      transactions: x.transactionList.data.transactions,
    })),
  };
  const app = a.application as unknown as {
    declared_liabilities: { type: string; provider: string }[];
  };
  const r = assessLia({
    feed,
    feed_type: a.truth.feed_type,
    as_of: AS_OF_DATE,
    lookback_months: 6,
    categories,
    application: { declared_liabilities: app.declared_liabilities },
  });
  const row = (byTag[a.truth.tags[0] ?? "salaried-base"] ??= { applicants: 0, states: {} });
  row.applicants++;
  for (const s of r.signals) {
    const counts = (row.states[s.id] ??= {});
    counts[s.state] = (counts[s.state] ?? 0) + 1;
  }
}

const created_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const run_id = `${created_at.slice(0, 10)}-${manifest.set}-lia-family-v${LIA_VERSION}`;
const record = {
  run_id,
  created_at,
  ticket: "SIG-42",
  ...provenance("scripts/lia-distribution.ts", args, git),
  dataset: { set: manifest.set, seed: manifest.seed, set_sha256: manifest.set_sha256 },
  engine: { name: "lia-family", version: LIA_VERSION, commit: git.commit },
  categoriser: { ...enrich, source: "research/enrich/synthetic-v1-categories.json" },
  input: {
    as_of: AS_OF_DATE,
    lookback_months: 6,
    application: "declared liabilities from set v1; no assessed surplus",
  },
  by_tag: byTag,
};
writeNew(join(args.out, `${run_id}.json`), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ run_id, tags: Object.keys(byTag) }));
