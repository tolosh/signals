// SIG-41 T2 to T7, and the rules the method names (INC-R1, INC-R2, EQ-R4, INC-06, INC-10).
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { AS_OF, SALARY, STEADY, feed, run, signal, stateOf, type Script } from "./script.js";
import { assessInc, INC_DEFAULTS } from "../../../src/engines/families/inc/index.js";
import { rollupMovers } from "../../../src/engines/rollup/index.js";

const steady: Script = { pays: [STEADY] };

describe("T2: falling pay at the same payer", () => {
  it("pay down 12% over 3 cycles makes INC-11 amber", () => {
    const r = run({ pays: [{ ...STEADY, amount: (i) => [2640, 2760, 2880][i] ?? 3000 }] });
    expect(stateOf(r, "INC-11")).toBe("amber");
    expect(signal(r, "INC-11").value).toBe("Down 12% over 3 cycles");
  });
});

describe("T3: wage advances are never income (INC-R2)", () => {
  const r = run({
    pays: [
      STEADY,
      { description: "BEFOREPAY ADVANCE", cadence: "fortnightly", amount: 150, last: 9 },
    ],
  });
  it("excludes the advance from income", () => {
    expect(r.income.map((row) => row.payer)).toEqual([SALARY]);
    expect(r.net_monthly).toBe(6500);
  });
  it("shows the exclusion in the trace", () => {
    const advances = r.trace.find((t) => t.step === "Excluded: advances and loans");
    expect(advances?.value).toBe(26);
  });
});

describe("T4: seasonality needs 12 months (EQ-R4)", () => {
  it("6 months of history makes INC-09 unverified with resolve_with", () => {
    const r = run({ months: 6, pays: [STEADY] });
    const s = signal(r, "INC-09");
    expect(s.state).toBe("unverified");
    expect(s.evidence_quality.resolve_with).toEqual(["Share 12 months of transaction history"]);
  });
});

describe("T5: payer concentration is context only", () => {
  const app = { household_earners: 1, loan_amount: 600_000 };
  it("INC-07 is amber with rollup_class context, and the roll-up is unchanged", () => {
    const flagged = run(steady, app);
    const plain = run(steady, { household_earners: 1 });
    expect(signal(flagged, "INC-07")).toMatchObject({ state: "amber", rollup_class: "context" });
    expect(stateOf(plain, "INC-07")).toBe("green");
    expect(rollupMovers(flagged.signals)).toEqual(rollupMovers(plain.signals));
  });
});

describe("T6: deterministic", () => {
  it("identical inputs give byte-identical output", () => {
    const hash = () =>
      createHash("sha256")
        .update(
          JSON.stringify(run(steady, { occupation: "Software Engineer", loan_amount: 400_000 })),
        )
        .digest("hex");
    expect(hash()).toBe(hash());
  });
});

describe("T7: negative control, a stable salaried applicant with 12 months", () => {
  const app = {
    occupation: "Software Engineer",
    stated_gross_annual: 101_400,
    household_earners: 2,
  };
  it("yields green, none_observed or context on every INC signal", () => {
    const r = run(steady, app);
    expect(r.signals).toHaveLength(13);
    const bad = r.signals.filter((s) => s.state === "amber" || s.state === "red");
    expect(bad.map((s) => `${s.id} ${s.state}: ${s.reason}`)).toEqual([]);
    expect(r.signals.filter((s) => s.state === "unverified").map((s) => s.id)).toEqual([]);
  });
  it("without the gross-up (SIG-46 on hold), only INC-02 changes, to unverified (D24)", () => {
    const r = run(steady, app, undefined, { gross_up: null });
    expect(
      r.signals
        .filter((s) => s.state !== "green" && s.state !== "none_observed")
        .map((s) => [s.id, s.state]),
    ).toEqual([["INC-02", "unverified"]]);
    expect(signal(r, "INC-02").reason).toMatch(/gross-up/);
  });
});

describe("Method rules", () => {
  it("INC-R1: variable income is shaded 20% by default, configurable, and shown in the trace", () => {
    const pays = [
      STEADY,
      { description: "UBER AUSTRALIA PTY PAYOUT", cadence: "weekly" as const, amount: 800 },
    ];
    const byDefault = run({ pays });
    const gig = byDefault.income.find((row) => row.type === "gig_platform");
    expect(gig).toMatchObject({ shading: 0.8, observed_amount: 3466.67, assessed_amount: 2773.34 });
    expect(INC_DEFAULTS.shading.gig_platform).toBe(0.8);
    const custom = run({ pays }, {}, { shading: { ...INC_DEFAULTS.shading, gig_platform: 0.75 } });
    expect(custom.income.find((row) => row.type === "gig_platform")?.shading).toBe(0.75);
  });

  it("INC-R2: BNPL inflows are not income either", () => {
    const r = run({
      pays: [STEADY, { description: "AFTERPAY REFUND CREDIT", cadence: "monthly", amount: 120 }],
    });
    expect(r.income.map((row) => row.payer)).toEqual([SALARY]);
  });

  it("INC-06 is unverified when the application has no occupation", () => {
    const s = signal(run(steady), "INC-06");
    expect(s.state).toBe("unverified");
    expect(s.evidence_quality.resolve_with).toEqual([
      "Add the applicant's occupation to the application",
    ]);
  });

  it("INC-06 is unverified when the workspace has no pay band for the occupation", () => {
    const s = signal(run(steady, { occupation: "Pilot" }), "INC-06");
    expect(s.state).toBe("unverified");
    expect(s.evidence_quality.resolve_with).toEqual([
      'Set a pay band for the occupation "pilot" in the workspace policy',
    ]);
  });

  it("INC-10 records that gig payers come from the fixture list until Enrich curates them", () => {
    const s = signal(run(steady), "INC-10");
    expect(s.confidence).toBe("medium");
    expect(s.reason).toMatch(/fixture list/);
  });

  it("stated income is used only by INC-02 (INC-R3)", () => {
    const a = run(steady, { stated_gross_annual: 101_400 });
    const b = run(steady, { stated_gross_annual: 250_000 });
    const without = (r: typeof a) => r.signals.filter((s) => s.id !== "INC-02");
    expect(without(a)).toEqual(without(b));
    expect(a.income).toEqual(b.income);
  });

  it("production defaults: no gross-up and no bands until a workspace sets them", () => {
    const r = assessInc({ feed: feed(steady), feed_type: "cdr", as_of: AS_OF });
    expect(stateOf(r, "INC-02")).toBe("unverified");
    expect(INC_DEFAULTS.occupation_bands).toEqual({});
    expect(INC_DEFAULTS.policy_loan_amount).toBeNull();
  });
});
