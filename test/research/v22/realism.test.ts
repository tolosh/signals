// SIG-60 set v2.2: the review findings that are realism, not leakage, written before the generator
// (section 5: no "HONOUR FEE", dishonours on banking days with realistic timing, realistic and
// varied account fees; and the carried-forward checks on drift pairs and natural forms).
import { beforeAll, describe, expect, it } from "vitest";
import type { GeneratedApplicant } from "../../../src/research/generator/index.js";
import {
  accountFees,
  dishonourTiming,
  driftPairs,
  honourFee,
  isBankingDay,
  naturalForms,
} from "../../../src/research/leakage/validity.js";

const MODULE = "../../../src/research/generator/v22/index.js";
let all: GeneratedApplicant[] | null = null;
beforeAll(async () => {
  try {
    const g = (await import(/* @vite-ignore */ MODULE)) as {
      generateSetV22: (seed: number) => GeneratedApplicant[];
      SET_V22_SEED: number;
    };
    all = g.generateSetV22(g.SET_V22_SEED);
  } catch {
    all = null;
  }
}, 300_000);
const set = (): GeneratedApplicant[] => {
  expect(all, "the set v2.2 generator exists").not.toBeNull();
  return all ?? [];
};
const DAY = 86_400_000;

describe("v2.2 realism", () => {
  it("every line posts on a banking day", () => {
    const off = set().flatMap((a) =>
      a.feed.accounts.flatMap((acc) =>
        acc.transactions.filter(
          (t) => !isBankingDay(Math.floor(Date.parse(t.postingDateTime ?? "") / DAY)),
        ),
      ),
    );
    expect(off.length).toBe(0);
  });
  it("dishonours: a debit, its return 1 to 3 banking days later, the fee within 2 more", () => {
    expect(dishonourTiming(set())).toMatchObject({ pass: true });
  });
  it("no fee reads HONOUR FEE", () => {
    expect(honourFee(set())).toMatchObject({ pass: true });
  });
  it("account-keeping fees vary: 3+ amounts, 30%+ applicants with none, waived months", () => {
    expect(accountFees(set())).toMatchObject({ pass: true });
  });
  it("at least 20 distinct drift pairs", () => {
    expect(driftPairs(set())).toMatchObject({ pass: true });
  });
  it("at least 70% of the natural-declarations group's names genuinely differ", () => {
    expect(naturalForms(set())).toMatchObject({ pass: true });
  });
});
