// Observed living expenses from categorised transactions (SIG-17; Product Specification AF-E1,
// AF-E2). Debits are grouped by Enrich category into committed, basic and discretionary; own-
// account transfers, savings and debt repayments are excluded (repayments are commitments, 6.4);
// a single committed or basic debit above the one-off threshold is excluded from the average
// and listed for the officer. The category mapping and method are pre-registered in
// research/preregistrations/SIG-17.json. Pure: categories are an input (D3).

export type ExpenseTransaction = {
  accountId: string;
  transactionId: string;
  type: string;
  description: string;
  postingDateTime?: string;
  valueDateTime?: string;
  amount: string;
};
export type ExpenseFeed = {
  accounts: { account: { accountId: string }; transactions: ExpenseTransaction[] }[];
};
export type ObservedExpenseInput = {
  feed: ExpenseFeed;
  /** Enrich category by transaction id. */
  categories: Readonly<Record<string, string>>;
  as_of: string;
  lookback_months: number;
  one_off_threshold_aud: number;
};
type Group = "committed" | "basic" | "discretionary";
type Exclusion = "own_account_and_savings" | "debt_repayments" | "other";

export const OBSERVED_EXPENSES_METHOD_VERSION = "1.0.0";

const GROUPS: Record<string, Group> = {
  rent: "committed",
  insurance: "committed",
  utilities: "committed",
  education: "committed",
  strata: "committed",
  groceries: "basic",
  transport: "basic",
  vehicle_running: "basic",
  healthcare: "basic",
  dining_entertainment: "discretionary",
  subscriptions: "discretionary",
  clothing: "discretionary",
  general_retail: "discretionary",
  other_expenses: "discretionary",
  gambling_casino: "discretionary",
  gambling_lottery: "discretionary",
  gambling_wagering: "discretionary",
};
const EXCLUDED: Record<string, Exclusion> = {
  transfer: "own_account_and_savings",
  savings_deposit: "own_account_and_savings",
  savings_withdrawal: "own_account_and_savings",
  loan_repayment: "debt_repayments",
  mortgage: "debt_repayments",
  bnpl: "debt_repayments",
  sacc_loan: "debt_repayments",
  wage_advance: "debt_repayments",
  income: "other",
  uncategorised_credit: "other",
  crypto_atm: "other",
  crypto_exchange: "other",
  quasi_cash: "other",
  debt_collection: "other",
  fines_penalties: "other",
};
const BSB_NUMBER = /\b\d{3}-?\d{3}\s+\d{6,10}\b/;
const DAY_MS = 86_400_000;
const DAYS_PER_MONTH = 30.4375;

const dayOf = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);
const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number) =>
  [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 30;
function lookbackStart(asOf: string, months: number): number {
  const [y = 0, m = 1, d = 1] = asOf.slice(0, 10).split("-").map(Number);
  const index = y * 12 + (m - 1) - months;
  const ty = Math.floor(index / 12);
  const tm = (index % 12) + 1;
  return Math.floor(Date.UTC(ty, tm - 1, Math.min(d, daysIn(ty, tm))) / DAY_MS) + 1;
}
const round2 = (x: number) => Math.round(x * 100) / 100;

export type ObservedExpenses = {
  committed_monthly: number;
  basic_monthly: number;
  discretionary_monthly: number;
  /** Committed plus basic: the observed component of GLE (AF-E3). */
  living_monthly: number;
  months_covered: number;
  one_offs: { transaction_id: string; date: string; amount: number; category: string }[];
  excluded: Record<Exclusion, number>;
  /** Debits with no category, or one outside the mapping; counted as discretionary. */
  unmapped: Record<string, number>;
};

export function deriveObservedExpenses(input: ObservedExpenseInput): ObservedExpenses {
  const end = dayOf(input.as_of);
  const start = lookbackStart(input.as_of, input.lookback_months);
  const totals: Record<Group, number> = { committed: 0, basic: 0, discretionary: 0 };
  const excluded: Record<Exclusion, number> = {
    own_account_and_savings: 0,
    debt_repayments: 0,
    other: 0,
  };
  const unmapped: Record<string, number> = {};
  const oneOffs: ObservedExpenses["one_offs"] = [];
  let first = Infinity;

  for (const acc of input.feed.accounts)
    for (const t of acc.transactions) {
      const day = dayOf(t.postingDateTime ?? t.valueDateTime ?? "");
      if (!Number.isFinite(day) || day < start || day > end) continue;
      first = Math.min(first, day);
      const cents = Math.round(Number(t.amount) * 100);
      if (cents >= 0) continue;
      const amount = -cents / 100;
      if (BSB_NUMBER.test(t.description)) {
        excluded.own_account_and_savings++;
        continue;
      }
      const category = input.categories[t.transactionId] ?? "none";
      const exclusion = EXCLUDED[category];
      if (exclusion) {
        excluded[exclusion]++;
        continue;
      }
      const group = GROUPS[category];
      if (!group) {
        unmapped[category] = (unmapped[category] ?? 0) + 1;
        totals.discretionary += amount;
        continue;
      }
      if (group !== "discretionary" && amount > input.one_off_threshold_aud) {
        oneOffs.push({
          transaction_id: t.transactionId,
          date: (t.postingDateTime ?? t.valueDateTime ?? "").slice(0, 10),
          amount,
          category,
        });
        continue;
      }
      totals[group] += amount;
    }

  const months = Number.isFinite(first) ? (end - first + 1) / DAYS_PER_MONTH : 0;
  const monthly = (x: number) => (months > 0 ? round2(x / months) : 0);
  const committed = monthly(totals.committed);
  const basic = monthly(totals.basic);
  return {
    committed_monthly: committed,
    basic_monthly: basic,
    discretionary_monthly: monthly(totals.discretionary),
    living_monthly: round2(committed + basic),
    months_covered: Math.round(months * 100) / 100,
    one_offs: oneOffs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    excluded,
    unmapped,
  };
}
