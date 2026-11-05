// SIG-15 section 6 tests (Product Specification 6.1, 6.5, 6.6, AF-1, AF-T1).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeAffordability,
  DEFAULT_THRESHOLDS,
  type AffordabilityInput,
} from "../../../src/engines/affordability/index.js";
import { loadContract, schemaValidator } from "../../contract/helpers.js";

type Fixture = {
  input: AffordabilityInput;
  expected: {
    serviceability: Record<string, number>;
    ratios: Record<string, number | { gross: number; net: number }>;
    states: Record<string, string | null>;
  };
};
const fixture = JSON.parse(readFileSync("test/fixtures/af-t1.json", "utf8")) as Fixture;
const published = JSON.parse(readFileSync("test/fixtures/af-t1-assessment.json", "utf8")) as {
  affordability: unknown;
};
const run = (input: AffordabilityInput = fixture.input) =>
  computeAffordability(input, DEFAULT_THRESHOLDS);
const ratio = (key: string) => run().affordability.ratios.find((r) => r.key === key);

describe("T1 AF-T1 reproduces at displayed precision", () => {
  it.each(Object.entries(fixture.expected.serviceability))("%s = %d", (field, value) => {
    expect(run().affordability.serviceability[field as "monthly_income"]).toBe(value);
  });

  it.each(Object.entries(fixture.expected.ratios))("%s", (key, value) => {
    const r = ratio(key);
    if (typeof value === "number") expect(r?.value).toBe(value);
    else expect({ gross: r?.gross, net: r?.net }).toEqual(value);
  });

  it("LVR and Benchmark/GLE carry both figures", () => {
    expect(ratio("lvr")).toMatchObject({ numerator: 960000, denominator: 1200000 });
    expect(ratio("benchmark_gle")).toMatchObject({ numerator: 1573, denominator: 3367 });
  });

  it("the affordability block equals Build Specification v3 section 3.4 exactly", () => {
    expect(run().affordability).toStrictEqual(published.affordability);
  });

  it("validates against the contract's Affordability schema", () => {
    const check = schemaValidator(loadContract())("Affordability")(run().affordability);
    expect(check.errors ?? null).toBeNull();
  });
});

describe("T2 states under the default thresholds", () => {
  it.each(Object.entries(fixture.expected.states))("%s is %s", (key, state) => {
    expect(ratio(key)?.state).toBe(state);
  });
});

describe("T3 determinism (AF-1)", () => {
  it("the same inputs twice give identical output, trace included", () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(fixture.input);
    run();
    expect(JSON.stringify(fixture.input)).toBe(before);
  });

  it("emits a trace step for every figure, with the threshold version", () => {
    const result = run();
    const steps = result.trace.map((t) => t.step);
    for (const step of [
      "income",
      "gle",
      "repayments",
      "assessment_rate",
      "proposed_repayment",
      "ara",
      "dsr",
      "ndi",
      "total_expenses",
      "lvr",
      "benchmark_gle",
      "total_debt",
      "lti_gross",
      "lti_net",
      "dti_gross",
      "dti_net",
    ]) {
      expect(steps).toContain(step);
    }
    expect(result.versions.thresholds_version).toBe(DEFAULT_THRESHOLDS.version);
  });
});

describe("T4 zero income", () => {
  const zero = (): AffordabilityInput => ({
    ...fixture.input,
    income: { streams: [], stated_gross_annual: null },
  });

  it("returns unverified without throwing (AF-I6)", () => {
    expect(() => run(zero())).not.toThrow();
    expect(run(zero()).affordability.status).toBe("unverified");
  });

  it("marks every income-based ratio unverified, with no value", () => {
    for (const key of ["dsr", "ndi", "ara", "lti", "dti"]) {
      const r = run(zero()).affordability.ratios.find((x) => x.key === key);
      expect(r?.state).toBe("unverified");
      expect(r?.value ?? r?.gross ?? null).toBeNull();
    }
    expect(JSON.stringify(run(zero()))).not.toMatch(/Infinity|NaN/);
  });

  it("negative control: the AF-T1 inputs are not unverified", () => {
    expect(run().affordability.status).toBe("complete");
  });
});
