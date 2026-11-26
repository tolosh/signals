// SIG-70: an assessment is replayed from its stored Enrich record, never by calling Enrich again.
// The engines read only the category by transaction id (D3); an id the taxonomy doesn't know is
// kept as returned, and the engines treat it as unmapped.
import type { EnrichRecord } from "./types.js";

/** The category by transaction id, from a stored record (as stored, or parsed from JSON). */
export function categoriesFrom(record: unknown): Record<string, string> {
  const results = (record as Partial<EnrichRecord> | null)?.response?.results;
  if (!Array.isArray(results)) throw new Error("not an Enrich record: no response results");
  const out: Record<string, string> = {};
  for (const r of results) {
    if (typeof r?.transaction_id !== "string" || typeof r.category !== "string")
      throw new Error("not an Enrich record: a result has no transaction id or category");
    out[r.transaction_id] = r.category;
  }
  return out;
}
