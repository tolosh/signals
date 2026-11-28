// SIG-82 (contract 1.11.0; Colin's ruling (i), 28 Nov 2026): the mock sets the income's state on the
// assessments it recomputes (asm_01_v2 and override versions) by the stage's own rule. src/mock may
// not import src/api (ADR 0005, D65), so the rule is repeated in m3.ts; this test holds the two equal.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { monthlyIncomeState } from "../../src/api/mapping.js";
import {
  computeAffordability,
  type AffordabilityInput,
} from "../../src/engines/affordability/index.js";
import { assessments } from "../../src/mock/fixtures.js";
import { mockIncomeState } from "../../src/mock/m3.js";

const v1 = (
  JSON.parse(readFileSync("test/fixtures/af-t1.json", "utf8")) as { input: AffordabilityInput }
).input;
const v2: AffordabilityInput = { ...v1, expenses: { ...v1.expenses, confirmed_monthly: 3500 } };
const stage = (input: AffordabilityInput) =>
  monthlyIncomeState({ affordability: computeAffordability(input) } as never);

describe("the mock's income state equals the stage's", () => {
  it("asm_01_v2 carries mapping.ts's monthlyIncomeState", () => {
    const served = (
      assessments.asm_01_v2 as { affordability: { serviceability: Record<string, unknown> } }
    ).affordability.serviceability.monthly_income_state;
    expect(stage(v2)).toBe("observed");
    expect(served).toBe(stage(v2));
  });

  it("the two rules agree on an observed and an unverified trace", () => {
    const observed = [{ step: "dsr", value: 0.3, inputs: {} }];
    const none = [{ step: "dsr", value: null, inputs: { reason: "no income" } }];
    const other = [{ step: "dsr", value: null, inputs: { reason: "something else" } }];
    for (const trace of [observed, none, other])
      expect(mockIncomeState(trace)).toBe(
        monthlyIncomeState({ affordability: { trace } } as never),
      );
    expect(mockIncomeState(none)).toBe("unverified");
    expect(() => mockIncomeState([])).toThrow();
  });
});
