// SIG-70: path selection and the fallback (D42). An active Enrich tenant uses the API; a pending
// tenant, none, or a failed call uses the pinned local engine, and the fallback is recorded, never
// silent. Synthetic data never goes to the live API (D42): a synthetic feed is categorised locally
// and the refusal recorded. For the 1 December demo every assessment is forced local (D58).
// Nothing here logs: a transaction's description never reaches a log.
import type {
  Categoriser,
  EnrichPath,
  EnrichRecord,
  EnrichResponse,
  EnrichTx,
  FallbackReason,
  TenantStatus,
  Taxonomy,
} from "./types.js";

/** The path a tenant's status calls for. */
export const selectPath = (status: TenantStatus): "api" | "local" =>
  status === "active" ? "api" : "local";

/** How long an API call may take before the local engine is used instead. */
export const DEFAULT_TIMEOUT_MS = 10_000;

class Timeout extends Error {}

/** The fallback reason for a failed API call. */
function reasonOf(e: unknown): FallbackReason {
  if (e instanceof Timeout) return "timeout";
  const status = (e as { status?: unknown } | null)?.status;
  if (status === 429) return "rate_limited";
  if (typeof status === "number" && status >= 500) return "server_error";
  return "error";
}

async function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Timeout()), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type CategoriseRequest = {
  tenant: { status: TenantStatus };
  txs: readonly EnrichTx[];
  local: Categoriser;
  /** ApiEnrich under the lender's tenant; null until SIG-72 provides the credential. */
  api: Categoriser | null;
  /** True for any synthetic feed: it never goes to the API (D42). */
  synthetic: boolean;
  /** The demo's local-only rule (D58). */
  forceLocal?: boolean;
  timeoutMs?: number;
};

const recordOf = (
  path: EnrichPath,
  by: Categoriser,
  response: EnrichResponse,
  taxonomy: Taxonomy,
  txs: number,
  extra: Partial<EnrichRecord> = {},
): EnrichRecord => ({
  path,
  engine_version: response.engine_version,
  taxonomy_version: taxonomy.taxonomy_version,
  taxonomy,
  build: by.path === "local" ? (by.build ?? null) : null,
  ...extra,
  transactions: txs,
  response,
});

/** Categorise one assessment's transactions on the path D42 calls for, and record it. */
export async function categoriseForAssessment(r: CategoriseRequest): Promise<EnrichRecord> {
  const local = async (path: EnrichPath, extra: Partial<EnrichRecord> = {}) => {
    const [response, taxonomy] = await Promise.all([r.local.categorise(r.txs), r.local.taxonomy()]);
    return recordOf(path, r.local, response, taxonomy, r.txs.length, extra);
  };
  const wanted = r.forceLocal ? "local" : selectPath(r.tenant.status);
  if (wanted === "local") return local("local");
  if (r.synthetic) return local("local", { api_refused: "synthetic" });
  if (!r.api) return local("api_fallback_local", { fallback: { reason: "unavailable" } });
  const ms = r.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const [response, taxonomy] = await within(
      Promise.all([r.api.categorise(r.txs), r.api.taxonomy()]),
      ms,
    );
    return recordOf("api", r.api, response, taxonomy, r.txs.length);
  } catch (e) {
    return local("api_fallback_local", { fallback: { reason: reasonOf(e) } });
  }
}
