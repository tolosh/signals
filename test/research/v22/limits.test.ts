// SIG-60: the evidence for the four limits of set v2.2 (ruling, 9 November 2026, comment 40197).
// T7 fails on T-pay, T-card-repayment, T-repayment and T-drift-line-main, and the ruling records
// each as a limit, with its stratified evidence. That evidence is a post-hoc diagnostic, not part
// of the pre-registered test and not a change to it. It is computed by
// src/research/leakage/limits.ts, written by scripts/leakage-limits.ts, and this test checks the
// committed record reproduces exactly (D28).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { limitsDiagnostic } from "../../../src/research/leakage/limits.js";
import { RECORD, TIMEOUT } from "./leakage-helper.js";

const PATH = "research/runs/2026-11-09-sig60-leakage-v2.2-limits.json";
const HEADER = new Set(["ticket", "analysis", "role", "generated_by"]);

describe("set v2.2's four limits: the stratified evidence", () => {
  it(
    "reproduces its committed record exactly",
    () => {
      expect(existsSync(PATH), `${PATH} is committed`).toBe(true);
      const recorded = Object.fromEntries(
        Object.entries(JSON.parse(readFileSync(PATH, "utf8")) as Record<string, unknown>).filter(
          ([k]) => !HEADER.has(k),
        ),
      );
      expect(JSON.parse(JSON.stringify(limitsDiagnostic()))).toEqual(recorded);
    },
    TIMEOUT,
  );

  it(
    "covers exactly the four labels that T7's record shows leaking, and nothing else",
    () => {
      const t7 = JSON.parse(readFileSync(RECORD("v2.2"), "utf8")) as {
        set_sha256: string;
        labels: { id: string; status: string }[];
      };
      const d = limitsDiagnostic();
      expect(d.set_sha256).toBe(t7.set_sha256);
      expect(Object.keys(d.limits).sort()).toEqual(
        t7.labels
          .filter((l) => l.status === "leak")
          .map((l) => l.id)
          .sort(),
      );
    },
    TIMEOUT,
  );

  it(
    "shows amount reuse carries little within magnitude bands, for the two amount-carried labels",
    () => {
      const { limits } = limitsDiagnostic();
      for (const id of ["T-pay", "T-card-repayment"] as const) {
        const l = limits[id];
        expect(l.feature).toBe("line_amount_reuse");
        expect(l.stratified_by).toBe("line_amount_log");
        expect(l.bands).toBe(20);
        expect(l.within_bands_auc).toBeLessThan(l.overall_auc);
      }
    },
    TIMEOUT,
  );

  it(
    "gives T-repayment's best stump lift from T7's own record, and T-drift-line-main's clustering",
    () => {
      const { limits } = limitsDiagnostic();
      expect(limits["T-repayment"].stump_rule).toBe("app_n_shared_accounts >= 5");
      expect(limits["T-repayment"].stump_lift).toBeGreaterThan(1);
      expect(limits["T-repayment"].stump_lift).toBeLessThan(1.5); // under the stump margin
      const d = limits["T-drift-line-main"];
      expect(d.feature).toBe("line_recurrence");
      expect(d.positives).toBe(144);
      expect(d.applicants_with_positives).toBeLessThan(d.positives);
    },
    TIMEOUT,
  );
});
