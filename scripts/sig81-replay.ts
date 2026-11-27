// SIG-81 (ruling 40741, 4): observed expenses replayed over synthetic sets v1, v2.2 and v2.3 on the
// pinned Enrich build, as run, for the before and after of a version change. Sets v1 and v2.2 are
// categorised from their committed 1.8.0 fixtures; set v2.3, which has none, at run time on the
// pinned build with biller codes, as the demo categorises it. LIA runs first and its repayments go
// to observed expenses (src/research/sig81/replay.ts). Includes review 18's five v2.2 applicants.
// Synthetic data only; no transaction text is written.
//   npx tsx scripts/sig81-replay.ts [--out research/runs] [--allow-dirty]
// Writes <out>/sig81-observed-expenses-<version>.json, never overwriting it.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OBSERVED_EXPENSES_METHOD_VERSION } from "../src/engines/affordability/observed-expenses.js";
import { LIA_VERSION } from "../src/engines/families/lia/index.js";
import { PINNED_BUILD, pinnedLocalEnrich } from "../src/connectors/enrich/pinned.js";
import { generateApplicant, population, serialise } from "../src/research/generator/index.js";
import { AS_OF_DATE } from "../src/research/generator/types.js";
import { generateSetV22 } from "../src/research/generator/v22/index.js";
import { generateSetV23 } from "../src/research/generator/v23/index.js";
import {
  debitsOf,
  PRIMARY,
  replayApplicant,
  summarise,
  type ApplicantReplay,
  type SetApplicant,
} from "../src/research/sig81/replay.js";
import {
  gitState,
  parseRunArgs,
  provenance,
  requireCleanTree,
  writeNew,
} from "./lib/run-record.js";

const args = parseRunArgs(process.argv.slice(2));
const git = gitState();
requireCleanTree(git.status, args.allowDirty);

type Manifest = { set: string; seed: number; set_sha256: string };
const manifestOf = (s: string) =>
  JSON.parse(readFileSync(`research/datasets/synthetic-${s}.manifest.json`, "utf8")) as Manifest;
const checked = (name: string, set: unknown[], m: Manifest) => {
  const h = createHash("sha256");
  for (const a of set) h.update(serialise(a as never)).update("\n");
  if (h.digest("hex") !== m.set_sha256) throw new Error(`set ${name} doesn't match its manifest`);
  return set as unknown as SetApplicant[];
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
  return { path, categories: f.categories };
};

const m1 = manifestOf("v1");
const m22 = manifestOf("v2.2");
const m23 = manifestOf("v2.3");
const v1 = checked(
  "v1",
  population(m1.seed).map((s) => generateApplicant(s, m1.seed)),
  m1,
);
const v22 = checked("v2.2", generateSetV22(m22.seed), m22);
const v23 = checked("v2.3", generateSetV23(m23.seed), m23);

const c1 = fixture("research/enrich/synthetic-v1-categories-engine-1.8.0.json", m1);
const c22 = fixture(
  "research/enrich/synthetic-v2.2-categories-no-biller-code-engine-1.8.0.json",
  m22,
);
const enrich = pinnedLocalEnrich();
const r23 = await enrich.categorise(debitsOf(v23, true));
const c23 = {
  path: "categorised at run time on the pinned build, with biller codes",
  categories: Object.fromEntries(r23.results.map((r) => [r.transaction_id, r.category])),
};

const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const rowOf = (r: ApplicantReplay) => {
  const o = r.observed as ApplicantReplay["observed"] & {
    unverified_monthly?: number;
    lia_repayments_in_other_categories?: number;
  };
  return {
    applicant_id: r.applicant_id,
    truth_living_monthly: r.truth_living_monthly,
    living_monthly: o.living_monthly,
    committed_monthly: o.committed_monthly,
    basic_monthly: o.basic_monthly,
    ...(o.unverified_monthly !== undefined ? { unverified_monthly: o.unverified_monthly } : {}),
    discretionary_monthly: o.discretionary_monthly,
    one_offs: o.one_offs.length,
    excluded: o.excluded,
    ...(o.lia_repayments_in_other_categories !== undefined
      ? { lia_repayments_in_other_categories: o.lia_repayments_in_other_categories }
      : {}),
    lia_repayments: r.lia_repayments.length,
  };
};
const run = (set: SetApplicant[], c: { path: string; categories: Record<string, string> }) => {
  const rows = set.map((a) => replayApplicant(a, c.categories));
  return {
    categories: c.path,
    categories_sha256: sha(c.categories),
    summary: summarise(rows),
    outputs_sha256: sha(rows),
    applicants: rows.map(rowOf),
  };
};
const sets = {
  "synthetic-v1": { set_sha256: m1.set_sha256, ...run(v1, c1) },
  "synthetic-v2.2": { set_sha256: m22.set_sha256, ...run(v22, c22) },
  "synthetic-v2.3": { set_sha256: m23.set_sha256, ...run(v23, c23) },
};
// Review 18's five v2.2 applicants (SIG-70 comment 40739, E13).
const FIVE = ["cd057c1d", "a760789f", "a4bd94a3", "a492ac03", "b8be4100"];
const five = FIVE.map((p) => {
  const row = sets["synthetic-v2.2"].applicants.find((r) =>
    r.applicant_id.startsWith(`syn-v22-${p}`),
  );
  if (!row) throw new Error(`no v2.2 applicant ${p}`);
  return row;
});

const record = {
  ticket: "SIG-81",
  ruling: "40741, 4: versioned and replayed; before and after on sets v1, v2.2 and v2.3, as run",
  observed_expenses_version: OBSERVED_EXPENSES_METHOD_VERSION,
  lia_version: LIA_VERSION,
  enrich_build: PINNED_BUILD,
  configuration: { as_of: AS_OF_DATE, ...PRIMARY },
  ...provenance("scripts/sig81-replay.ts", args, git),
  review18_five: five,
  sets,
};
const out = join(args.out, `sig81-observed-expenses-${OBSERVED_EXPENSES_METHOD_VERSION}.json`);
writeNew(out, `${JSON.stringify(record, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      out,
      version: OBSERVED_EXPENSES_METHOD_VERSION,
      summaries: Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.summary])),
      five: five.map((r) => [
        r.applicant_id.slice(8, 16),
        r.living_monthly,
        r.truth_living_monthly,
      ]),
    },
    null,
    1,
  ),
);
