// SIG-60 T7: shared by the three leakage test files (one per set, so vitest runs them in
// parallel). Each regenerates its set, runs the pre-registered test, and checks the committed
// run record reproduces exactly (D28).
import { existsSync, readFileSync } from "node:fs";
import { expect } from "vitest";
import { runSet, verdict, type SetName } from "../../../src/research/leakage/run.js";

export const RECORD = (set: SetName) => `research/runs/2026-11-09-sig60-leakage-${set}.json`;
/** Long enough for generation, extraction and every classifier on a 780-applicant set. */
export const TIMEOUT = 900_000;

export function checkSet(set: SetName) {
  const path = RECORD(set);
  expect(existsSync(path), `${path} is committed`).toBe(true);
  const result = runSet(set);
  const header = new Set(["ticket", "test", "role", "verdict", "generated_by"]);
  const recorded = Object.fromEntries(
    Object.entries(JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>).filter(
      ([k]) => !header.has(k),
    ),
  );
  expect(JSON.parse(JSON.stringify(result))).toEqual(recorded);
  return { result, verdict: verdict(result) };
}
