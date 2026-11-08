// SIG-42 rulings, 8 November 2026 (Colin, on ADR 0006): L-1 to L-8 stand, with two changes.
// 1. LIA-02's and LIA-06's keywords match whole words only, case-insensitively, so "OWEN",
//    "LOANS4U" and "BIOU" don't match. One positive and one near-miss case per keyword.
// 2. LIA-05's 25% rise, LIA-06's $500 monthly mean and LIA-06's 25% increase are candidate
//    workspace defaults, overridable per lender like INC's income_signals (contract 1.8.0).
import { describe, expect, it } from "vitest";
import {
  LIA_CANDIDATES,
  LIA_DEFAULTS,
  LIA_VERSION,
  liaConfigFromPolicy,
} from "../../../src/engines/families/lia/index.js";
import { loadContract, schemaValidator } from "../../contract/helpers.js";
import { repeat, run, stateOf, type Line, DETECT_PRIVATE } from "./script.js";

/** One credit from a lender the detector hasn't seen, so only the keyword can make it a disbursement. */
const credit = (description: string): Line[] => [{ ago: 20, description, amount: 2000 }];
/** Two monthly transfers out to one payee, uncategorised. */
const transfers = (description: string, reference?: string): Line[] =>
  repeat(2, 30, {
    description,
    amount: -100,
    type: "TRANSFER_OUTGOING",
    ...(reference ? { reference } : {}),
  });

describe("Ruling 1: LIA-02 keywords match whole words only", () => {
  const cases: [keyword: string, positive: string, nearMiss: string][] = [
    ["LOAN", "ACME FINANCE LOAN", "LOANS4U REFUND"],
    ["DISBURSEMENT", "ACME FINANCE DISBURSEMENT", "ACME NONDISBURSEMENT REFUND"],
    ["DRAWDOWN", "ACME FINANCE DRAWDOWN", "ACME DRAWDOWNS REFUND"],
  ];
  for (const [keyword, positive, nearMiss] of cases) {
    it(`${keyword}: "${positive}" is a disbursement`, () => {
      expect(stateOf(run({ lines: credit(positive) }), "LIA-02")).toBe("amber");
    });
    it(`${keyword}: "${nearMiss}" is not`, () => {
      expect(stateOf(run({ lines: credit(nearMiss) }), "LIA-02")).toBe("none_observed");
    });
  }
  it("matching is case-insensitive", () => {
    expect(stateOf(run({ lines: credit("Acme Finance loan") }), "LIA-02")).toBe("amber");
  });
});

describe("Ruling 1: LIA-06 keywords match whole words only", () => {
  const cases: [keyword: string, positive: string, nearMiss: string][] = [
    ["LOAN", "TRANSFER TO J SMITH LOAN", "TRANSFER TO LOANS4U"],
    ["REPAY", "TRANSFER TO J SMITH REPAY", "TRANSFER TO J SMITH PREPAY"],
    ["REPAYMENT", "TRANSFER TO J SMITH REPAYMENT", "TRANSFER TO J SMITH PREPAYMENT"],
    ["OWE", "TRANSFER TO J SMITH OWE YOU", "TRANSFER TO OWEN JONES"],
    ["OWED", "TRANSFER TO J SMITH OWED", "TRANSFER TO J SMITH TOWED CAR"],
    ["IOU", "TRANSFER TO J SMITH IOU", "TRANSFER TO BIOU CAFE"],
  ];
  for (const [keyword, positive, nearMiss] of cases) {
    it(`${keyword}: "${positive}" is a private-loan repayment`, () => {
      expect(
        stateOf(run({ lines: transfers(positive) }, undefined, DETECT_PRIVATE), "LIA-06"),
      ).toBe("amber");
    });
    it(`${keyword}: "${nearMiss}" is not`, () => {
      expect(
        stateOf(run({ lines: transfers(nearMiss) }, undefined, DETECT_PRIVATE), "LIA-06"),
      ).toBe("none_observed");
    });
  }
  it("the reference is read too, case-insensitively", () => {
    expect(
      stateOf(
        run({ lines: transfers("TRANSFER TO J SMITH", "iou") }, undefined, DETECT_PRIVATE),
        "LIA-06",
      ),
    ).toBe("amber");
    expect(
      stateOf(
        run({ lines: transfers("TRANSFER TO J SMITH", "biou") }, undefined, DETECT_PRIVATE),
        "LIA-06",
      ),
    ).toBe("none_observed");
  });
  it("punctuation separates words; a digit doesn't (ADR 0006 ruling 1)", () => {
    expect(
      stateOf(
        run({ lines: transfers("TRANSFER TO J SMITH LOAN-REPAY") }, undefined, DETECT_PRIVATE),
        "LIA-06",
      ),
    ).toBe("amber");
    expect(
      stateOf(run({ lines: transfers("TRANSFER TO LOAN4U") }, undefined, DETECT_PRIVATE), "LIA-06"),
    ).toBe("none_observed");
  });
});

describe("Ruling 2: the candidate thresholds are workspace defaults a lender can override", () => {
  it("are marked as candidates, with the ruled defaults", () => {
    expect(LIA_CANDIDATES).toEqual(["bnpl_rising", "private_large_monthly", "private_increasing"]);
    expect(LIA_DEFAULTS.bnpl_rising).toBe(0.25);
    expect(LIA_DEFAULTS.private_large_monthly).toBe(500);
    expect(LIA_DEFAULTS.private_increasing).toBe(0.25);
  });

  it("the contract (1.8.0) carries them on the policy as liability_signals", () => {
    const doc = loadContract() as { info: { version: string } };
    expect(doc.info.version).toMatch(/^1\.([8-9]|\d{2,})\./);
    const validate = schemaValidator(loadContract())("PolicyInput");
    const policy = {
      buffer: 3,
      floor_rate: 5.5,
      income_shading: {},
      card_factor: 0.03,
      expense_method: "highest_of_confirmed_benchmark_observed",
      ratio_thresholds: {},
    };
    const signals = { bnpl_rising: 0.5, private_large_monthly: 750, private_increasing: 0.3 };
    expect(validate(policy).valid).toBe(true);
    expect(validate({ ...policy, liability_signals: signals }).valid).toBe(true);
    for (const field of LIA_CANDIDATES)
      expect(
        validate({ ...policy, liability_signals: { ...signals, [field]: -1 } }).valid,
        field,
      ).toBe(false);
  });

  it("a lender's policy values become LIA config; absent ones keep the defaults", () => {
    expect(liaConfigFromPolicy(undefined)).toEqual({});
    expect(liaConfigFromPolicy(null)).toEqual({});
    expect(liaConfigFromPolicy({ private_large_monthly: 750 })).toEqual({
      private_large_monthly: 750,
    });
    expect(
      liaConfigFromPolicy({
        bnpl_rising: 0.5,
        private_large_monthly: 750,
        private_increasing: 0.3,
      }),
    ).toEqual({ bnpl_rising: 0.5, private_large_monthly: 750, private_increasing: 0.3 });
  });

  it("a lender's lower monthly mean makes LIA-06 red", () => {
    const lines = transfers("TRANSFER TO J SMITH LOAN").map((l) => ({ ...l, amount: -200 }));
    expect(stateOf(run({ lines }, undefined, DETECT_PRIVATE), "LIA-06")).toBe("amber");
    expect(
      stateOf(
        run({ lines }, undefined, {
          ...DETECT_PRIVATE,
          ...liaConfigFromPolicy({ private_large_monthly: 100 }),
        }),
        "LIA-06",
      ),
    ).toBe("red");
  });

  it("a lender's larger increase keeps a 30% rise in LIA-06 amber", () => {
    const lines: Line[] = [
      { ago: 35, description: "TRANSFER TO J SMITH LOAN", amount: -100, type: "TRANSFER_OUTGOING" },
      { ago: 5, description: "TRANSFER TO J SMITH LOAN", amount: -130, type: "TRANSFER_OUTGOING" },
    ];
    expect(stateOf(run({ lines }, undefined, DETECT_PRIVATE), "LIA-06")).toBe("red");
    expect(
      stateOf(
        run({ lines }, undefined, {
          ...DETECT_PRIVATE,
          ...liaConfigFromPolicy({ private_increasing: 0.5 }),
        }),
        "LIA-06",
      ),
    ).toBe("amber");
  });

  it("a lender's larger rise keeps one BNPL provider's rising outflow green", () => {
    const bnpl = (amount: number, first: number): Line[] =>
      repeat(
        6,
        14,
        { description: "AFTERPAY INSTALMENT", amount: -amount, category: "bnpl" },
        first,
      );
    const lines = [...bnpl(40, 100), ...bnpl(60, 5)];
    expect(stateOf(run({ lines }), "LIA-05")).toBe("red");
    expect(
      stateOf(run({ lines }, undefined, liaConfigFromPolicy({ bnpl_rising: 1 })), "LIA-05"),
    ).toBe("green");
  });
});

describe("version", () => {
  it("is 1.3.0", () => expect(LIA_VERSION).toBe("1.3.0"));
});
