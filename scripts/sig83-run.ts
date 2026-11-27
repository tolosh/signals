// SIG-83 (research/preregistrations/SIG-83.json): scores LIA 1.3.6 and 1.4.0 on undisclosed
// liabilities, in the pre-registered order: the negative control (set v2.2, lender names
// rotated), then set v2.2, then v1, then v2.3. Each run refuses to start until the runs before it
// are recorded, and nothing runs after a failed control. Categories are the pinned Enrich build's
// (1.8.0): sets v1 and v2.2 from their committed fixtures, set v2.3 at run time with biller codes.
// Synthetic data only; no transaction text is written.
//   npx tsx scripts/sig83-run.ts --run control|v2.2|v1|v2.3 [--out research/runs] [--allow-dirty]
// Writes <out>/sig83-<run>.json, never overwriting it.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LIA_VERSION } from "../src/engines/families/lia/index.js";
import { LENDER_NAMES_VERSION } from "../src/engines/lender-names.js";
import { PINNED_BUILD, pinnedLocalEnrich } from "../src/connectors/enrich/pinned.js";
import { generateApplicant, population, serialise } from "../src/research/generator/index.js";
import { AS_OF_DATE } from "../src/research/generator/types.js";
import { generateSetV22 } from "../src/research/generator/v22/index.js";
import { generateSetV23 } from "../src/research/generator/v23/index.js";
import { loadAliases, ALIAS_TABLE_PATH } from "../src/research/sig57/score.js";
import { checkRotation, rotatedFeed } from "../src/research/sig83/control.js";
import {
  controlPasses,
  scoreArm,
  toApplicant,
  type Applicant83,
  type RawApplicant,
} from "../src/research/sig83/score.js";
import {
  arg,
  gitState,
  parseRunArgs,
  provenance,
  requireCleanTree,
  writeNew,
} from "./lib/run-record.js";

const ORDER = ["control", "v2.2", "v1", "v2.3"] as const;
type Run = (typeof ORDER)[number];

const args = parseRunArgs(process.argv.slice(2));
const run = arg(args, "run", "") as Run;
if (!ORDER.includes(run)) throw new Error(`--run must be one of ${ORDER.join(", ")}`);
const git = gitState();
requireCleanTree(git.status, args.allowDirty);

const recordPath = (r: Run) => join(args.out, `sig83-${r}.json`);
for (const before of ORDER.slice(0, ORDER.indexOf(run))) {
  if (!existsSync(recordPath(before)))
    throw new Error(`run ${before} comes first (pre-registered order)`);
}
if (run !== "control") {
  const c = JSON.parse(readFileSync(recordPath("control"), "utf8")) as { control_passes: boolean };
  if (!c.control_passes) throw new Error("the negative control failed; no other result stands");
}

type Manifest = { set: string; seed: number; set_sha256: string };
const manifestOf = (s: string) =>
  JSON.parse(readFileSync(`research/datasets/synthetic-${s}.manifest.json`, "utf8")) as Manifest;
const checked = (name: string, set: unknown[], m: Manifest) => {
  const h = createHash("sha256");
  for (const a of set) h.update(serialise(a as never)).update("\n");
  if (h.digest("hex") !== m.set_sha256) throw new Error(`set ${name} doesn't match its manifest`);
  return (set as RawApplicant[]).map(toApplicant).sort((x, y) => (x.id < y.id ? -1 : 1));
};
const fixture = (path: string, m: Manifest) => {
  const f = JSON.parse(readFileSync(path, "utf8")) as {
    set_sha256: string;
    enrich_build: { moroku_enrich_commit: string };
    categories: Record<string, string>;
  };
  if (f.set_sha256 !== m.set_sha256) throw new Error(`${path} is for another set`);
  if (f.enrich_build.moroku_enrich_commit !== PINNED_BUILD.commit)
    throw new Error(`${path} isn't the pinned build's`);
  return { source: path, categories: f.categories };
};
type Tx = Applicant83["feed"]["accounts"][number]["transactions"][number] & {
  merchantCategoryCode?: string;
  merchantName?: string;
  billerCode?: string;
  reference?: string;
};

const setName = run === "control" ? "v2.2" : run;
const m = manifestOf(setName);
let applicants: Applicant83[];
let cats: { source: string; categories: Record<string, string> };
if (setName === "v1") {
  applicants = checked(
    "v1",
    population(m.seed).map((s) => generateApplicant(s, m.seed)),
    m,
  );
  cats = fixture("research/enrich/synthetic-v1-categories-engine-1.8.0.json", m);
} else if (setName === "v2.2") {
  applicants = checked("v2.2", generateSetV22(m.seed), m);
  cats = fixture("research/enrich/synthetic-v2.2-categories-no-biller-code-engine-1.8.0.json", m);
} else {
  applicants = checked("v2.3", generateSetV23(m.seed), m);
  const debits = applicants
    .flatMap((a) => a.feed.accounts.flatMap((acc) => acc.transactions as Tx[]))
    .filter((t) => Number(t.amount) < 0)
    .map((t) => ({
      transactionId: t.transactionId,
      description: t.description,
      amount: t.amount,
      ...(t.merchantCategoryCode ? { merchantCategoryCode: t.merchantCategoryCode } : {}),
      ...(t.merchantName ? { merchantName: t.merchantName } : {}),
      ...(t.billerCode ? { billerCode: t.billerCode } : {}),
      ...(t.billerName ? { billerName: t.billerName } : {}),
      ...(t.reference ? { reference: t.reference } : {}),
    }));
  const r = await pinnedLocalEnrich().categorise(debits);
  cats = {
    source: "categorised at run time on the pinned build, with biller codes",
    categories: Object.fromEntries(r.results.map((x) => [x.transaction_id, x.category])),
  };
}

const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const aliases = loadAliases();
const feedOf =
  run === "control" ? (a: Applicant83) => rotatedFeed(a.feed) : (a: Applicant83) => a.feed;
const rotation = run === "control" ? checkRotation(applicants.map(feedOf)) : null;
const score = (arm: "1.3.6" | "1.4.0") =>
  scoreArm({
    applicants,
    categories: cats.categories,
    as_of: AS_OF_DATE,
    index: aliases.index,
    arm,
    feedOf,
  });
const before = score("1.3.6");
const after = score("1.4.0");
const summary = (s: typeof before) => {
  const rest: Partial<typeof s> = { ...s };
  delete rest.per_applicant;
  delete rest.false_positives_list;
  delete rest.false_negatives_list;
  return { ...rest, per_applicant_sha256: sha(s.per_applicant) };
};
const changed = after.per_applicant
  .filter((r, i) => r.liabilities_sha256 !== before.per_applicant[i]?.liabilities_sha256)
  .map((r) => r.applicant_id);

const record = {
  ticket: "SIG-83",
  run,
  preregistration: "research/preregistrations/SIG-83.json",
  preregistration_sha256: createHash("sha256")
    .update(readFileSync("research/preregistrations/SIG-83.json"))
    .digest("hex"),
  lia_version: LIA_VERSION,
  lender_names_version: LENDER_NAMES_VERSION,
  enrich_build: PINNED_BUILD,
  set: { name: m.set, set_sha256: m.set_sha256, rotated: run === "control" },
  categories: { source: cats.source, sha256: sha(cats.categories) },
  scoring_alias_table: { file: ALIAS_TABLE_PATH, sha256: aliases.sha256 },
  as_of: AS_OF_DATE,
  ...provenance("scripts/sig83-run.ts", args, git),
  ...(rotation ? { rotation_check: { ...rotation, passed: true } } : {}),
  arms: { "1.3.6": summary(before), "1.4.0": summary(after) },
  ...(run === "control" ? { control_passes: controlPasses(before, after) } : {}),
  applicants_whose_liabilities_changed: changed,
  lists: {
    "1.3.6": {
      false_positives: before.false_positives_list,
      false_negatives: before.false_negatives_list,
    },
    "1.4.0": {
      false_positives: after.false_positives_list,
      false_negatives: after.false_negatives_list,
    },
  },
};
writeNew(recordPath(run), `${JSON.stringify(record, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      out: recordPath(run),
      ...(run === "control" ? { control_passes: record.control_passes } : {}),
      changed: changed.length,
      arms: Object.fromEntries(
        Object.entries(record.arms).map(([k, v]) => [
          k,
          {
            precision: v.precision,
            recall: v.recall,
            recall_non_liability: v.recall_from_non_liability_categories,
            tp: v.true_positives,
            fp: v.false_positives,
            fn: v.false_negatives,
          },
        ]),
      ),
    },
    null,
    1,
  ),
);
