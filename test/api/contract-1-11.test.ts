// SIG-82 contract 1.11.0 (D65, SIG-82 40818): the roll-up's complete ordered list and its count
// (1), and the mapping package approved as proposed in 40805 and 40817 (2): the income's state, an
// optional Assessment.versions, the liability rule names, and a nullable trace value. Contract
// first: these tests fail on 1.10.0.
import { describe, expect, it } from "vitest";
import { loadContract } from "../contract/helpers.js";
import { schemaValidator } from "./contract.js";

const doc = loadContract() as unknown as { info: { version: string } };
const rollup = schemaValidator("Rollup");
const affordability = schemaValidator("Affordability");
const assessment = schemaValidator("Assessment");
const trace = schemaValidator("AffordabilityTrace");

const reason = (n: number) => ({ signal_id: `LIA-0${n}`, state: "amber", reason: `r${n}` });
const okRollup = {
  top_reasons: [reason(1), reason(2), reason(3)],
  all_reasons: [reason(1), reason(2), reason(3), reason(4)],
  reasons_total: 4,
  reasons_to_say_yes: [],
};
const serviceability = {
  monthly_income: 0,
  monthly_income_state: "unverified",
  monthly_expenses_gle: 2340.28,
  monthly_repayments: 1150,
  proposed_repayment: 471,
  total_expenses_annual: 47535.36,
};
const okAffordability = {
  status: "unverified",
  serviceability,
  ratios: [],
  benchmark: { name: "none", version: 0, is_seed: false },
};
const VERSIONS = {
  composition: "1.2.0",
  enrich: {
    engine_version: "1.8.0",
    build: { commit: "a".repeat(40), version: "1.8.0", dist_sha256: "b".repeat(64) },
  },
  inc: "1.2.4",
  lia: "1.3.6",
  lia_detector: { method_version: "1.0.0", min_occurrences: 3, amount_tolerance: 0.15 },
  eq_method: "1.0.0",
  observed_expenses: "1.0.0",
  gr3_gate: "1.2.0",
  keyword_list: "1.1.0",
  lender_names: "1.2.0",
  thresholds: 1,
};
const okAssessment = {
  id: "asm_0123456789abcdef",
  applicant_id: "apl_0123456789abcdef",
  version: 1,
  status: "complete",
  status_reason: null,
  product_type: "personal",
  data_as_of: "2026-10-31T00:00:00Z",
  rollup: okRollup,
  evidence_checks: [],
  affordability: okAffordability,
  signals: [],
  pins: { definitions_version: 1, thresholds_version: 1, taxonomy_version: "1.4" },
};

describe("contract 1.11.0", () => {
  it("is version 1.11.0", () => {
    expect(doc.info.version).toBe("1.11.0");
  });

  it("the roll-up carries the complete ordered list and its count, both required", () => {
    expect(rollup(okRollup).valid).toBe(true);
    const { all_reasons: _a, ...noAll } = okRollup;
    const { reasons_total: _t, ...noTotal } = okRollup;
    expect(rollup(noAll).valid).toBe(false);
    expect(rollup(noTotal).valid).toBe(false);
    expect(rollup({ ...okRollup, reasons_total: -1 }).valid).toBe(false);
    expect(rollup({ ...okRollup, reasons_total: 1.5 }).valid).toBe(false);
  });

  it("all_reasons is uncapped; top_reasons stays at most three", () => {
    const many = Array.from({ length: 9 }, (_, i) => reason(i));
    expect(rollup({ ...okRollup, all_reasons: many, reasons_total: 9 }).valid).toBe(true);
    expect(rollup({ ...okRollup, top_reasons: many.slice(0, 4) }).valid).toBe(false);
  });

  it("serviceability carries the income's state, required: observed or unverified", () => {
    expect(affordability(okAffordability).valid).toBe(true);
    const { monthly_income_state: _s, ...noState } = serviceability;
    expect(affordability({ ...okAffordability, serviceability: noState }).valid).toBe(false);
    expect(
      affordability({
        ...okAffordability,
        serviceability: { ...serviceability, monthly_income_state: "green" },
      }).valid,
    ).toBe(false);
    expect(
      affordability({
        ...okAffordability,
        serviceability: { ...serviceability, monthly_income_state: "observed" },
      }).valid,
    ).toBe(true);
  });

  it("Assessment.versions is optional, and typed when present", () => {
    expect(assessment(okAssessment).valid).toBe(true);
    expect(assessment({ ...okAssessment, versions: VERSIONS }).valid).toBe(true);
    expect(assessment({ ...okAssessment, versions: { ...VERSIONS, composition: 12 } }).valid).toBe(
      false,
    );
    expect(
      assessment({
        ...okAssessment,
        versions: { ...VERSIONS, enrich: { engine_version: "1.8.0" } },
      }).valid,
    ).toBe(false);
    expect(
      assessment({
        ...okAssessment,
        versions: { ...VERSIONS, enrich: { engine_version: "1.8.0", build: null } },
      }).valid,
    ).toBe(true);
  });

  it("a trace step's value may be null (an unverified step records none)", () => {
    const t = {
      income: [],
      expenses: [],
      liabilities: [
        {
          type: "sacc",
          source: "declared",
          monthly_commitment: 450,
          rule: "3-month average outflow",
        },
      ],
      trace: [{ step: "dsr", value: null, inputs: { reason: "no income" } }],
      overrides: [],
    };
    expect(trace(t).valid).toBe(true);
    expect(trace({ ...t, trace: [{ step: "dsr", value: "x" }] }).valid).toBe(false);
  });
});
