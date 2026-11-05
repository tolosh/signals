// SIG-12 T3: categorise a seeded sample of 50 synthetic transactions with Enrich's engine and record
// the share handled by the deterministic tiers (not the fallback). This runs the engine package
// directly, with no dictionary, overrides or LLM cache loaded, so it measures the rules, MCC,
// exclusion, income and high-risk tiers only.
// Usage: npx tsx scripts/enrich-sample.ts --engine <path to moroku-enrich/packages/engine/dist/index.js>
//        [--seed 42] [--out research/runs/<file>.json]
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { stream } from "../src/research/generator/rng.js";
import { generateApplicant, population } from "../src/research/generator/index.js";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const enginePath = arg("engine");
if (!enginePath) throw new Error("--engine is required");
const seed = Number(arg("seed", "42"));
const out = arg("out", "research/runs/sig12-t3-enrich-sample.json") ?? "";

type Result = { source: string; category: string; confidence: number };
type Engine = {
  categorise(input: Record<string, unknown>, lookups: Record<string, () => undefined>): Result;
  ENGINE_VERSION: string;
  TAXONOMY_VERSION: string;
};
const engine = (await import(pathToFileURL(enginePath).href)) as Engine;
const none = () => undefined;
const lookups = { userOverride: none, tenantOverride: none, dictionary: none, llmCache: none };

// Every transaction in the set, then a seeded sample of 50 without replacement.
const all = population(seed).flatMap((spec) =>
  generateApplicant(spec, seed).feed.accounts.flatMap((a) => a.transactions),
);
const rng = stream(seed, "sig12-t3-sample");
const pool = [...all];
const sample = Array.from({ length: 50 }, () => pool.splice(rng.int(0, pool.length - 1), 1)[0]!);

const rows = sample.map((t) => {
  const r = engine.categorise(
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
  return { description: t.description, amount: t.amount, source: r.source, category: r.category };
});

const bySource: Record<string, number> = {};
for (const row of rows) bySource[row.source] = (bySource[row.source] ?? 0) + 1;
const fallback = bySource.fallback ?? 0;
const deterministicShare = (rows.length - fallback) / rows.length;

const record = {
  ticket: "SIG-12",
  test: "T3",
  seed,
  sample_size: rows.length,
  population_transactions: all.length,
  sample_sha256: createHash("sha256").update(JSON.stringify(sample)).digest("hex"),
  enrich: { engine_version: engine.ENGINE_VERSION, taxonomy_version: engine.TAXONOMY_VERSION },
  lookups_loaded: "none (no dictionary, overrides or LLM cache)",
  by_source: bySource,
  deterministic_share: deterministicShare,
  flag_below_80_percent: deterministicShare < 0.8,
  fallbacks: rows.filter((r) => r.source === "fallback"),
  rows,
};
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ out, by_source: bySource, deterministic_share: deterministicShare }));
