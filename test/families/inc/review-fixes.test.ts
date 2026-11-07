// SIG-41 fixes after the independent review at b3bd9a5 (7 November 2026). Ruling 1's intent: a
// missed pay counts once, and a real trough is never hidden.
//   Fix 1: the add-back for a missed pay is no more than the stream's level that month: the lower
//          of its median and the median of its pays received that month (the median if none).
//   Fix 2: missed pays for the add-back are found over INC-09's 12 months, not INC-12's 6.
import { describe, expect, it } from "vitest";
import { dayOf, isoOf } from "../../../src/engines/evidence/dates.js";
import { INC_VERSION } from "../../../src/engines/families/inc/index.js";
import { STEADY, run, stateOf } from "./script.js";

// STEADY is fortnightly, last paid 2 days before 31 October 2026, so pays 7 and 8 (counting from
// the most recent) fall in July 2026: 23 July and 9 July. Skipping pay 8 leaves July one pay.
const JULY_PAYS = [7, 8].map((i) => isoOf(dayOf("2026-10-29") - 14 * i));
const inJuly = (day: number) => isoOf(day).startsWith("2026-07");
const julyCut = (remaining: number) => ({
  ...STEADY,
  skip: [8],
  amount: (_: number, day: number) => (inJuly(day) ? remaining : 3000),
});

describe("Fix 1: a missed pay in a month of genuinely lower pay doesn't hide the trough", () => {
  it("the scripted July pays are where the test says", () => {
    expect(JULY_PAYS).toEqual(["2026-07-23", "2026-07-09"]);
  });

  it("July's pay cut to $1,000 with one missed: INC-09 amber, as without the missed pay", () => {
    const cutOnly = run({ pays: [{ ...julyCut(1000), skip: [] }] });
    expect(stateOf(cutOnly, "INC-09")).toBe("amber");
    const withMissed = run({ pays: [julyCut(1000)] });
    expect(stateOf(withMissed, "INC-12")).toBe("amber");
    expect(stateOf(withMissed, "INC-09")).toBe("amber");
  });

  it("with a $2,500 repayment, July stays below it: INC-09 red, not green", () => {
    const r = run({ pays: [julyCut(1000)] }, { proposed_repayment_monthly: 2500 });
    expect(stateOf(r, "INC-09")).toBe("red");
  });

  it("across the band the review found hidden ($700 to $1,500 remaining), INC-09 stays amber", () => {
    for (const remaining of [700, 1000, 1500])
      expect(stateOf(run({ pays: [julyCut(remaining)] }), "INC-09")).toBe("amber");
  });
});

describe("Fix 2: missed pays for the add-back are found over INC-09's 12 months", () => {
  it("a missed pay 8 months ago: INC-12 green (outside its 6 months) and INC-09 green", () => {
    // Pay 17 is 238 days before the most recent pay: 5 March 2026.
    expect(isoOf(dayOf("2026-10-29") - 14 * 17)).toBe("2026-03-05");
    const r = run({ pays: [{ ...STEADY, skip: [17] }] });
    expect(stateOf(r, "INC-12")).toBe("green");
    expect(stateOf(r, "INC-09")).toBe("green");
  });
});

describe("Fix 3: the engine version", () => {
  it("is 1.1.0, because the rulings and fixes change its outputs", () => {
    expect(INC_VERSION).toBe("1.1.0");
  });
});

describe("Fix 5: the contract's income_signals reaches the engine", () => {
  it("a lender's policy values (contract 1.7.0) become INC config; absent ones keep the defaults", async () => {
    const { incConfigFromPolicy, INC_DEFAULTS } =
      await import("../../../src/engines/families/inc/index.js");
    expect(incConfigFromPolicy(undefined)).toEqual({});
    expect(incConfigFromPolicy({ large_loan_amount: 300_000 })).toEqual({
      large_loan_amount: 300_000,
    });
    expect(
      incConfigFromPolicy({
        wage_sized_loan_amount: 25_000,
        large_loan_amount: 750_000,
        policy_loan_amount: null,
      }),
    ).toEqual({
      wage_sized_loan_amount: 25_000,
      large_loan_amount: 750_000,
      policy_loan_amount: null,
    });
    expect(INC_DEFAULTS.large_loan_amount).toBe(500_000);
  });

  it("a policy's large-loan size changes INC-07 through the mapping", async () => {
    const { incConfigFromPolicy } = await import("../../../src/engines/families/inc/index.js");
    const r = run(
      { pays: [STEADY] },
      { household_earners: 1, loan_amount: 400_000 },
      incConfigFromPolicy({ large_loan_amount: 300_000 }),
    );
    expect(stateOf(r, "INC-07")).toBe("amber");
  });
});
