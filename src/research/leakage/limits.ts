// SIG-60: the evidence for set v2.2's four limits (ruling, 9 November 2026, SIG-60 comment 40197).
//
// T7 fails on four labels, and the ruling keeps that verdict and records each label as a limit of
// the set, with its stratified evidence. This is that evidence. It is a post-hoc diagnostic: it is
// not part of the pre-registered test (research/preregistrations/SIG-60.json), it changes nothing
// the test decides, and it is not a rescue. It reads the same units T7 reads.
//
// - T-pay and T-card-repayment: T7 flags `line_amount_reuse` (how many applicants share an exact
//   amount). Its univariate AUC over all units is compared with its AUC inside 20 equal-count
//   bands of `line_amount_log` (magnitude, which is intended evidence for these labels), weighted
//   by band size. Bands with no positives or no negatives are skipped. AUCs are taken in either
//   direction (max(a, 1 - a)), since a carrier may run either way.
// - T-repayment: no family flags; T7's own best stump and its lift over the base rate, read from
//   the T7 record, plus the same banded check of amount reuse, which shows it isn't the carrier.
// - T-drift-line-main: the univariate AUC of `line_recurrence`, and how many applicants the
//   positive lines sit in (the per-line test treats lines as independent).
//
// Univariate AUCs here are over every unit, not T7's held-out folds, so they are not comparable
// one-for-one with T7's tree and logistic AUCs.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { serialise } from "../generator/index.js";
import { generateSetV22 } from "../generator/v22/index.js";
import { auc } from "./classifiers.js";
import { extractUnits } from "./index.js";
import { MANIFESTS } from "./run.js";
import type { Unit } from "./units.js";

export const T7_RECORD = "research/runs/2026-11-09-sig60-leakage-v2.2.json";
const BANDS = 20;

export type BandLimit = {
  feature: string;
  stratified_by: string;
  bands: number;
  overall_auc: number;
  within_bands_auc: number;
};
export type LimitsDiagnostic = {
  set: "v2.2";
  set_sha256: string;
  t7_record: string;
  limits: {
    "T-pay": BandLimit;
    "T-card-repayment": BandLimit;
    "T-repayment": BandLimit & { stump_rule: string; stump_lift: number };
    "T-drift-line-main": {
      feature: string;
      auc: number;
      positives: number;
      applicants_with_positives: number;
    };
  };
};

const round = (x: number) => Math.round(x * 10_000) / 10_000;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : -1e9);
const either = (a: number) => Math.max(a, 1 - a);

function banded(units: Unit[], label: string, feature: string, by: string): BandLimit {
  const u = units.filter((x) => label in x.y);
  const overall = auc(
    u.map((x) => num(x.x[feature])),
    u.map((x) => x.y[label] === true),
  );
  // A stable order: by the stratifying value, then by unit ID.
  const sorted = [...u].sort((a, b) => num(a.x[by]) - num(b.x[by]) || (a.id < b.id ? -1 : 1));
  let sum = 0;
  let weight = 0;
  for (let d = 0; d < BANDS; d++) {
    const bin = sorted.slice(
      Math.floor((d * sorted.length) / BANDS),
      Math.floor(((d + 1) * sorted.length) / BANDS),
    );
    const y = bin.map((x) => x.y[label] === true);
    const pos = y.filter(Boolean).length;
    if (pos === 0 || pos === y.length) continue;
    sum +=
      either(
        auc(
          bin.map((x) => num(x.x[feature])),
          y,
        ),
      ) * bin.length;
    weight += bin.length;
  }
  return {
    feature,
    stratified_by: by,
    bands: BANDS,
    overall_auc: round(either(overall)),
    within_bands_auc: round(sum / weight),
  };
}

export function limitsDiagnostic(): LimitsDiagnostic {
  const manifest = JSON.parse(readFileSync(MANIFESTS["v2.2"], "utf8")) as {
    seed: number;
    set_sha256: string;
  };
  const applicants = generateSetV22(manifest.seed);
  const hash = createHash("sha256");
  for (const a of applicants) hash.update(serialise(a)).update("\n");
  const setSha = hash.digest("hex");
  if (setSha !== manifest.set_sha256)
    throw new Error(`set v2.2 regenerated to ${setSha}, not its manifest's ${manifest.set_sha256}`);
  const units = extractUnits({ name: "v2.2", seed: manifest.seed, applicants });

  const t7 = JSON.parse(readFileSync(T7_RECORD, "utf8")) as {
    set_sha256: string;
    labels: {
      id: string;
      scores: { base: number; stump: { rule: string; precision: number } | null };
    }[];
  };
  if (t7.set_sha256 !== setSha) throw new Error("the T7 record is for a different set");
  const rep = t7.labels.find((l) => l.id === "T-repayment");
  if (!rep?.scores.stump) throw new Error("the T7 record has no T-repayment stump");

  const drift = units.filter((x) => "T-drift-line-main" in x.y);
  const driftY = drift.map((x) => x.y["T-drift-line-main"] === true);
  const positives = drift.filter((x) => x.y["T-drift-line-main"] === true);

  return {
    set: "v2.2",
    set_sha256: setSha,
    t7_record: T7_RECORD,
    limits: {
      "T-pay": banded(units, "T-pay", "line_amount_reuse", "line_amount_log"),
      "T-card-repayment": banded(units, "T-card-repayment", "line_amount_reuse", "line_amount_log"),
      "T-repayment": {
        ...banded(units, "T-repayment", "line_amount_reuse", "line_amount_log"),
        stump_rule: rep.scores.stump.rule,
        stump_lift: round(rep.scores.stump.precision / rep.scores.base),
      },
      "T-drift-line-main": {
        feature: "line_recurrence",
        auc: round(
          either(
            auc(
              drift.map((x) => num(x.x.line_recurrence)),
              driftY,
            ),
          ),
        ),
        positives: positives.length,
        applicants_with_positives: new Set(positives.map((x) => x.group)).size,
      },
    },
  };
}
