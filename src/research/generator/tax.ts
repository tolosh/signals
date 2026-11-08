// SIG-54: the generator's own forward tax calculation, gross to net, for set v2. Gross is the
// primary input; net follows through the ATO resident tax schedule and the Medicare levy, the
// direction the ATO publishes. This file is independent of SIG-46's gross-up in src/engines/: it
// imports nothing from there, and nothing there imports it (test/research/v2/tax.test.ts), so
// SIG-46's T2 tests the method, not the generator.
// Interpretations for ruling (research/datasets/tax-tables.md): taxable income is gross (no
// deductions, so the $1,000 instant work-expense deduction is not applied); no tax offsets (the
// low income tax offset is not applied); FY 2026-27's Medicare low-income thresholds are not yet
// published by the ATO, so 2025-26's are used and marked provisional.

export type TaxTable = {
  id: string;
  income_year: string;
  effective_from: string;
  effective_to: string;
  /** Marginal rates: each applies to income above `over`, up to the next bracket. */
  brackets: { over: number; rate: number }[];
  medicare: {
    rate: number;
    /** Single, no SAPTO: nil at or below `lower`; 10c per dollar over `lower` up to `upper`. */
    low_income_lower: number;
    low_income_upper: number;
    shade_in_rate: number;
    thresholds_income_year: string;
    thresholds_provisional: boolean;
  };
  source: { url: string; page_updated: string; checked: string; medicare_url: string };
};

const RATES_URL = "https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents";
const MEDICARE_URL =
  "https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-for-low-income-earners";

export const TAX_TABLES: readonly TaxTable[] = Object.freeze([
  {
    id: "ato-resident-2026-27",
    income_year: "2026-27",
    effective_from: "2026-07-01",
    effective_to: "2027-06-30",
    brackets: [
      { over: 18_200, rate: 0.15 },
      { over: 45_000, rate: 0.3 },
      { over: 135_000, rate: 0.37 },
      { over: 190_000, rate: 0.45 },
    ],
    medicare: {
      rate: 0.02,
      low_income_lower: 28_011,
      low_income_upper: 35_013,
      shade_in_rate: 0.1,
      thresholds_income_year: "2025-26",
      thresholds_provisional: true,
    },
    source: {
      url: RATES_URL,
      page_updated: "2026-08-13",
      checked: "2026-11-08",
      medicare_url: MEDICARE_URL,
    },
  },
  {
    id: "ato-resident-2025-26",
    income_year: "2025-26",
    effective_from: "2025-07-01",
    effective_to: "2026-06-30",
    brackets: [
      { over: 18_200, rate: 0.16 },
      { over: 45_000, rate: 0.3 },
      { over: 135_000, rate: 0.37 },
      { over: 190_000, rate: 0.45 },
    ],
    medicare: {
      rate: 0.02,
      low_income_lower: 28_011,
      low_income_upper: 35_013,
      shade_in_rate: 0.1,
      thresholds_income_year: "2025-26",
      thresholds_provisional: false,
    },
    source: {
      url: RATES_URL,
      page_updated: "2026-08-13",
      checked: "2026-11-08",
      medicare_url: MEDICARE_URL,
    },
  },
]);

export function taxTable(incomeYear: string): TaxTable {
  const t = TAX_TABLES.find((x) => x.income_year === incomeYear);
  if (!t) throw new Error(`No tax table for ${incomeYear}`);
  return t;
}

const cents = (dollars: number) => Math.round(dollars * 100);

/** Tax on a whole-dollar taxable income, in dollars to the cent, before the Medicare levy. */
export function taxOnIncome(taxable: number, table: TaxTable): number {
  const income = Math.floor(taxable);
  let total = 0;
  table.brackets.forEach((b, i) => {
    const top = table.brackets[i + 1]?.over ?? Infinity;
    if (income > b.over) total += cents((Math.min(income, top) - b.over) * b.rate);
  });
  return total / 100;
}

/** The Medicare levy for a single taxpayer not entitled to SAPTO. */
export function medicareLevy(taxable: number, table: TaxTable): number {
  const income = Math.floor(taxable);
  const m = table.medicare;
  if (income <= m.low_income_lower) return 0;
  if (income <= m.low_income_upper)
    return (
      Math.min(cents((income - m.low_income_lower) * m.shade_in_rate), cents(income * m.rate)) / 100
    );
  return cents(income * m.rate) / 100;
}

export type NetFromGross = {
  gross_annual: number;
  tax: number;
  medicare_levy: number;
  net_annual: number;
  tax_table: string;
};

export function netFromGross(grossAnnual: number, table: TaxTable): NetFromGross {
  const tax = taxOnIncome(grossAnnual, table);
  const medicare_levy = medicareLevy(grossAnnual, table);
  return {
    gross_annual: grossAnnual,
    tax,
    medicare_levy,
    net_annual: (cents(grossAnnual) - cents(tax) - cents(medicare_levy)) / 100,
    tax_table: table.id,
  };
}
