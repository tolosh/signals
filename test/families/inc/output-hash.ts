// SIG-41 ruling 4 (ADR 0004): N-13 moves from the INC family into the evidence-quality layer
// (EQ-R4), and INC's output must be byte-identical before and after. These hashes cover the
// whole INC result (signals, income, trace) for every set v1 applicant, at both lookbacks the
// SIG-41 records use, and for the mock's asm_income.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Feed } from "../../../src/engines/evidence/index.js";
import { assessInc } from "../../../src/engines/families/inc/index.js";
import { incResult } from "../../../src/mock/inc.js";
import {
  AS_OF_DATE,
  generateApplicant,
  population,
} from "../../../src/research/generator/index.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** One sha256 over the INC result of every set v1 applicant, one JSON line each. */
export function setV1Hash(lookback: "history" | 6): string {
  const { seed } = JSON.parse(
    readFileSync("research/datasets/synthetic-v1.manifest.json", "utf8"),
  ) as { seed: number };
  const hash = createHash("sha256");
  for (const spec of population(seed)) {
    const a = generateApplicant(spec, seed);
    const r = assessInc({
      feed: a.feed as unknown as Feed,
      feed_type: a.truth.feed_type,
      as_of: AS_OF_DATE,
      lookback_months: lookback === 6 ? 6 : Math.max(3, a.truth.history.months),
    });
    hash.update(JSON.stringify(r)).update("\n");
  }
  return hash.digest("hex");
}

export const asmIncomeHash = () => sha(JSON.stringify(incResult()));
