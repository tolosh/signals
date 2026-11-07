// SIG-13: score an engine against a synthetic set and write a dated run record (JSON and markdown)
// under research/runs/. The set is regenerated from the manifest's seed and refused unless its
// hash matches the published one.
// Usage: npx tsx scripts/score.ts --engine <name> [--manifest research/datasets/synthetic-v1.manifest.json]
//        [--definitions none] [--thresholds none] [--taxonomy 1.4] [--tag <population tag>]
//        [--lookback 6] [--min-occurrences 3] [--ticket SIG-13] [--out research/runs] [--allow-dirty]
// SIG-56: the record stores its command and commit, the tree must be clean, and an existing
// record is never overwritten (a same-day re-run goes to another folder with --out).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  gitState,
  manifestSeed,
  parseRunArgs,
  provenance,
  requireCleanTree,
  writeNew,
} from "./lib/run-record.js";
import {
  AS_OF_DATE,
  generateApplicant,
  population,
  serialise,
  type GeneratedApplicant,
} from "../src/research/generator/index.js";
import { score, summarise, truthFlags, type Engine } from "../src/research/harness/index.js";
import {
  deriveObservedExpenses,
  OBSERVED_EXPENSES_METHOD_VERSION,
  type ExpenseFeed,
} from "../src/engines/affordability/observed-expenses.js";
import {
  deriveIncome,
  INCOME_METHOD_VERSION,
  type IncomeFeed,
} from "../src/engines/affordability/income.js";

const args = parseRunArgs();
const git = gitState();
requireCleanTree(git.status, args.allowDirty);
const arg = (name: string, fallback: string) => args.values[name] ?? fallback;
const engineName = arg("engine", "");
const tag = arg("tag", "");
const lookback = Number(arg("lookback", "6"));
const minOccurrences = Number(arg("min-occurrences", "3"));
const oneOff = Number(arg("one-off", "5000"));
// SIG-17 populations: "covered" shares every account; "uncovered" has at least one unshared.
const coverage = arg("population", "");
const manifestPath = arg("manifest", "research/datasets/synthetic-v1.manifest.json");

const manifest = manifestSeed(manifestPath);

const hash = createHash("sha256");
const applicants: GeneratedApplicant[] = population(manifest.seed).map((spec) => {
  const a = generateApplicant(spec, manifest.seed);
  hash.update(serialise(a)).update("\n");
  return a;
});
const setSha = hash.digest("hex");
if (setSha !== manifest.set_sha256) {
  throw new Error(
    `Regenerated set hash ${setSha} does not match the manifest ${manifest.set_sha256}`,
  );
}

// Calibration engines read the ground truth, so they test the harness, not a method. Real
// engines (SIG-16 to SIG-18) are added here and see only the application and the feed.
const truth = new Map(applicants.map((a) => [a.truth.applicant_id, a.truth]));
const oracle =
  (incomeFactor: number): Engine =>
  ({ applicant_id }) => {
    const t = truth.get(applicant_id);
    if (!t) throw new Error(`no truth for ${applicant_id}`);
    return {
      income_net_monthly: t.income.net_monthly * incomeFactor,
      expenses_total_monthly: t.expenses.total_monthly,
      liabilities: t.liabilities.items.map((l) => ({ type: l.type, provider: l.provider })),
      flags: truthFlags(t),
    };
  };
// SIG-16: the income method on its own. Expenses and liabilities are not derived, so their
// metrics in these records are not results. The shuffled variant is the pre-registered negative
// control: every credit gets a unique, letters-only payer name.
const letters = (i: number): string =>
  (i >= 26 ? letters(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));
const shufflePayers = (feed: IncomeFeed): IncomeFeed => {
  let i = 0;
  return {
    accounts: feed.accounts.map((acc) => ({
      ...acc,
      transactions: acc.transactions.map((t) =>
        Number(t.amount) > 0 ? { ...t, description: `PAYER ${letters(i++)}` } : t,
      ),
    })),
  };
};
const income =
  (prepare: (feed: IncomeFeed) => IncomeFeed): Engine =>
  ({ feed }) => ({
    income_net_monthly: deriveIncome({
      feed: prepare(feed as unknown as IncomeFeed),
      as_of: AS_OF_DATE,
      lookback_months: lookback,
      min_occurrences: minOccurrences,
    }).net_monthly,
    expenses_total_monthly: 0,
    liabilities: [],
    flags: {},
  });
const config = `lookback ${lookback}, min occurrences ${minOccurrences}`;

// SIG-17: observed living expenses (committed + basic) from Enrich categories, read from the
// cache made by scripts/enrich-categorise-set.ts. The rotated variant is the pre-registered
// negative control: within each applicant, every debit takes the next debit's category.
const categoryCache = engineName.startsWith("expenses")
  ? (JSON.parse(readFileSync("research/enrich/synthetic-v1-categories.json", "utf8")) as {
      set_sha256: string;
      enrich: { engine_version: string; taxonomy_version: string };
      categories: Record<string, string>;
    })
  : null;
if (categoryCache && categoryCache.set_sha256 !== manifest.set_sha256)
  throw new Error("the category cache was made from a different set");
const rotate = (feed: ExpenseFeed, categories: Record<string, string>) => {
  const debits = feed.accounts.flatMap((a) =>
    a.transactions.filter((t) => Number(t.amount) < 0).map((t) => t.transactionId),
  );
  return Object.fromEntries(
    debits.map((id, i) => [id, categories[debits[(i + 1) % debits.length] ?? ""] ?? "none"]),
  );
};
const expenses =
  (rotated: boolean): Engine =>
  ({ feed }) => {
    const f = feed as unknown as ExpenseFeed;
    const all = categoryCache?.categories ?? {};
    return {
      income_net_monthly: 0,
      expenses_total_monthly: deriveObservedExpenses({
        feed: f,
        categories: rotated ? rotate(f, all) : all,
        as_of: AS_OF_DATE,
        lookback_months: lookback,
        one_off_threshold_aud: oneOff,
      }).living_monthly,
      liabilities: [],
      flags: {},
    };
  };
const expenseConfig = `lookback ${lookback}, one-off threshold $${oneOff}`;
const ENGINES: Record<string, { engine: Engine; version: string }> = {
  oracle: { engine: oracle(1), version: "calibration" },
  "oracle-income-plus-10": { engine: oracle(1.1), version: "calibration" },
  "income-v1": { engine: income((f) => f), version: `${INCOME_METHOD_VERSION}; ${config}` },
  "income-v1-shuffled-payers": {
    engine: income(shufflePayers),
    version: `${INCOME_METHOD_VERSION}; ${config}; negative control`,
  },
  "expenses-v1": {
    engine: expenses(false),
    version: `${OBSERVED_EXPENSES_METHOD_VERSION}; ${expenseConfig}`,
  },
  "expenses-v1-rotated-categories": {
    engine: expenses(true),
    version: `${OBSERVED_EXPENSES_METHOD_VERSION}; ${expenseConfig}; negative control`,
  },
};
const chosen = ENGINES[engineName];
if (!chosen) throw new Error(`--engine must be one of: ${Object.keys(ENGINES).join(", ")}`);

const commit = git.commit;
const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const suffix = engineName.startsWith("income")
  ? `-lb${lookback}-occ${minOccurrences}`
  : engineName.startsWith("expenses")
    ? `-lb${lookback}-oneoff${oneOff}`
    : "";
const runId = `${createdAt.slice(0, 10)}-${manifest.set}${tag ? `-${tag}` : ""}${coverage ? `-${coverage}` : ""}-${engineName}${suffix}`;

const covered = (a: GeneratedApplicant) =>
  a.truth.coverage.unshared_account_ids.length === 0 && a.truth.history.months >= 3;
const scored = applicants
  .filter((a) => !tag || a.truth.tags.includes(tag))
  .filter((a) => !coverage || (coverage === "covered" ? covered(a) : !covered(a)));
const record = score(scored, chosen.engine, {
  run_id: runId,
  created_at: createdAt,
  ticket: arg("ticket", "SIG-13"),
  dataset: {
    set: manifest.set,
    seed: manifest.seed,
    set_sha256: setSha,
    generator_version: manifest.generator_version ?? "unknown",
    ground_truth_schema_version: manifest.ground_truth_schema_version ?? "unknown",
  },
  engine: { name: engineName, commit, version: chosen.version },
  versions: {
    definitions: arg("definitions", "none"),
    thresholds: arg("thresholds", "none"),
    taxonomy: categoryCache
      ? `${categoryCache.enrich.taxonomy_version} (Enrich local engine ${categoryCache.enrich.engine_version})`
      : arg("taxonomy", "1.4"),
  },
  ...(engineName.startsWith("expenses") ? { expense_truth: "committed_plus_basic" as const } : {}),
});

const base = join(args.out, runId);
const recorded = { ...provenance("scripts/score.ts", args, git), ...record };
writeNew(`${base}.json`, `${JSON.stringify(recorded, null, 2)}\n`);
writeNew(`${base}.md`, summarise(record));
console.log(
  JSON.stringify({
    run: base,
    income_mean_abs_pct_error: record.metrics.income.mean_abs_pct_error,
    liabilities: record.metrics.liabilities.all,
    income_within_tolerance_share: record.metrics.income.within_tolerance_share,
    expenses_within_tolerance_share: record.metrics.expenses.within_tolerance_share,
    expenses_mean_abs_pct_error: record.metrics.expenses.mean_abs_pct_error,
    applicants: scored.length,
    misses: record.misses.length,
  }),
);
