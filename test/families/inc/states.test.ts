// SIG-41 T1: for each of INC-01 to INC-13, a scripted applicant at each state the signal defines
// yields that state (Amendment 2 §4.1; Product Specification §7.2). Context signals define fewer
// states: INC-07 has no red, and INC-08 has neither amber nor red (they are n/a in the spec).
import { describe, expect, it } from "vitest";
import { SALARY, STEADY, run, stateOf, type Pay, type Script } from "./script.js";
import type { IncApplication } from "../../../src/engines/families/inc/index.js";

const NEW_EMPLOYER = "SALARY HARBOUR LOGISTICS";
const UBER = "UBER AUSTRALIA PTY PAYOUT";
const BENEFIT = "SALARY SERVICES AUSTRALIA";
const winter = (day: number) => {
  const m = new Date(day * 86_400_000).getUTCMonth() + 1;
  return m >= 6 && m <= 8;
};
const s = (...pays: Pay[]): Script => ({ pays });
const own = (amount: number): Script => ({
  pays: [STEADY],
  second_account: true,
  extra: [
    "2026-05-20",
    "2026-06-20",
    "2026-07-20",
    "2026-08-20",
    "2026-09-20",
    "2026-10-20",
  ].flatMap((d) => [
    {
      account: "acc-save",
      type: "TRANSFER_OUTGOING",
      description: "TRANSFER TO EVERYDAY",
      postingDateTime: `${d}T03:00:00Z`,
      amount: (-amount).toFixed(2),
    },
    {
      account: "acc-pay",
      type: "TRANSFER_INCOMING",
      description: "SALARY TOP UP FROM SAVINGS",
      postingDateTime: `${d}T03:00:00Z`,
      amount: amount.toFixed(2),
    },
  ]),
});

type Case = [id: string, state: string, script: Script, application?: IncApplication];
const CASES: Case[] = [
  ["INC-01", "green", s(STEADY)],
  ["INC-01", "amber", s({ ...STEADY, amount: (i) => (i % 2 ? 3000 : 3800) })],
  ["INC-01", "red", s({ ...STEADY, last: 25 })],

  ["INC-02", "green", s(STEADY), { stated_gross_annual: 101_400 }],
  ["INC-02", "amber", s(STEADY), { stated_gross_annual: 116_610 }],
  ["INC-02", "red", s(STEADY), { stated_gross_annual: 140_000 }],

  ["INC-03", "green", s(STEADY)],
  ["INC-03", "amber", s(STEADY, { description: UBER, cadence: "weekly", amount: 800 })],
  [
    "INC-03",
    "red",
    s({ description: BENEFIT, cadence: "fortnightly", amount: 900 }),
    { loan_amount: 30_000 },
  ],

  ["INC-04", "green", s(STEADY)],
  [
    "INC-04",
    "amber",
    s(
      { ...STEADY, to: "2026-08-25" },
      { ...STEADY, description: NEW_EMPLOYER, from: "2026-09-01" },
    ),
  ],
  [
    "INC-04",
    "red",
    s(
      { ...STEADY, to: "2026-08-25" },
      { ...STEADY, description: NEW_EMPLOYER, from: "2026-09-01" },
    ),
    { loan_amount: 80_000 },
  ],

  ["INC-05", "none_observed", s(STEADY)],
  ["INC-05", "amber", own(100)],
  ["INC-05", "red", own(500)],

  ["INC-06", "green", s(STEADY), { occupation: "Software Engineer" }],
  ["INC-06", "amber", s({ ...STEADY, amount: 2000 }), { occupation: "Software Engineer" }],
  [
    "INC-06",
    "red",
    s({ description: UBER, cadence: "weekly", amount: 800 }),
    { occupation: "Software Engineer" },
  ],

  ["INC-07", "green", s(STEADY), { household_earners: 1 }],
  ["INC-07", "amber", s(STEADY), { household_earners: 1, loan_amount: 600_000 }],

  ["INC-08", "green", s(STEADY)],
  ["INC-08", "green", s(STEADY, { description: UBER, cadence: "weekly", amount: 800 })],

  ["INC-09", "green", s(STEADY)],
  ["INC-09", "amber", s({ ...STEADY, amount: (_, day) => (winter(day) ? 1000 : 3000) })],
  [
    "INC-09",
    "red",
    s({ ...STEADY, amount: (_, day) => (winter(day) ? 1000 : 3000) }),
    { proposed_repayment_monthly: 3500 },
  ],

  ["INC-10", "green", s(STEADY)],
  ["INC-10", "amber", s(STEADY, { description: UBER, cadence: "weekly", amount: 800 })],
  [
    "INC-10",
    "red",
    s(
      { ...STEADY, amount: 1000 },
      { description: UBER, cadence: "weekly", amount: (i) => 800 + 20 * i },
    ),
  ],

  ["INC-11", "green", s(STEADY)],
  ["INC-11", "amber", s({ ...STEADY, amount: (i) => [2640, 2760, 2880][i] ?? 3000 })],
  ["INC-11", "red", s({ ...STEADY, amount: (i) => [2100, 2400, 2700][i] ?? 3000 })],

  ["INC-12", "green", s(STEADY)],
  ["INC-12", "amber", s({ ...STEADY, skip: [8] })],
  ["INC-12", "red", s({ ...STEADY, skip: [2] })],
  ["INC-12", "red", s({ ...STEADY, skip: [8, 10] })],

  ["INC-13", "green", s(STEADY)],
  [
    "INC-13",
    "amber",
    s(
      { ...STEADY, to: "2026-08-15" },
      { description: SALARY, cadence: "monthly", amount: 6500, from: "2026-08-28" },
    ),
  ],
  [
    "INC-13",
    "red",
    s(
      { ...STEADY, to: "2026-08-20" },
      { ...STEADY, description: NEW_EMPLOYER, amount: 2400, from: "2026-09-01" },
    ),
  ],
];

describe("T1: every scripted INC pattern yields its expected state", () => {
  it.each(CASES.map((c, n) => [`${c[0]} ${c[1]} (#${n})`, ...c] as const))(
    "%s",
    (_label, id, state, script, application) => {
      expect(stateOf(run(script, application), id)).toBe(state);
    },
  );

  it("covers all 13 INC signals", () => {
    expect(new Set(CASES.map((c) => c[0])).size).toBe(13);
  });
});
