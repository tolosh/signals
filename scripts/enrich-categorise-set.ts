// SIG-17: categorise every debit in a synthetic set once with Moroku Enrich's local engine, and
// store the categories keyed by transaction id, so the expense tests run in CI without Enrich.
// No dictionary, overrides or LLM cache are loaded, as in SIG-12 T3. Synthetic data only.
// Usage: npx tsx scripts/enrich-categorise-set.ts --engine <moroku-enrich/packages/engine/dist/index.js>
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { generateApplicant, population, serialise } from "../src/research/generator/index.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const enginePath = arg("engine");
if (!enginePath) throw new Error("--engine is required");
const manifest = JSON.parse(
  readFileSync("research/datasets/synthetic-v1.manifest.json", "utf8"),
) as { set: string; seed: number; set_sha256: string };

type Result = { source: string; category: string; confidence: number };
type EnrichEngine = {
  categorise(input: Record<string, unknown>, lookups: Record<string, () => undefined>): Result;
  ENGINE_VERSION: string;
  TAXONOMY_VERSION: string;
};
const engine = (await import(pathToFileURL(enginePath).href)) as EnrichEngine;
const none = () => undefined;
const lookups = { userOverride: none, tenantOverride: none, dictionary: none, llmCache: none };

const hash = createHash("sha256");
const categories: Record<string, string> = {};
const bySource: Record<string, number> = {};
for (const spec of population(manifest.seed)) {
  const a = generateApplicant(spec, manifest.seed);
  hash.update(serialise(a)).update("\n");
  for (const acc of a.feed.accounts)
    for (const t of acc.transactions) {
      if (Number(t.amount) >= 0) continue;
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
      categories[t.transactionId] = r.category;
      bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    }
}
const setSha = hash.digest("hex");
if (setSha !== manifest.set_sha256)
  throw new Error(`set hash ${setSha} does not match the manifest`);

mkdirSync("research/enrich", { recursive: true });
const out = {
  set: manifest.set,
  set_sha256: setSha,
  enrich: { engine_version: engine.ENGINE_VERSION, taxonomy_version: engine.TAXONOMY_VERSION },
  lookups_loaded: "none (no dictionary, overrides or LLM cache)",
  debits: Object.keys(categories).length,
  by_source: bySource,
  categories,
};
writeFileSync(`research/enrich/${manifest.set}-categories.json`, `${JSON.stringify(out)}\n`);
console.log(JSON.stringify({ debits: out.debits, enrich: out.enrich, by_source: bySource }));
