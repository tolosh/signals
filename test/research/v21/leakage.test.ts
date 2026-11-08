// SIG-54 set v2.1 (architect's direction on the set v2 review, 8 November 2026, 14:20): the
// leakage suite, written before set v2.1. Every channel is measured on set v2 as the negative
// control (it leaks, so each measure must catch it) and on set v2.1 (which must be clean).
// Set v2 (c190552d…) stays published and regenerates unchanged; it is withdrawn from experiments.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as gen from "../../../src/research/generator/index.js";
import { UNSEEN_PROVIDERS } from "../../../src/research/generator/catalog.js";
import {
  billerCodes,
  declarations,
  directDebitPrecision,
  dishonours,
  idGroupAdjacency,
  payReference,
  payerDrift,
  secondBankElsewhere,
  sequentialIds,
  topAmountsShare,
} from "./leakage.js";

type Variant = "2.0" | "2.1";
const build = (variant: Variant) => {
  // populationV2's variant argument and SET_V21_SEED arrive with generator 2.1.0.
  const seed: number =
    variant === "2.0" ? gen.SET_V2_SEED : ((gen as { SET_V21_SEED?: number }).SET_V21_SEED ?? 541);
  const population = gen.populationV2 as (s: number, v?: Variant) => gen.ApplicantSpec[];
  return population(seed, variant).map((s) => gen.generateApplicant(s, seed));
};
const v2 = build("2.0");
const v21 = build("2.1");

describe("negative control: set v2 leaks through every channel", () => {
  it("1. IDs: sequential, and neighbours share a group far above the base rate", () => {
    expect(sequentialIds(v2)).toBe(1);
    const r = idGroupAdjacency(v2);
    expect(r.observed).toBeGreaterThan(r.base + 0.5);
  });
  it("2. Type and amount: every direct debit is a repayment, at five fixed amounts", () => {
    expect(directDebitPrecision(v2)).toBe(1);
    expect(topAmountsShare(v2)).toBeGreaterThan(0.9); // the review: 5,438 of 5,740
  });
  it("3. Pay reference: PAY <date> marks pay credits exactly", () => {
    const r = payReference(v2);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
  });
  it("4. Billers: one code for every card issuer; the no-cue group reads CARDS", () => {
    const r = billerCodes(v2);
    expect(r.sharedCodes).toBeGreaterThan(0);
    expect(r.cueInNoCue).toBeGreaterThan(0);
  });
  it("5. Second-bank accounts only in the drift-across-banks group", () => {
    expect(secondBankElsewhere(v2)).toBe(0);
  });
  it("6. Declarations: case marks the group; most natural forms differ only in case and suffix", () => {
    const r = declarations(v2);
    expect(r.mixedCaseElsewhere).toBe(0);
    expect(r.genuinelyDifferentNatural).toBeLessThan(0.5);
  });
  it("8. Dishonours: one fee template, no returned debit, FEE used for nothing else", () => {
    const r = dishonours(v2);
    expect(r.feeIsDishonour).toBe(1);
    expect(r.feeAmounts).toBe(1);
    expect(r.withReturnedDebit).toBe(0);
  });
  it("9. Payer drift: 6 pairs, linked by amount", () => {
    const r = payerDrift(v2);
    expect(r.pairs).toBeLessThan(20);
    expect(r.linkedByAmount).toBeGreaterThan(0.5);
  });
});

describe("set v2.1 is clean on every channel", () => {
  it("1. IDs are opaque, and group order is shuffled", () => {
    expect(sequentialIds(v21)).toBe(0);
    const r = idGroupAdjacency(v21);
    expect(r.observed).toBeLessThan(r.base + 0.1);
  });
  it("2. Direct debits are not only repayments, and amounts are drawn per applicant", () => {
    expect(directDebitPrecision(v21)).toBeLessThan(0.6);
    expect(topAmountsShare(v21)).toBeLessThan(0.2);
  });
  it("3. A PAY reference neither marks every pay credit nor only pay credits", () => {
    const r = payReference(v21);
    expect(r.precision).toBeLessThan(0.95);
    expect(r.recall).toBeLessThan(0.8);
  });
  it("4. Each card issuer has its own biller code; no CARD cue in the no-cue group", () => {
    const r = billerCodes(v21);
    expect(r.sharedCodes).toBe(0);
    expect(r.cueInNoCue).toBe(0);
  });
  it("5. Second-bank accounts appear across groups", () => {
    expect(secondBankElsewhere(v21)).toBeGreaterThan(0.1);
  });
  it("6. Mixed-case declarations everywhere; at least 70% of natural forms genuinely differ", () => {
    const r = declarations(v21);
    expect(r.mixedCaseElsewhere).toBeGreaterThan(0.3);
    expect(r.genuinelyDifferentNatural).toBeGreaterThanOrEqual(0.7);
  });
  it("8. A dishonour is a returned debit plus a fee; fees vary, and FEE has other uses", () => {
    const r = dishonours(v21);
    expect(r.withReturnedDebit).toBe(1);
    expect(r.feeAmounts).toBeGreaterThanOrEqual(3);
    expect(r.feeIsDishonour).toBeLessThan(0.7);
  });
  it("9. At least 20 employer pairs; neither amount nor reference alone links them", () => {
    const r = payerDrift(v21);
    expect(r.pairs).toBeGreaterThanOrEqual(20);
    expect(r.linkedByAmount).toBeLessThan(0.5);
    expect(r.linkedByReference).toBeLessThan(0.5);
  });
});

describe("7. Unseen lenders appear nowhere in src/ or the tests, outside the generator", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|json)$/.test(p) ? [p] : [];
    });
  it("no unseen lender name is in engine code, mock code or tests outside test/research/", () => {
    const names = Object.values(UNSEEN_PROVIDERS).flat();
    const scanned = [...files("src"), ...files("test")]
      .map((p) => p.replace(/\\/g, "/"))
      .filter((p) => !p.startsWith("src/research/") && !p.startsWith("test/research/"));
    const hits: string[] = [];
    for (const p of scanned) {
      const text = readFileSync(p, "utf8");
      for (const n of names)
        if (new RegExp(`(?<![A-Za-z])${n}(?![A-Za-z])`, "i").test(text)) hits.push(`${p}: ${n}`);
    }
    expect(hits).toEqual([]);
  });
});

describe("10. Fixes from the review", () => {
  it("every applicant tagged overtime or bonus has that pay event (syn-v2-0073)", () => {
    for (const a of v21) {
      const kinds = new Set((a.truth.v2?.pay_events ?? []).map((e) => e.kind));
      if (a.truth.tags.includes("overtime"))
        expect(kinds.has("overtime"), a.truth.applicant_id).toBe(true);
      if (a.truth.tags.includes("bonus"))
        expect(kinds.has("bonus"), a.truth.applicant_id).toBe(true);
    }
  });
  it("gross after a pay rise or a new employer is recorded", () => {
    const changed = v21.filter(
      (a) => a.truth.tags.includes("pay-rise") || a.truth.tags.includes("new-employer"),
    );
    expect(changed.length).toBeGreaterThan(20);
    for (const a of changed) {
      const tax = a.truth.v2?.tax as { gross_annual_after_change?: number } | null | undefined;
      expect(tax?.gross_annual_after_change, a.truth.applicant_id).toBeGreaterThan(0);
    }
  });
  it("the minimums are the real values: salaried-fixed 60, mortgage-undisclosed 10", () => {
    const min = (gen as { SET_V21_MINIMUMS?: Record<string, number> }).SET_V21_MINIMUMS ?? {};
    expect(min["salaried-fixed"]).toBe(60);
    expect(min["mortgage-undisclosed"]).toBe(10);
  });
  it("the v2 generator script takes --seed and --out and never overwrites by default", () => {
    const text = readFileSync("scripts/generate-synthetic-v2.ts", "utf8");
    expect(text).toMatch(/parseRunArgs\(/);
    expect(text).toMatch(/\bseed\b.*args|args.*\bseed\b/s);
    expect(text).not.toMatch(/rmSync\(/);
  });
  it("the README says how to regenerate both sets", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toMatch(/generate-synthetic\.ts/);
    expect(readme).toMatch(/generate-synthetic-v2\.ts/);
  });
});
