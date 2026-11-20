// Australian resident tax tables for the gross-up (SIG-46; D24; AF-5): versioned, effective-dated
// data. A published version is never edited; a change is a new version with its own
// effective_from. Written from the ATO pages cited on each table (transcribed in
// research/datasets/tax-tables.md), not from the synthetic generator, which nothing here imports.

export type Bracket = { from: number; rate: number };
export type TaxTable = {
  id: string;
  /** The financial year the table covers, inclusive. */
  fy_start: string;
  fy_end: string;
  version: number;
  /** The first day this version applies; the latest version in force on as_of is used. */
  effective_from: string;
  sources: readonly string[];
  /** Marginal rates from each threshold upward. */
  brackets: readonly Bracket[];
  /** Levy: none to lower, then the lesser of shade_rate x (income - lower) and rate x income. */
  medicare: {
    rate: number;
    shade_rate: number;
    lower: number;
    upper: number;
    provisional: boolean;
  };
};

const RATES_PAGE = "https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents";
const MEDICARE_PAGE =
  "https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-for-low-income-earners";

export const TAX_TABLES: readonly TaxTable[] = Object.freeze([
  {
    id: "AU-RES-2025-26",
    fy_start: "2025-07-01",
    fy_end: "2026-06-30",
    version: 1,
    effective_from: "2025-07-01",
    sources: [`${RATES_PAGE} (2025-26)`, `${MEDICARE_PAGE} (updated 30 June 2026)`],
    brackets: [
      { from: 0, rate: 0 },
      { from: 18_200, rate: 0.16 },
      { from: 45_000, rate: 0.3 },
      { from: 135_000, rate: 0.37 },
      { from: 190_000, rate: 0.45 },
    ],
    medicare: { rate: 0.02, shade_rate: 0.1, lower: 28_011, upper: 35_013, provisional: false },
  },
  {
    id: "AU-RES-2026-27",
    fy_start: "2026-07-01",
    fy_end: "2027-06-30",
    version: 1,
    effective_from: "2026-07-01",
    sources: [
      `${RATES_PAGE} (2026-27; updated 13 August 2026)`,
      `${MEDICARE_PAGE} (2026-27 thresholds not published; the 2025-26 ones are used, provisional)`,
    ],
    brackets: [
      { from: 0, rate: 0 },
      { from: 18_200, rate: 0.15 },
      { from: 45_000, rate: 0.3 },
      { from: 135_000, rate: 0.37 },
      { from: 190_000, rate: 0.45 },
    ],
    medicare: { rate: 0.02, shade_rate: 0.1, lower: 28_011, upper: 35_013, provisional: true },
  },
]);
