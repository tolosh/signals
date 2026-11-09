// SIG-41 ruling of 8 November 2026 (Colin), replacing ruling 1: INC-09 and INC-12 both fire,
// cross-referenced. INC-09 judges the income actually received in each of the last 12 months
// against the 12-month average of actual income (Amendment 2 §4.1), with no add-back. When a trough
// month contains a pay INC-12 reports as missed, INC-09's reason says "Includes a missed pay on
// <date>; see INC-12", and INC-12's reason names that month. Neither changes the other's state.
// Every probe from both independent reviews (b3bd9a5 and 7a25f34) is here, judged by a plain oracle.
// The oracle applies D25: each month's ratio to the average is rounded to 2 dp, halves up, before
// the 60% test, as the engine does. It sums every pay credit, which for these scripted pays is the
// same as the regular income INC-09 reads (N-1: the family reads SIG-16's streams only).
import { describe, expect, it } from "vitest";
import { dayOf, isoOf, lookbackStart } from "../../../src/engines/evidence/dates.js";
import { INC_VERSION } from "../../../src/engines/families/inc/index.js";
import { AS_OF, STEADY, feed, run, signal, stateOf, type Pay, type Script } from "./script.js";

const END = dayOf(AS_OF);
const round2 = (x: number) => Math.round(x * 100) / 100;

/** The plain rule, independently: actual credits per month against the 12-month average. */
function oracle(s: Script, repayment: number | null = null): "green" | "amber" | "red" {
  const credits = feed(s)
    .accounts.flatMap((a) => a.transactions)
    .filter((t) => Number(t.amount) > 0)
    .map((t) => ({ day: dayOf(t.postingDateTime ?? ""), amount: Number(t.amount) }));
  const months = Array.from({ length: 12 }, (_, k) => {
    const from = lookbackStart(AS_OF, k + 1);
    const to = lookbackStart(AS_OF, k) - 1;
    return credits.filter((c) => c.day >= from && c.day <= to).reduce((t, c) => t + c.amount, 0);
  });
  const average = months.reduce((t, m) => t + m, 0) / 12;
  const troughs = months.filter((m) => average > 0 && round2(m / average) < 0.6);
  if (repayment !== null && troughs.some((m) => m < repayment)) return "red";
  return troughs.length > 0 ? "amber" : "green";
}
/** Index (from the most recent) of every STEADY fortnightly pay falling in a calendar month. */
const paysIn = (month: string, step = 14, last = END - 2) =>
  Array.from({ length: 30 }, (_, i) => i).filter((i) => isoOf(last - step * i).startsWith(month));
const inMonth = (month: string) => (day: number) => isoOf(day).startsWith(month);
const expectPlain = (s: Script, repayment: number | null = null) => {
  const r = run(s, repayment === null ? {} : { proposed_repayment_monthly: repayment });
  expect(stateOf(r, "INC-09")).toBe(oracle(s, repayment));
  return r;
};

describe("8 November ruling: a missed pay alone makes both signals amber, cross-referenced", () => {
  it("one missed fortnightly pay: INC-12 amber, INC-09 amber, and each points at the other", () => {
    const [missedIndex] = paysIn("2026-07").slice(-1);
    const missedDay = isoOf(END - 2 - 14 * (missedIndex ?? 0));
    const r = run({ pays: [{ ...STEADY, skip: [missedIndex ?? -1] }] });
    expect(stateOf(r, "INC-12")).toBe("amber");
    expect(stateOf(r, "INC-09")).toBe("amber");
    expect(signal(r, "INC-09").reason).toContain(
      `Includes a missed pay on ${missedDay}; see INC-12`,
    );
    expect(signal(r, "INC-12").reason).toMatch(
      /2026-07-01 to 2026-07-31 is a trough month in INC-09/,
    );
  });

  it("a trough with no missed pay in it carries no cross-reference", () => {
    const s = {
      pays: [{ ...STEADY, amount: (_: number, d: number) => (inMonth("2026-07")(d) ? 900 : 3000) }],
    };
    const r = run(s);
    expect(stateOf(r, "INC-09")).toBe("amber");
    expect(signal(r, "INC-09").reason).not.toMatch(/see INC-12/);
    expect(stateOf(r, "INC-12")).toBe("green");
  });
});

describe("8 November ruling: every real trough is amber or red, whatever pays were missed", () => {
  const julyMissed = paysIn("2026-07").slice(-1);

  it("first review: July cut to $1,000 with one missed pay is amber; with a $2,500 repayment, red", () => {
    const s = (remaining: number): Script => ({
      pays: [
        {
          ...STEADY,
          skip: julyMissed,
          amount: (_, d) => (inMonth("2026-07")(d) ? remaining : 3000),
        },
      ],
    });
    expect(stateOf(expectPlain(s(1000)), "INC-09")).toBe("amber");
    expect(stateOf(expectPlain(s(1000), 2500), "INC-09")).toBe("red");
    for (const remaining of [700, 1500])
      expect(stateOf(expectPlain(s(remaining)), "INC-09")).toBe("amber");
  });

  it("second review (a): one missed pay, a sweep of the remaining July pay from $500 to $3,000", () => {
    for (let remaining = 500; remaining <= 3000; remaining += 25)
      expectPlain({
        pays: [
          {
            ...STEADY,
            skip: julyMissed,
            amount: (_, d) => (inMonth("2026-07")(d) ? remaining : 3000),
          },
        ],
      });
    // The band the re-review found hidden, $1,835 to $1,875, is now judged on actual income.
    for (const remaining of [1835, 1855, 1875])
      expectPlain({
        pays: [
          {
            ...STEADY,
            skip: julyMissed,
            amount: (_, d) => (inMonth("2026-07")(d) ? remaining : 3000),
          },
        ],
      });
  });

  it("second review (b): several pays missed in one month", () => {
    const weekly: Pay = { ...STEADY, cadence: "weekly", amount: 1500 };
    const julyWeekly = paysIn("2026-07", 7);
    const weeklyCase: Script = {
      pays: [
        {
          ...weekly,
          skip: julyWeekly.slice(0, 2),
          amount: (_, d) => (inMonth("2026-07")(d) ? 730 : 1500),
        },
      ],
    };
    expect(stateOf(expectPlain(weeklyCase), "INC-09")).toBe("amber");
    // A month with three fortnightly pays, two of them missed.
    const three = [
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]
      .map((m) => ({ m, idx: paysIn(m) }))
      .find((x) => x.idx.length === 3);
    if (!three) throw new Error("no month with three fortnightly pays");
    for (const remaining of [1160, 1175, 1190]) {
      const s: Script = {
        pays: [
          {
            ...STEADY,
            skip: three.idx.slice(0, 2),
            amount: (_, d) => (inMonth(three.m)(d) ? remaining : 3000),
          },
        ],
      };
      expect(stateOf(expectPlain(s), "INC-09")).toBe("amber");
    }
  });

  it("second review (c): three pays missed 7 to 8 months ago, and a genuine July dip", () => {
    const early = [...paysIn("2026-03"), ...paysIn("2026-04")].slice(0, 3);
    for (const julyPay of [1650, 1760, 1870])
      expectPlain({
        pays: [
          { ...STEADY, skip: early, amount: (_, d) => (inMonth("2026-07")(d) ? julyPay : 3000) },
        ],
      });
  });

  it("second review: alternating $4,500 and $1,500 pay with one missed, and a pay missed in the first fortnight", () => {
    expectPlain({ pays: [{ ...STEADY, skip: [8], amount: (i) => (i % 2 ? 1500 : 4500) }] });
    const firstFortnight = Array.from({ length: 30 }, (_, i) => i).filter(
      (i) =>
        END - 2 - 14 * i >= lookbackStart(AS_OF, 12) &&
        END - 2 - 14 * i < lookbackStart(AS_OF, 12) + 14,
    );
    expectPlain({ pays: [{ ...STEADY, skip: firstFortnight }] });
  });

  it("a $0 month 7 months ago makes INC-09 amber", () => {
    const april = paysIn("2026-04");
    expect(april.length).toBeGreaterThan(0);
    const r = expectPlain({ pays: [{ ...STEADY, skip: april }] });
    expect(stateOf(r, "INC-09")).toBe("amber");
  });

  it("pays missed 8, 11, 12 and 13 months ago are judged on actual income, never ignored", () => {
    for (const monthsAgo of [8, 11, 12, 13]) {
      const day = lookbackStart(AS_OF, monthsAgo) + 10;
      const idx = Array.from({ length: 30 }, (_, i) => i).find(
        (i) => Math.abs(END - 2 - 14 * i - day) < 7,
      );
      expectPlain({ pays: [{ ...STEADY, skip: [idx ?? -1] }] });
    }
  });
});

describe("8 November ruling: the engine version", () => {
  it("is 1.2.2 (1.2.1's fixes, with the GR-3 gate versioned: SIG-42 re-review)", () => {
    expect(INC_VERSION).toBe("1.2.2");
  });
});
