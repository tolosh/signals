// SIG-54 T7: categorise a seeded sample of 50 BPAY and 50 statement-feed transactions from set v2
// with Moroku Enrich's local engine (D27 allows the local engine with its version recorded), and
// record the share handled by the deterministic tiers and how many BPAY payments Enrich called a
// transfer, split by the truth's label (a bill, or a card repayment, which is the control).
// No dictionary, overrides or LLM cache are loaded, as in SIG-12 T3. Synthetic data only.
// Usage: npx tsx scripts/enrich-sample-v2.ts --engine <moroku-enrich/packages/engine/dist/index.js>
//        [--out research/runs] [--allow-dirty]
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { stream } from "../src/research/generator/rng.js";
import { generateApplicant, populationV2 } from "../src/research/generator/index.js";
import {
  gitState,
  manifestSeed,
  parseRunArgs,
  provenance,
  requireCleanTree,
  writeNew,
} from "./lib/run-record.js";

const MANIFEST = "research/datasets/synthetic-v2.manifest.json";
const args = parseRunArgs();
const git = gitState();
requireCleanTree(git.status, args.allowDirty);
const enginePath = args.values.engine;
if (!enginePath) throw new Error("--engine is required");
const { seed } = manifestSeed(MANIFEST);
const out = join(args.out, `${new Date().toISOString().slice(0, 10)}-sig54-t7-enrich-sample.json`);

type Result = { source: string; category: string; confidence: number };
type Engine = {
  categorise(input: Record<string, unknown>, lookups: Record<string, () => undefined>): Result;
  ENGINE_VERSION: string;
  TAXONOMY_VERSION: string;
};
const engine = (await import(pathToFileURL(enginePath).href)) as Engine;
const none = () => undefined;
const lookups = { userOverride: none, tenantOverride: none, dictionary: none, llmCache: none };

const applicants = populationV2(seed).map((spec) => generateApplicant(spec, seed));
type Tx = (typeof applicants)[number]["feed"]["accounts"][number]["transactions"][number];
const labels = new Map(
  applicants.flatMap((a) => (a.truth.v2?.bpay ?? []).map((b) => [b.transaction_id, b] as const)),
);
const bpayPool = applicants.flatMap((a) =>
  a.feed.accounts.flatMap((acc) => acc.transactions.filter((t) => labels.has(t.transactionId))),
);
const statementPool = applicants
  .filter((a) => a.truth.feed_type === "uploaded_statement")
  .flatMap((a) => a.feed.accounts.flatMap((acc) => acc.transactions));
const sample = (pool: Tx[], key: string) => {
  const rng = stream(seed, key);
  const left = [...pool];
  return Array.from({ length: 50 }, () => {
    const [picked] = left.splice(rng.int(0, left.length - 1), 1);
    if (!picked) throw new Error("sample larger than the pool");
    return picked;
  });
};
const categorise = (t: Tx) =>
  engine.categorise(
    {
      description: t.description,
      amount: Number(t.amount),
      mcc: t.merchantCategoryCode,
      merchant_name: t.merchantName,
      biller_code: t.billerCode,
      biller_name: t.billerName,
      reference: t.reference,
    },
    lookups,
  );
const summarise = (txs: Tx[]) => {
  const rows = txs.map((t) => {
    const r = categorise(t);
    const label = labels.get(t.transactionId);
    return {
      transaction_id: t.transactionId,
      description: t.description,
      amount: t.amount,
      source: r.source,
      category: r.category,
      ...(label ? { label: label.kind, true_item: label.item } : {}),
    };
  });
  const by_source: Record<string, number> = {};
  for (const r of rows) by_source[r.source] = (by_source[r.source] ?? 0) + 1;
  const deterministic_share = (rows.length - (by_source.fallback ?? 0)) / rows.length;
  return {
    sample_sha256: createHash("sha256").update(JSON.stringify(txs)).digest("hex"),
    by_source,
    deterministic_share,
    flag_below_80_percent: deterministic_share < 0.8,
    rows,
  };
};

const bpay = summarise(sample(bpayPool, "sig54-t7-bpay"));
const statement = summarise(sample(statementPool, "sig54-t7-statement"));
const transfer = (kind: string) =>
  bpay.rows.filter((r) => "label" in r && r.label === kind && /transfer/i.test(r.category)).length;
const ofKind = (kind: string) => bpay.rows.filter((r) => "label" in r && r.label === kind).length;

const record = {
  ticket: "SIG-54",
  test: "T7",
  ...provenance("scripts/enrich-sample-v2.ts", args, git),
  seed,
  manifest: MANIFEST,
  enrich: { engine_version: engine.ENGINE_VERSION, taxonomy_version: engine.TAXONOMY_VERSION },
  lookups_loaded: "none (no dictionary, overrides or LLM cache)",
  pools: { bpay: bpayPool.length, statement: statementPool.length },
  bpay_as_transfer: {
    bills: { sampled: ofKind("bill"), categorised_as_transfer: transfer("bill") },
    card_repayments_control: {
      sampled: ofKind("card_repayment"),
      categorised_as_transfer: transfer("card_repayment"),
    },
  },
  bpay,
  statement,
};
writeNew(out, `${JSON.stringify(record, null, 2)}\n`);
console.log(
  JSON.stringify({
    out,
    bpay: { by_source: bpay.by_source, deterministic_share: bpay.deterministic_share },
    statement: {
      by_source: statement.by_source,
      deterministic_share: statement.deterministic_share,
    },
    bpay_as_transfer: record.bpay_as_transfer,
  }),
);
