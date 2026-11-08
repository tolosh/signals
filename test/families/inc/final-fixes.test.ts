// SIG-41 final fixes, from the re-review at cfa9d4f (8 November 2026). INC 1.2.1.
//   1. No income stream detected: INC-09 is unverified with resolve_with, never green.
//   2. A missed pay belongs to the month of its expected date (a monthly pay due 1 September).
//   3. INC-12 cross-references INC-09 only when INC-09 is amber or red.
//   4. INC-12's evidence includes the trough month's transactions.
//   5. INC-09's reason says it judges regular income only (N-1).
import { describe, expect, it } from "vitest";
import { dayOf, isoOf } from "../../../src/engines/evidence/dates.js";
import { INC_VERSION } from "../../../src/engines/families/inc/index.js";
import { AS_OF, SALARY, STEADY, run, signal, stateOf, type Script } from "./script.js";

const END = dayOf(AS_OF);

describe("Fix 1: no income stream detected", () => {
  it("pay every 20 days passes EQ-01 but forms no stream: INC-09 is unverified with resolve_with", () => {
    // A credit every 20 days: a median gap under 35 days (EQ-01 passes), but in no cadence band,
    // so SIG-16 derives no stream. This is the reviewer's A-405 shape.
    const extra = Array.from({ length: 18 }, (_, i) => ({
      type: "TRANSFER_INCOMING",
      description: SALARY,
      postingDateTime: `${isoOf(END - 3 - 20 * i)}T02:00:00Z`,
      amount: (i === 5 ? 0.01 : 3000).toFixed(2),
    }));
    const r = run({ pays: [], extra });
    const s = signal(r, "INC-09");
    expect(s.state).toBe("unverified");
    expect(s.evidence_quality.resolve_with.length).toBeGreaterThan(0);
    expect(s.reason).not.toMatch(/Every month is at or above 60%/);
  });
});

describe("Fix 2: a missed pay belongs to the month it was due", () => {
  it("a monthly pay due on 1 September is a September miss, cross-referenced to September", () => {
    // Monthly pay on the 1st: the most recent is 1 October (30 days before 31 October).
    const s: Script = {
      pays: [{ description: SALARY, cadence: "monthly", amount: 6000, last: 30, skip: [1] }],
    };
    const r = run(s);
    expect(stateOf(r, "INC-09")).toMatch(/amber|red/);
    expect(signal(r, "INC-09").reason).toContain("Includes a missed pay on 2026-09-01; see INC-12");
    expect(signal(r, "INC-12").reason).toContain("2026-09-01");
    expect(signal(r, "INC-12").reason).toContain(
      "2026-09-01 to 2026-09-30 is a trough month in INC-09",
    );
  });
});

describe("Fix 3: INC-12 cross-references INC-09 only when INC-09 is amber or red", () => {
  it("on a 9-month history INC-09 is unverified, so INC-12 names no trough month", () => {
    // July is a real trough (one pay missed, the other cut to $500), as in the reviewer's case.
    const july = (d: number) => isoOf(d).startsWith("2026-07");
    const r = run({
      months: 9,
      pays: [{ ...STEADY, skip: [8], amount: (_, d) => (july(d) ? 500 : 3000) }],
    });
    expect(stateOf(r, "INC-09")).toBe("unverified");
    expect(stateOf(r, "INC-12")).toBe("amber");
    expect(signal(r, "INC-12").reason).not.toMatch(/trough month in INC-09/);
  });
});

describe("Fix 4: INC-12's evidence includes the trough month's transactions", () => {
  it("three July debits add three transactions to INC-12's evidence when July is a cross-referenced trough", () => {
    const julyDebits = [3, 10, 17].map((d) => ({
      type: "PAYMENT",
      description: "WOOLWORTHS SYDNEY",
      postingDateTime: `2026-07-${String(d).padStart(2, "0")}T09:00:00Z`,
      amount: "-60.00",
    }));
    const base = run({ pays: [{ ...STEADY, skip: [8] }] });
    const withDebits = run({ pays: [{ ...STEADY, skip: [8] }], extra: julyDebits });
    expect(signal(withDebits, "INC-12").reason).toMatch(
      /2026-07-01 to 2026-07-31 is a trough month in INC-09/,
    );
    expect(signal(withDebits, "INC-12").evidence_count).toBe(
      signal(base, "INC-12").evidence_count + 3,
    );
  });
});

describe("Fix 5: INC-09 says it judges regular income only (N-1)", () => {
  it("in its green and amber reasons", () => {
    expect(signal(run({ pays: [STEADY] }), "INC-09").reason).toMatch(/regular income only/);
    expect(signal(run({ pays: [{ ...STEADY, skip: [8] }] }), "INC-09").reason).toMatch(
      /regular income only/,
    );
  });
});

describe("Fix 7: the engine version", () => {
  it("is 1.2.2 (1.2.1, with the GR-3 gate versioned: SIG-42 re-review)", () =>
    expect(INC_VERSION).toBe("1.2.2"));
});
