// SIG-17 section 6 tests: observed living expenses from Enrich-categorised transactions
// (AF-E1, AF-E2), with the pre-registered configuration in research/preregistrations/SIG-17.json.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deriveObservedExpenses,
  type ExpenseFeed,
  type ExpenseTransaction,
} from "../../../src/engines/affordability/observed-expenses.js";
import {
  AS_OF_DATE,
  generateApplicant,
  population,
} from "../../../src/research/generator/index.js";

const prereg = JSON.parse(readFileSync("research/preregistrations/SIG-17.json", "utf8")) as {
  primary_configuration: { one_off_threshold_aud: number; lookback_months: number };
  tolerance_pct: number;
  target_share_within: number;
};
const PRIMARY = prereg.primary_configuration;

let n = 0;
const tx = (date: string, amount: number, description: string): ExpenseTransaction => ({
  accountId: "evd",
  transactionId: `t${++n}`,
  type: amount < 0 ? "PAYMENT" : "TRANSFER_INCOMING",
  description,
  postingDateTime: `${date}T00:00:00Z`,
  amount: amount.toFixed(2),
});
const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const derive = (feed: ExpenseFeed, categories: Record<string, string>) =>
  deriveObservedExpenses({ feed, categories, as_of: AS_OF_DATE, ...PRIMARY });

describe("T1 rent $2,000 and groceries $800 a month, with a $7,000 one-off holiday", () => {
  const categories: Record<string, string> = {};
  const lines: ExpenseTransaction[] = [];
  for (const m of months) {
    const rent = tx(`${m}-01`, -2000, "RENT BELLE PROPERTY");
    const shop = tx(`${m}-10`, -800, "WOOLWORTHS 1234 SYDNEY");
    categories[rent.transactionId] = "rent";
    categories[shop.transactionId] = "groceries";
    lines.push(rent, shop);
  }
  const holiday = tx("2026-08-15", -7000, "QANTAS AIRWAYS SYDNEY");
  categories[holiday.transactionId] = "transport";
  lines.push(holiday);
  const result = derive(
    { accounts: [{ account: { accountId: "evd" }, transactions: lines }] },
    categories,
  );

  it("excludes the holiday from GLE", () => {
    // Averages divide by the days covered over 30.4375 (pre-registered), so six $2,000 rents in a
    // 184-day window average about $1,985; the pass criterion is that the holiday is excluded.
    const within1pct = (x: number, y: number) => Math.abs(x - y) / y <= 0.01;
    expect(within1pct(result.committed_monthly, 2000)).toBe(true);
    expect(within1pct(result.basic_monthly, 800)).toBe(true);
    expect(within1pct(result.living_monthly, 2800)).toBe(true);
  });

  it("lists it for the officer to confirm (AF-E2)", () => {
    expect(result.one_offs).toEqual([
      {
        transaction_id: holiday.transactionId,
        date: "2026-08-15",
        amount: 7000,
        category: "transport",
      },
    ]);
  });
});

describe("T2 a $1,500 transfer to the applicant's own savings", () => {
  it("is not counted as an expense, whether categorised as a transfer or carrying a BSB", () => {
    const categories: Record<string, string> = {};
    const lines: ExpenseTransaction[] = [];
    for (const m of months) {
      const shop = tx(`${m}-10`, -800, "COLES 1234 SYDNEY");
      const save = tx(`${m}-12`, -1500, "INTERNET TRANSFER SAVINGS");
      const own = tx(`${m}-13`, -1500, "TRANSFER TO 062-000 123456");
      categories[shop.transactionId] = "groceries";
      categories[save.transactionId] = "transfer";
      categories[own.transactionId] = "groceries"; // a miscategorised own-account transfer
      lines.push(shop, save, own);
    }
    const result = derive(
      { accounts: [{ account: { accountId: "evd" }, transactions: lines }] },
      categories,
    );
    // Only the six $800 grocery debits count; the average divides by the months covered.
    expect(result.living_monthly).toBeCloseTo((800 * 6) / result.months_covered, 0);
    expect(result.excluded.own_account_and_savings).toBe(12);
  });
});

describe("T3 across fully covered applicants in set v1", () => {
  it(`at least ${prereg.target_share_within * 100}% fall within ${prereg.tolerance_pct * 100}%`, () => {
    const cache = JSON.parse(
      readFileSync("research/enrich/synthetic-v1-categories.json", "utf8"),
    ) as {
      categories: Record<string, string>;
    };
    const covered = population(42)
      .map((s) => generateApplicant(s, 42))
      .filter(
        (a) => a.truth.coverage.unshared_account_ids.length === 0 && a.truth.history.months >= 3,
      );
    expect(covered.length).toBeGreaterThan(300);
    const within = covered.filter((a) => {
      const truth = a.truth.expenses.committed_monthly + a.truth.expenses.basic_monthly;
      const derived = derive(a.feed as unknown as ExpenseFeed, cache.categories).living_monthly;
      return Math.abs(derived - truth) / truth <= prereg.tolerance_pct;
    }).length;
    expect(within / covered.length).toBeGreaterThanOrEqual(prereg.target_share_within);
  }, 120_000);
});
