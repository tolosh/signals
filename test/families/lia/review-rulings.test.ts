// SIG-42 independent review rulings (Colin, 8 November 2026), LIA 1.2.0. Each section was written
// before the change it tests:
//   ruling 2: LIA-06 is parked until Enrich supplies a private-transfer category that excludes
//             sensitive payees; its code and tests stay, behind the parked state.
import { describe, expect, it } from "vitest";
import { liaConfigFromPolicy } from "../../../src/engines/families/lia/index.js";
import { repeat, run, signal, stateOf, type Line } from "./script.js";

const privateLoan = (amount: number, n = 4): Line[] =>
  Array.from({ length: n }, (_, i) => ({
    ago: 5 + i * 30,
    description: "TRANSFER TO J SMITH LOAN REPAYMENT",
    amount: -amount,
    type: "TRANSFER_OUTGOING",
  }));
const PARKED = "Private-loan detection is not yet supported on categorised data";

describe("Ruling 2: LIA-06 is parked", () => {
  it("a scripted private loan that 1.1.0 called red is unverified, with the ruled reason", () => {
    const s = signal(run({ lines: privateLoan(800) }), "LIA-06");
    expect(s.state).toBe("unverified");
    expect(s.reason).toBe(PARKED);
    expect(s.value).toBeNull();
    expect(s.confidence).toBe("low");
  });
  it("with nothing to find, it is unverified, not none_observed", () => {
    expect(stateOf(run({}), "LIA-06")).toBe("unverified");
  });
  it("when an evidence check also caps it, the check's reason stands (E-11)", () => {
    const transfers = repeat(5, 30, {
      description: "TRANSFER TO 062-000 99998888",
      amount: -800,
      type: "TRANSFER_OUTGOING",
    });
    const s = signal(run({ lines: transfers }), "LIA-06");
    expect(s.state).toBe("unverified");
    expect(s.reason).not.toBe(PARKED);
  });
  it("a lender's policy can't unpark it", () => {
    const policy = { private_loans: "detect", private_large_monthly: 100 } as Parameters<
      typeof liaConfigFromPolicy
    >[0];
    expect(liaConfigFromPolicy(policy)).toEqual({ private_large_monthly: 100 });
  });
  it("behind the parked state, the 1.1.0 rules still run: red for a large private loan", () => {
    const r = run({ lines: privateLoan(800) }, undefined, { private_loans: "detect" });
    expect(stateOf(r, "LIA-06")).toBe("red");
  });
  it("the other five signals are unaffected", () => {
    const r = run({});
    for (const id of ["LIA-01", "LIA-02", "LIA-03", "LIA-04", "LIA-05"])
      expect(stateOf(r, id), id).toBe("none_observed");
  });
});
