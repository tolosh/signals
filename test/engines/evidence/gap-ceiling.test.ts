// SIG-55 rulings, 8 November 2026 (Colin, on ADR 0002): E-9 is per feed, as built. E-10 keeps
// the relative rule (a silence over 21 days and more than 1.5 times each adjacent silence) and
// adds an absolute ceiling: any single silence over 60 days is always a gap, whatever its
// neighbours. That closes E-10's known limit, two long holes separated by one day of activity.
// All three numbers are candidates. The change alters results for affected inputs, so it is EQ
// method 3 (EQ-R6); method 2 still replays.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assessEvidence,
  EQ_METHOD_VERSION,
  EQ_THRESHOLDS,
  type EvidenceCheck,
  type Feed,
} from "../../../src/engines/evidence/index.js";
import {
  AS_OF_DATE,
  generateApplicant,
  population,
  type GeneratedApplicant,
} from "../../../src/research/generator/index.js";
import { FULL, applicant, input } from "./helpers.js";

const eq03 = (checks: EvidenceCheck[]) => {
  const c = checks.find((x) => x.id === "EQ-03");
  if (!c) throw new Error("no EQ-03");
  return c;
};
const base = applicant(FULL, "sig-55-ceiling");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const range = (from: string, to: string, every: number): string[] => {
  const out: string[] = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += every * DAY
  )
    out.push(iso(t));
  return out;
};
/** One shared account with a transaction on each of the given days, and nothing else. */
function onDays(days: string[]): GeneratedApplicant {
  const feed = base.feed as unknown as Feed;
  const [first] = feed.accounts;
  if (!first) throw new Error("no account");
  const template = first.transactions[0] as Feed["accounts"][number]["transactions"][number];
  const transactions = days.map((d, i) => ({
    ...template,
    transactionId: `d${i}`,
    postingDateTime: `${d}T00:00:00Z`,
  }));
  return {
    ...base,
    feed: { ...base.feed, accounts: [{ ...first, transactions }] },
  } as unknown as GeneratedApplicant;
}

describe("the ceiling is ruled: 60 days, with 21 and 1.5 unchanged", () => {
  it("records the three candidates, and the method is version 3", () => {
    expect(EQ_THRESHOLDS.gap_min_days).toBe(21);
    expect(EQ_THRESHOLDS.gap_rhythm_multiple).toBe(1.5);
    expect(EQ_THRESHOLDS.gap_ceiling_days).toBe(60);
    expect(EQ_METHOD_VERSION).toBe(3);
  });
});

describe("back-to-back holes (E-10's known limit, now closed)", () => {
  // Active every 3 days in May, one day of activity on 6 August, then every 3 days from
  // 13 October: two silences of 67 and 68 days, each about as long as its neighbour.
  const days = [
    ...range("2026-05-01", "2026-05-31", 3),
    "2026-08-06",
    ...range("2026-10-13", "2026-10-31", 3),
  ];
  const a = onDays(days);

  it("method 3 finds both holes; coverage makes EQ-03 fail", () => {
    const c = eq03(assessEvidence(input(a)).checks);
    expect(c.result).toBe("fail");
    expect(c.detail).toMatch(/No transactions from 2026-0[56]-\d\d to 2026-08-05/);
    expect(c.detail).toMatch(/2026-08-07 to 2026-10-12/);
  });

  it("method 2 replays its result: neither hole is found, and EQ-03 passes", () => {
    const c = eq03(assessEvidence({ ...input(a), eq_version: 2 }).checks);
    expect(c.result).toBe("pass");
    expect(c.detail).not.toMatch(/No transactions from/);
  });

  it("a single hole over 60 days between equal neighbours is partial when coverage says so", () => {
    // Every 3 days, except one 64-day silence: relative rule finds it too; coverage ~65%.
    const one = onDays([
      ...range("2026-05-01", "2026-07-10", 3),
      ...range("2026-09-12", "2026-10-31", 3),
    ]);
    expect(eq03(assessEvidence(input(one)).checks).result).toBe("partial");
  });
});

describe("the ceiling's boundary: over 60 days", () => {
  it("silences of exactly 60 days, each beside another, are not gaps", () => {
    const at60 = onDays(range("2025-11-05", "2026-10-31", 60));
    const c = eq03(assessEvidence(input(at60, 12)).checks);
    expect(c.detail).not.toMatch(/No transactions from/);
  });
  it("silences of 61 days are gaps, whatever their neighbours", () => {
    const at61 = onDays(range("2025-11-05", "2026-10-31", 61));
    const c = eq03(assessEvidence(input(at61, 12)).checks);
    expect(c.detail).toMatch(/No transactions from/);
    expect(c.result).toBe("fail");
    expect(eq03(assessEvidence({ ...input(at61, 12), eq_version: 2 }).checks).detail).not.toMatch(
      /No transactions from/,
    );
  });
});

describe("negative controls: legitimate rhythms are not gaps", () => {
  it("an account active once a month for 12 months passes a 12-month request", () => {
    const monthly = onDays(
      Array.from({ length: 12 }, (_, i) => {
        const m = ((10 + i) % 12) + 1;
        const y = i < 2 ? 2025 : 2026;
        return `${y}-${String(m).padStart(2, "0")}-15`;
      }),
    );
    const c = eq03(assessEvidence(input(monthly, 12)).checks);
    expect(c.result).toBe("pass");
    expect(c.detail).not.toMatch(/No transactions from/);
  });

  it("fortnightly pay changing to monthly, in a pay-only feed, is not a gap", () => {
    const pay = onDays([
      ...range("2026-05-01", "2026-08-06", 14),
      "2026-08-29",
      "2026-09-29",
      "2026-10-29",
    ]);
    const c = eq03(assessEvidence(input(pay)).checks);
    expect(c.result).toBe("pass");
    expect(c.detail).not.toMatch(/No transactions from/);
  });
});

describe("set v1 is unchanged by method 3", () => {
  const set = population(42).map((spec) => generateApplicant(spec, 42));
  const ctx = (a: GeneratedApplicant, lookback: number, version: 2 | 3) => {
    const c = assessEvidence({
      feed: a.feed as unknown as Feed,
      feed_type: a.truth.feed_type,
      as_of: AS_OF_DATE,
      lookback_months: lookback,
      eq_version: version,
    });
    return JSON.stringify({ ...c, eq_version: null });
  };
  const hash = (xs: string[]) => createHash("sha256").update(xs.join("\n")).digest("hex");

  it("every evidence context, apart from its eq_version, is identical under methods 2 and 3", () => {
    for (const lookback of [6, 12]) {
      expect(hash(set.map((a) => ctx(a, lookback, 3))), `lookback ${lookback}`).toBe(
        hash(set.map((a) => ctx(a, lookback, 2))),
      );
    }
  }, 120_000);
});
