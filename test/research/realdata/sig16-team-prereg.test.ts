// SIG-61 (10:50, item 6): the first real-data experiment, SIG-16's income derivation on team members'
// own grants, is pre-registered before any team data is scored. The test checks the registration
// says what it must: the source and its consent basis; that nothing is kept for research; the same
// method, engine version, thresholds and negative control as SIG-16's synthetic run, unchanged;
// the truth taken from the payslip figures; the minimum population; counts and rates only, with a
// small-cell rule; and no tuning on team data.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INCOME_METHOD_VERSION } from "../../../src/engines/affordability/income.js";
import { SENSITIVE_METHOD_VERSION } from "../../../src/engines/sensitive.js";
import { guardRunRecord } from "../../../src/research/realdata/guard.js";
import { TRUTH_SCHEMA_VERSION } from "../../../src/research/realdata/truth-capture.js";

const path = "research/preregistrations/SIG-16-team-grants.json";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- read-only JSON in a test
type Json = Record<string, any>;
const pre = () => JSON.parse(readFileSync(path, "utf8")) as Json;
const synthetic = JSON.parse(readFileSync("research/preregistrations/SIG-16.json", "utf8")) as Json;

describe("SIG-16 on team grants: the pre-registration", () => {
  it("names the ticket, the source and the consent basis", () => {
    const p = pre();
    expect(p.ticket).toBe("SIG-16");
    expect(p.apparatus_ticket).toBe("SIG-61");
    expect(p.data.source).toBe("openfeed-production");
    expect(p.data.consent_basis).toBe("openfeed-onward-disclosure");
    expect(p.data.deidentification_consent).toBe(false);
    expect(p.data.retention).toBe("purge_after_comparison");
  });

  it("keeps SIG-16's method, thresholds and negative control unchanged", () => {
    const p = pre();
    for (const k of [
      "hypothesis",
      "metric",
      "tolerance_pct",
      "target_share_within",
      "fails_if_share_within_below",
      "classification",
      "primary_configuration",
      "variables",
      "method",
    ])
      expect(p[k], k).toEqual(synthetic[k]);
    expect(p.negative_control.manipulation).toBe(synthetic.negative_control.manipulation);
    expect(p.negative_control.expected).toBe(synthetic.negative_control.expected);
    expect(p.negative_control.run_first).toBe(true);
  });

  it("pins the engine and the GR-3 gate versions in force at registration", () => {
    expect(pre().engine).toEqual({
      module: "src/engines/affordability/income.ts",
      income_method_version: INCOME_METHOD_VERSION,
      gr3_gate_version: SENSITIVE_METHOD_VERSION,
    });
  });

  it("takes the truth from the payslip figures in truth capture 2.0.0", () => {
    const t = pre().truth;
    expect(t.schema_version).toBe(TRUTH_SCHEMA_VERSION);
    expect(t.field).toBe("payslip.net_per_pay");
    expect(t.monthly_equivalent).toEqual({
      weekly: "52/12",
      fortnightly: "26/12",
      four_weekly: "13/12",
      monthly: "1",
    });
    expect(t.requires_payslip_verified).toBe(true);
  });

  it("sets a minimum population, below which the result is inconclusive", () => {
    const pop = pre().population;
    expect(pop.minimum_people).toBe(10);
    expect(pop.below_minimum).toMatch(/inconclusive/);
  });

  it("reports counts and rates only, with a small-cell rule, and no tuning", () => {
    const p = pre();
    expect(p.reporting.small_cell_minimum).toBe(5);
    expect(p.reporting.per_person_rows).toBe(false);
    expect(p.no_tuning).toMatch(/new pre-registration/);
  });

  it("is frozen before any team data is scored", () => {
    expect(pre().status).toMatch(/before any team data is ingested or scored/);
  });

  it("holds nothing real: the T2 guard's detectors find no identifiers or narratives in it", () => {
    const text = readFileSync(path, "utf8");
    expect(text).not.toMatch(/cr_[0-9a-z]{16,}/);
    const { violations } = guardRunRecord({
      data_source: pre().data.source,
      consent_basis: pre().data.consent_basis,
    });
    expect(violations).toEqual([]);
  });
});
