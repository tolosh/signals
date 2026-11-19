// SIG-46 T2: gross-up accuracy on synthetic set v2.2, as pre-registered in
// research/preregistrations/SIG-46.json (t2_experiment). Records carry applicant IDs, tags and
// figures only: never a transaction description or payer name.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { grossUp } from "../engines/affordability/grossup.js";
import { deriveIncome, type IncomeFeed } from "../engines/affordability/income.js";
import { serialise } from "./generator/index.js";
import { generateSetV22 } from "./generator/v22/index.js";

type Raw = {
  truth: {
    applicant_id: string;
    tags: string[];
    history: { months: number };
    income: { gross_annual: number };
    v2: { tax: { net_annual: number } };
  };
  feed: IncomeFeed;
};
export type Applicant46 = {
  id: string;
  tags: string[];
  months: number;
  truth_gross: number;
  truth_net_annual: number;
  feed: IncomeFeed;
};

export function loadV22(manifestPath = "research/datasets/synthetic-v2.2.manifest.json") {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    seed: number;
    set_sha256: string;
    as_of_date: string;
  };
  const generated = generateSetV22(manifest.seed);
  const hash = createHash("sha256");
  for (const a of generated) hash.update(serialise(a)).update("\n");
  const sha = hash.digest("hex");
  if (sha !== manifest.set_sha256) throw new Error(`set hash ${sha} does not match`);
  const applicants: Applicant46[] = (generated as unknown as Raw[])
    .filter((a) => a.truth.tags.includes("salaried") && a.truth.history.months >= 3)
    .map((a) => ({
      id: a.truth.applicant_id,
      tags: a.truth.tags,
      months: a.truth.history.months,
      truth_gross: a.truth.income.gross_annual,
      truth_net_annual: a.truth.v2.tax.net_annual,
      feed: a.feed,
    }))
    .sort((x, y) => (x.id < y.id ? -1 : 1));
  return { set_sha256: sha, as_of: manifest.as_of_date, applicants };
}

export type Mode = "control" | "primary" | "method";
export type Row = {
  applicant_id: string;
  tags: string[];
  months: number;
  truth_gross: number;
  compared_with: string;
  derived_gross: number | null;
  ape: number | null;
  reason?: string;
};

const round4 = (x: number) => Math.round(x * 10000) / 10000;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length === 0
    ? null
    : s.length % 2
      ? (s[m] as number)
      : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

export function scoreT2(
  set: ReturnType<typeof loadV22>,
  mode: Mode,
  config = { lookback_months: 6, min_occurrences: 3 },
) {
  const derived = set.applicants.map((a) => {
    const net =
      mode === "method"
        ? a.truth_net_annual
        : deriveIncome({ feed: a.feed, as_of: set.as_of, ...config }).net_monthly * 12;
    return grossUp({ net: { salary_wage: net }, as_of: set.as_of });
  });
  const rows: Row[] = set.applicants.map((a, i) => {
    const truthFrom =
      mode === "control" ? (set.applicants[(i + 1) % set.applicants.length] as Applicant46) : a;
    const g = derived[i] as ReturnType<typeof grossUp>;
    const gross = g.state === "verified" ? g.gross_income_annual : null;
    return {
      applicant_id: a.id,
      tags: a.tags,
      months: a.months,
      truth_gross: truthFrom.truth_gross,
      compared_with: truthFrom.id,
      derived_gross: gross,
      ape:
        gross === null
          ? null
          : round4(Math.abs(gross - truthFrom.truth_gross) / truthFrom.truth_gross),
      ...(g.state === "unverified" ? { reason: g.reason } : {}),
    };
  });
  const summarise = (rs: Row[]) => {
    const within = rs.filter((r) => r.ape !== null && r.ape <= 0.02).length;
    return {
      applicants: rs.length,
      within_2pct: within,
      share_within_2pct: rs.length === 0 ? null : round4(within / rs.length),
      unverified: rs.filter((r) => r.ape === null).length,
      median_ape: median(rs.flatMap((r) => (r.ape === null ? [] : [r.ape]))),
    };
  };
  const tags = [...new Set(rows.flatMap((r) => r.tags))].sort();
  const months = [...new Set(rows.map((r) => r.months))].sort((a, b) => a - b);
  const table = tableOf(derived);
  return {
    mode,
    config: mode === "method" ? null : config,
    table,
    ...summarise(rows),
    by_tag: Object.fromEntries(
      tags.map((t) => [t, summarise(rows.filter((r) => r.tags.includes(t)))]),
    ),
    by_history_months: Object.fromEntries(
      months.map((m) => [String(m), summarise(rows.filter((r) => r.months === m))]),
    ),
    rows,
  };
}

function tableOf(results: ReturnType<typeof grossUp>[]) {
  const ids = new Set(
    results.flatMap((r) => (r.state === "verified" ? [`${r.table.id} v${r.table.version}`] : [])),
  );
  return [...ids].sort();
}
