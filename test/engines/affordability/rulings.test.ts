// SIG-15 follow-up: rulings of 7 November 2026 (Decision Record D24 and D25; comment on SIG-15).
// I-4 (D25): states are judged on the rounded value, 2 dp, halves up.
// I-7 (D25): "from X" includes X, "above X" excludes X, applied to the rounded value.
// I-5 (D24): the LTI and DTI badges follow net, always; gross is shown for information only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeAffordability,
  DEFAULT_THRESHOLDS,
  type AffordabilityInput,
} from "../../../src/engines/affordability/index.js";

const fixture = JSON.parse(readFileSync("test/fixtures/af-t1.json", "utf8")) as {
  input: AffordabilityInput;
  expected: { states: Record<string, string | null> };
};
const run = (input: AffordabilityInput) => computeAffordability(input, DEFAULT_THRESHOLDS);
const ratio = (input: AffordabilityInput, key: string) =>
  run(input).affordability.ratios.find((r) => r.key === key);
const withLoan = (amount: number): AffordabilityInput => ({
  ...fixture.input,
  loan: { ...fixture.input.loan, amount },
});
// AF-T1 annual net income: $15,158 a month x 12.
const ANNUAL_NET = 181_896;

describe("I-4 states are judged on the rounded value (D25)", () => {
  it("net LTI 3.4952 shows 3.50 and is amber, because amber is from 3.5", () => {
    const amount = 635_754;
    expect(amount / ANNUAL_NET).toBeLessThan(3.5);
    const lti = ratio(withLoan(amount), "lti");
    expect(lti?.net).toBe(3.5);
    expect(lti?.state).toBe("amber");
  });

  it("net LTI 3.4948 shows 3.49 and is green", () => {
    const lti = ratio(withLoan(635_690), "lti");
    expect(lti?.net).toBe(3.49);
    expect(lti?.state).toBe("green");
  });

  it("the colour always matches the number shown, across a sweep of loan amounts", () => {
    for (let amount = 630_000; amount <= 640_000; amount += 37) {
      const lti = ratio(withLoan(amount), "lti");
      expect(lti?.state).toBe((lti?.net ?? 0) >= 3.5 ? "amber" : "green");
    }
  });

  it("AF-T1's states do not change", () => {
    for (const [key, state] of Object.entries(fixture.expected.states))
      expect(ratio(fixture.input, key)?.state).toBe(state);
  });
});

describe("I-5 the LTI and DTI badges follow net, always (D24)", () => {
  it("a gross figure worse than net does not move the badge", () => {
    // Not a realistic income, but it separates "net always" from "the worse of the two".
    const input = {
      ...fixture.input,
      income: { ...fixture.input.income, stated_gross_annual: 100_000 },
    };
    const lti = ratio(input, "lti");
    expect(lti?.gross).toBe(9.6);
    expect(lti?.net).toBe(5.28);
    expect(lti?.state).toBe("amber");
  });

  it("without gross income, LTI and DTI show net with net's state, and gross needs a gross-up", () => {
    const input = {
      ...fixture.input,
      income: { ...fixture.input.income, stated_gross_annual: null },
    };
    const result = run(input);
    for (const key of ["lti", "dti"]) {
      const r = result.affordability.ratios.find((x) => x.key === key);
      expect(r?.state).toBe("amber");
      expect(r?.gross).toBeUndefined();
      expect(r?.net).toBe(key === "lti" ? 5.28 : 5.54);
    }
    const steps = result.trace.filter((s) => s.step === "lti_gross" || s.step === "dti_gross");
    expect(steps.map((s) => s.inputs.reason)).toEqual(["needs gross-up", "needs gross-up"]);
  });
});
