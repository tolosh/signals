// SIG-74 T3: what must stay byte-identical. Over sets v1 and v2.2, two hashes per engine (LIA, INC,
// observed income): the skeleton (every text and version field out: states, values, counts,
// figures) and the text (version fields out only), since the sets hold no invisible characters and
// so no displayed text may change there either. Over the all-positions corpus, the skeleton only:
// there, the displayed text is what SIG-74 changes.
import { createHash } from "node:crypto";
import { deriveIncome } from "../../../src/engines/affordability/income.js";
import { assessInc } from "../../../src/engines/families/inc/index.js";
import { assessLia } from "../../../src/engines/families/lia/index.js";
import { loadReplaySet, skeleton, type ReplaySet } from "../sig64/replay.js";
import { applicantFor, KEYWORDS, SPLITTERS } from "./corpus.js";

export const BASELINE_74 = "test/fixtures/sig74-baseline.json";

/** An output with only its version fields taken out, as one JSON line. */
export const textOf = (x: unknown): string =>
  JSON.stringify(x, (k, v: unknown) => (k.endsWith("version") ? undefined : v));

const sha = () => createHash("sha256");

export function setHashes(name: ReplaySet["name"]) {
  const s = loadReplaySet(name);
  const h = {
    lia: sha(),
    inc: sha(),
    income: sha(),
    lia_text: sha(),
    inc_text: sha(),
    income_text: sha(),
  };
  for (const a of s.applicants) {
    const lia = assessLia({
      feed: a.feed as never,
      feed_type: a.feed_type,
      as_of: s.as_of,
      lookback_months: 6,
      categories: s.categories,
      application: { declared_liabilities: a.application.declared_liabilities ?? [] },
      // SIG-83 (LIA 1.4.0): this baseline checks display changes against LIA 1.3.6's matching, so it runs step (d) off.
      config: { category_independent: false },
    });
    const inc = assessInc({
      feed: a.feed,
      feed_type: a.feed_type,
      as_of: s.as_of,
      lookback_months: 6,
      application: a.application as never,
      categories: s.categories,
    });
    const income = deriveIncome({
      feed: a.feed as never,
      as_of: s.as_of,
      lookback_months: 6,
      min_occurrences: 3,
      categories: s.categories,
    });
    h.lia.update(skeleton(lia)).update("\n");
    h.inc.update(skeleton(inc)).update("\n");
    h.income.update(skeleton(income)).update("\n");
    h.lia_text.update(textOf(lia)).update("\n");
    h.inc_text.update(textOf(inc)).update("\n");
    h.income_text.update(textOf(income)).update("\n");
  }
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v.digest("hex")]));
}

/** The corpus's skeleton hashes, over every keyword, every splitter and the plain controls. */
export function corpusHashes() {
  const h = { lia: sha(), inc: sha(), income: sha(), expenses: sha() };
  let count = 0;
  for (const k of KEYWORDS)
    for (const c of [null, ...SPLITTERS.map(([, ch]) => ch)]) {
      const r = applicantFor(k, c);
      h.lia.update(skeleton(r.lia)).update("\n");
      h.inc.update(skeleton(r.inc)).update("\n");
      h.income.update(skeleton(r.income)).update("\n");
      h.expenses.update(skeleton(r.expenses)).update("\n");
      count++;
    }
  return { count, ...Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v.digest("hex")])) };
}
