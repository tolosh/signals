// SIG-70: LocalEnrich, the pinned local Enrich engine (D42's local path and fallback). It calls
// the engine exactly as scripts/enrich-categorise-set.ts does (SIG-17): one transaction at a time,
// with the four lookups stubbed, so no dictionary, user or tenant overrides, or LLM cache is used
// (the lookups asymmetry, ADR 0011). The engine module is passed in: Signals packages a pinned
// build by commit and hash (ruling 40719, 2), once the Enrich side publishes it; it is never
// imported from a sibling checkout at runtime.
import type { Categoriser, EngineBuild, EnrichResponse, EnrichTx, Taxonomy } from "./types.js";

/** The parts of @moroku-enrich/engine (with its taxonomy) that LocalEnrich uses. */
export type EngineModule = {
  ENGINE_VERSION: string;
  TAXONOMY_VERSION: string;
  categorise(
    input: Record<string, unknown>,
    lookups: Record<string, () => undefined>,
  ): Record<string, unknown>;
  /** The taxonomy document, when the packaged build exports it. */
  taxonomyDocument?: () => Taxonomy;
};

const none = () => undefined;
/** No dictionary, no overrides, no LLM cache: as the research scripts run the engine. */
const LOOKUPS = { userOverride: none, tenantOverride: none, dictionary: none, llmCache: none };

export function makeLocalEnrich(engine: EngineModule, build: EngineBuild | null): Categoriser {
  return {
    path: "local",
    build,
    async categorise(txs: readonly EnrichTx[]): Promise<EnrichResponse> {
      return {
        engine_version: engine.ENGINE_VERSION,
        taxonomy_version: engine.TAXONOMY_VERSION,
        results: txs.map((t) => {
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
            LOOKUPS,
          );
          return { transaction_id: t.transactionId, ...r, category: String(r.category) };
        }),
      };
    },
    async taxonomy(): Promise<Taxonomy> {
      return engine.taxonomyDocument?.() ?? { version: engine.TAXONOMY_VERSION };
    },
  };
}
