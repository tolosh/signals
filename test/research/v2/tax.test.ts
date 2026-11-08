// SIG-54 T4: the generator computes net forward from gross with its own implementation of the ATO
// resident tax schedule and Medicare levy, from a versioned, effective-dated table checked against
// ato.gov.au. It must share no code with SIG-46's gross-up (src/engines/).
// The ATO publishes no worked net-from-gross examples for FY 2026-27, so the formula is checked
// against what the ATO does publish: the "tax on this income" amount at each threshold, and the
// Medicare levy reduction example (interpretations for ruling, research/datasets/tax-tables.md).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TAX_TABLES,
  medicareLevy,
  netFromGross,
  taxOnIncome,
  taxTable,
} from "../../../src/research/generator/tax.js";

const fy27 = taxTable("2026-27");
const fy26 = taxTable("2025-26");

describe("T4 the FY 2026-27 schedule reproduces the ATO's published amounts", () => {
  it("tax at each threshold equals the ATO's 'tax on this income' base, to the dollar", () => {
    expect(taxOnIncome(18_200, fy27)).toBe(0);
    expect(taxOnIncome(45_000, fy27)).toBe(4_020);
    expect(taxOnIncome(135_000, fy27)).toBe(31_020);
    expect(taxOnIncome(190_000, fy27)).toBe(51_370);
  });
  it("a dollar over each threshold is taxed at the next rate", () => {
    expect(taxOnIncome(18_201, fy27)).toBe(0.15);
    expect(taxOnIncome(45_001, fy27)).toBe(4_020.3);
    expect(taxOnIncome(190_001, fy27)).toBe(51_370.45);
  });
  it("negative control: the FY 2025-26 table gives the ATO's different 2025-26 bases", () => {
    expect(taxOnIncome(45_000, fy26)).toBe(4_288);
    expect(taxOnIncome(135_000, fy26)).toBe(31_288);
    expect(taxOnIncome(190_000, fy26)).toBe(51_638);
    expect(netFromGross(100_000, fy26).net_annual).not.toBe(netFromGross(100_000, fy27).net_annual);
  });
});

describe("T4 the Medicare levy reproduces the ATO's published example", () => {
  it("Angie: taxable income $29,000, single, no SAPTO: levy reduced to $98.90 (2025-26)", () => {
    expect(medicareLevy(29_000, fy26)).toBe(98.9);
  });
  it("is nil at or below the lower threshold, and 2% above the upper", () => {
    expect(medicareLevy(28_011, fy26)).toBe(0);
    expect(medicareLevy(100_000, fy27)).toBe(2_000);
  });
  it("FY 2026-27's low-income thresholds are marked provisional (not yet published by the ATO)", () => {
    expect(fy27.medicare.thresholds_provisional).toBe(true);
    expect(fy27.medicare.thresholds_income_year).toBe("2025-26");
  });
});

describe("net from gross", () => {
  it("is gross less tax less Medicare, in cents, with the table version recorded", () => {
    expect(netFromGross(100_000, fy27)).toEqual({
      gross_annual: 100_000,
      tax: 20_520,
      medicare_levy: 2_000,
      net_annual: 77_480,
      tax_table: "ato-resident-2026-27",
    });
  });
  it("every table is effective-dated and names its source", () => {
    for (const t of TAX_TABLES) {
      expect(t.effective_from).toMatch(/^\d{4}-07-01$/);
      expect(t.effective_to).toMatch(/^\d{4}-06-30$/);
      expect(t.source.url).toMatch(/^https:\/\/www\.ato\.gov\.au\//);
      expect(t.source.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("T4 static scan: the generator's tax code shares no import with src/engines/", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? files(join(dir, e.name))
        : e.name.endsWith(".ts")
          ? [join(dir, e.name)]
          : [],
    );
  it("nothing in the generator imports from src/engines/", () => {
    const offenders = files("src/research/generator").filter((f) =>
      /from\s+["'][^"']*engines\//.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
  it("nothing in src/engines/ imports the generator", () => {
    const offenders = files("src/engines").filter((f) =>
      /from\s+["'][^"']*research\//.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
