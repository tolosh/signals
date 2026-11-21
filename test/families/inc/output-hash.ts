// SIG-41 ruling 4 (ADR 0004): N-13 moves from the INC family into the evidence-quality layer
// (EQ-R4), and INC's output must be byte-identical before and after. These hashes cover the
// whole INC result (signals, income, trace) for every set v1 applicant, at both lookbacks the
// SIG-41 records use, and for the mock's asm_income.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { deriveIncomeByPayerKey, displayPayer } from "../../../src/engines/affordability/income.js";
import type { Feed } from "../../../src/engines/evidence/index.js";
import { assessInc } from "../../../src/engines/families/inc/index.js";
import { incResult } from "../../../src/mock/inc.js";
import {
  AS_OF_DATE,
  generateApplicant,
  population,
} from "../../../src/research/generator/index.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * INC 1.2.2 (SIG-42 re-review direction 8) changed only its version and added the GR-3 gate's
 * version; both are set back to 1.2.1's form here, so the hashes below still prove every other
 * byte of the output is unchanged.
 */
const as121 = (r: ReturnType<typeof assessInc>) => {
  const rest: Partial<typeof r> = { ...r };
  delete rest.gr3_gate_version;
  // INC 1.2.3 (SIG-64) records the keyword list's version too; set back in the same way.
  delete rest.keyword_list_version;
  return { ...rest, version: "1.2.1" };
};

/**
 * INC 1.2.3 (SIG-64, ruling 40524) shows each payer masked (set v1: "SALARY NORTHSIDE HEALTH"
 * shows "SALARY NORTHSIDE [withheld]"). Each payer shown is put back to the unmasked payer its
 * stream is keyed by (INC's streams: 12 months, at least 3 credits), so the hashes below, taken
 * before SIG-64, prove that only the payer text changed.
 */
function unmasked(json: string, feed: Feed): string {
  const keyed = deriveIncomeByPayerKey({
    feed: feed as never,
    as_of: AS_OF_DATE,
    lookback_months: 12,
    min_occurrences: 3,
  });
  let out = json;
  for (const s of keyed.streams) {
    const shown = displayPayer(s.narrative);
    if (shown !== s.payer) out = out.split(JSON.stringify(shown).slice(1, -1)).join(s.payer);
  }
  return out;
}

/**
 * One sha256 over the INC result of every set v1 applicant, one JSON line each. SIG-42 ruling 3
 * (10 November 2026): the versions each result carried are returned too, for the test to pin.
 */
export function setV1Hash(lookback: "history" | 6): { hash: string; versions: string[] } {
  const { seed } = JSON.parse(
    readFileSync("research/datasets/synthetic-v1.manifest.json", "utf8"),
  ) as { seed: number };
  const hash = createHash("sha256");
  const versions = new Set<string>();
  for (const spec of population(seed)) {
    const a = generateApplicant(spec, seed);
    const r = assessInc({
      feed: a.feed as unknown as Feed,
      feed_type: a.truth.feed_type,
      as_of: AS_OF_DATE,
      lookback_months: lookback === 6 ? 6 : Math.max(3, a.truth.history.months),
    });
    versions.add(`${r.version}|${r.gr3_gate_version}`);
    hash.update(unmasked(JSON.stringify(as121(r)), a.feed as unknown as Feed)).update("\n");
  }
  return { hash: hash.digest("hex"), versions: [...versions] };
}

export const asmIncomeHash = () => sha(JSON.stringify(as121(incResult())));
