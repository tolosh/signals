// SIG-64 T5 and the observed-income replay (ruling 40524, 1): every engine that shows text runs
// over set v1 and set v2.2, and its output is reduced to a skeleton, with every text field taken
// out (reasons, review reasons, resolve-with lists, lender and payer names) and the version
// fields too. The skeleton is what must stay byte-identical: states, values, figures, counts,
// evidence. The baseline (test/fixtures/sig64-baseline.json) was taken by make-baseline.ts at
// a763b95, before any SIG-64 change: LIA 1.3.4, INC 1.2.2, observed income 1.0.1.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { deriveIncome } from "../../../src/engines/affordability/income.js";
import type { Feed } from "../../../src/engines/evidence/index.js";
import { assessInc } from "../../../src/engines/families/inc/index.js";
import { assessLia, type LiaApplication } from "../../../src/engines/families/lia/index.js";
import {
  AS_OF_DATE,
  generateApplicant,
  population,
} from "../../../src/research/generator/index.js";
import { generateSetV22 } from "../../../src/research/generator/v22/index.js";
import type { FeedType } from "../../../src/engines/signals/definitions.js";

export const BASELINE = "test/fixtures/sig64-baseline.json";

/** Text fields and version fields: everything a skeleton leaves out. */
const LEFT_OUT = new Set([
  "reason",
  "review_reason",
  "resolve_with",
  "provider",
  "payer",
  "version",
  "lender_names_version",
  "keyword_list_version",
]);
/** An output with every text and version field taken out, as one JSON line. */
export const skeleton = (x: unknown): string =>
  JSON.stringify(x, (k, v: unknown) => (LEFT_OUT.has(k) ? undefined : v));

type RawAccount = {
  account: { accountId: string; productCategory?: string; productName?: string };
  detail?: { data?: { bsb?: string; accountNumber?: string } };
  transactions?: never[];
  transactionList?: { data: { transactions: never[] } };
};
type Raw = {
  truth: { feed_type: FeedType };
  application: unknown;
  feed: { accounts: RawAccount[] };
};
export type ReplayApplicant = {
  feed: Feed;
  feed_type: FeedType;
  application: LiaApplication & Record<string, unknown>;
};
export type ReplaySet = {
  name: "synthetic-v1" | "synthetic-v2.2";
  as_of: string;
  categories: Readonly<Record<string, string>>;
  applicants: ReplayApplicant[];
};

const toApplicant = (a: Raw): ReplayApplicant => ({
  feed: {
    accounts: a.feed.accounts.map((acc) => ({
      account: acc.account,
      ...(acc.detail ? { detail: acc.detail } : {}),
      transactions: acc.transactions ?? acc.transactionList?.data.transactions ?? [],
    })),
  } as unknown as Feed,
  feed_type: a.truth.feed_type,
  application: a.application as ReplayApplicant["application"],
});

export function loadReplaySet(name: ReplaySet["name"]): ReplaySet {
  const manifest = JSON.parse(readFileSync(`research/datasets/${name}.manifest.json`, "utf8")) as {
    seed: number;
    as_of_date?: string;
  };
  const generated: unknown[] =
    name === "synthetic-v2.2"
      ? generateSetV22(manifest.seed)
      : population(manifest.seed).map((spec) => generateApplicant(spec, manifest.seed));
  const cache = JSON.parse(
    readFileSync(
      name === "synthetic-v2.2"
        ? "research/enrich/synthetic-v2.2-categories-no-biller-code.json"
        : "research/enrich/synthetic-v1-categories.json",
      "utf8",
    ),
  ) as { categories: Record<string, string> };
  return {
    name,
    as_of: manifest.as_of_date ?? AS_OF_DATE,
    categories: cache.categories,
    applicants: (generated as Raw[]).map(toApplicant),
  };
}

const runLia = (s: ReplaySet, a: ReplayApplicant) =>
  assessLia({
    feed: a.feed as never,
    feed_type: a.feed_type,
    as_of: s.as_of,
    lookback_months: 6,
    categories: s.categories,
    application: {
      declared_liabilities: a.application.declared_liabilities ?? [],
    },
    // SIG-83 (LIA 1.4.0): this baseline checks display changes against LIA 1.3.6's matching, so it runs step (d) off.
    config: { category_independent: false },
  });
const runInc = (s: ReplaySet, a: ReplayApplicant) =>
  assessInc({
    feed: a.feed,
    feed_type: a.feed_type,
    as_of: s.as_of,
    lookback_months: 6,
    application: a.application as never,
    categories: s.categories,
  });
const runIncome = (s: ReplaySet, a: ReplayApplicant) =>
  deriveIncome({
    feed: a.feed as never,
    as_of: s.as_of,
    lookback_months: 6,
    min_occurrences: 3,
    categories: s.categories,
  });

export type Replay = {
  lia: string;
  inc: string;
  income: string;
  /** One sha256 over observed income's payer names, per applicant, in stream order. */
  income_payers: string;
  /** Every result's versions, as "field=value" strings, de-duplicated. */
  versions: string[];
};

const sha = () => createHash("sha256");

/** LIA, INC and observed income over one set: skeleton hashes, payers and versions. */
export function replay(s: ReplaySet): Replay {
  const [lia, inc, income] = [sha(), sha(), sha()];
  const payers = sha();
  const versions = new Set<string>();
  for (const a of s.applicants) {
    const l = runLia(s, a);
    const i = runInc(s, a);
    const o = runIncome(s, a);
    lia.update(skeleton(l)).update("\n");
    inc.update(skeleton(i)).update("\n");
    income.update(skeleton(o)).update("\n");
    payers.update(JSON.stringify(o.streams.map((x) => x.payer))).update("\n");
    const rec = (engine: string, r: object) => {
      for (const [k, v] of Object.entries(r))
        if (k.endsWith("version")) versions.add(`${engine}.${k}=${String(v)}`);
    };
    rec("lia", l);
    rec("inc", i);
    rec("income", o);
  }
  return {
    lia: lia.digest("hex"),
    inc: inc.digest("hex"),
    income: income.digest("hex"),
    income_payers: payers.digest("hex"),
    versions: [...versions].sort(),
  };
}
