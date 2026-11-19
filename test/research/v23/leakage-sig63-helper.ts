// SIG-63 T7: shared by the four leakage test files (one per set, so vitest runs them in
// parallel). Each regenerates its set, runs T7 as SIG-63 registers it, and checks the committed
// run record reproduces exactly (D28). CI checks reproduction, not the verdict.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";

export type Sig63Set = "v2" | "v2.1" | "v2.2" | "v2.3";
/** Long enough for generation, extraction and every classifier on a 780-applicant set. */
export const TIMEOUT = 900_000;
const DIR = "research/runs";
export const recordPath = (set: Sig63Set) => {
  const f = existsSync(DIR)
    ? readdirSync(DIR).find((x) => x.endsWith(`-sig63-leakage-${set}.json`))
    : undefined;
  return f ? join(DIR, f) : null;
};

export async function checkSet(set: Sig63Set) {
  const path = recordPath(set);
  expect(path, `a SIG-63 T7 record for ${set} is committed`).not.toBeNull();
  const mod = (await import(/* @vite-ignore */ "../../../src/research/leakage/sig63.js")) as {
    runSig63: (s: Sig63Set) => Record<string, unknown>;
    verdictSig63: (r: Record<string, unknown>) => { pass: boolean; failing: string[] };
  };
  const result = mod.runSig63(set);
  const header = new Set(["ticket", "test", "role", "verdict", "generated_by", "date"]);
  const recorded = JSON.parse(readFileSync(path ?? "", "utf8")) as Record<string, unknown>;
  const body = Object.fromEntries(Object.entries(recorded).filter(([k]) => !header.has(k)));
  expect(JSON.parse(JSON.stringify(result))).toEqual(body);
  return { result, verdict: mod.verdictSig63(result), recorded };
}
