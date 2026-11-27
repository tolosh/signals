// Observed living expenses from categorised transactions (SIG-17; Product Specification AF-E1,
// AF-E2). Debits are grouped by Enrich category into committed, basic and discretionary; own-
// account transfers, savings and debt repayments are excluded (repayments are commitments, 6.4);
// a single committed or basic debit above the one-off threshold is excluded from the average
// and listed for the officer. The category mapping and method are pre-registered in
// research/preregistrations/SIG-17.json. Pure: categories are an input (D3).
// D29 (GR-3, §9.2): health spending counts towards basic, as an aggregate only: it is never a
// one-off, an unmapped key or anything else itemised. Religious, union and political spending,
// and payees Enrich marks sensitive, are not living expenses and are removed before anything is
// read (1.1.0; set v1 has no such lines, so SIG-17's records are unchanged).
// 1.1.1 (SIG-42 re-review direction 5): on gate 1.1.0 a liability repayment is never health or
// sensitive, so a BNPL repayment with a dental MCC is a debt repayment again; the gate's version
// is recorded on the result. Set v1 has no such lines.
// 1.2.0 (SIG-81, narrow; ruling 40741, after review 18's E13): other_expenses, which Enrich classes
// essential and unverified, counts inside living expenses as its own unverified line, never as
// discretionary; and any debit LIA counts as a repayment (its liabilities' evidence, given as
// liability_repayments) is excluded as a debt repayment whatever its category, so it is never also
// a living expense. Known limit (ADR 0013): unrecognised discretionary spend such as a gym is now
// counted as essential, overstating living expenses, the conservative side for affordability.
import { SENSITIVE_METHOD_VERSION, isHealth, isSensitive } from "../sensitive.js";

export type ExpenseTransaction = {
  accountId: string;
  transactionId: string;
  merchantCategoryCode?: string;
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
  /**
   * The transaction IDs LIA counts as repayments (its liabilities' evidence). Each is excluded as
   * a debt repayment, whatever its category (1.2.0). Omitted: none.
   */
  liability_repayments?: readonly string[];
};
type Group = "committed" | "basic" | "unverified" | "discretionary";
type Exclusion = "own_account_and_savings" | "debt_repayments" | "other";

export const OBSERVED_EXPENSES_METHOD_VERSION = "1.2.0";

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
  // 1.2.0: Enrich's fallback category, classed essential and unverified (its consumer rule: never
  // treat it as discretionary).
  other_expenses: "unverified",
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
  /** The GR-3 gate applied (SENSITIVE_METHOD_VERSION). */
  gr3_gate_version: string;
  committed_monthly: number;
  basic_monthly: number;
  /** Essential spend Enrich couldn't recognise (other_expenses): inside living, unverified. */
  unverified_monthly: number;
  discretionary_monthly: number;
  /** Committed, basic and unverified: the observed component of GLE (AF-E3). */
  living_monthly: number;
  months_covered: number;
  one_offs: { transaction_id: string; date: string; amount: number; category: string }[];
  excluded: Record<Exclusion, number>;
  /** Of the debt repayments, those LIA counts that Enrich put in another category. */
  lia_repayments_in_other_categories: number;
  /** Debits with no category, or one outside the mapping; counted as discretionary. */
  unmapped: Record<string, number>;
};

export function deriveObservedExpenses(input: ObservedExpenseInput): ObservedExpenses {
  const end = dayOf(input.as_of);
  const start = lookbackStart(input.as_of, input.lookback_months);
  const totals: Record<Group, number> = { committed: 0, basic: 0, unverified: 0, discretionary: 0 };
  const liaRepayments = new Set(input.liability_repayments ?? []);
  let liaElsewhere = 0;
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
      // D29: sensitive lines other than health are removed before anything is read.
      const health = isHealth(t, input.categories);
      if (!health && isSensitive(t, input.categories)) continue;
      first = Math.min(first, day);
      const cents = Math.round(Number(t.amount) * 100);
      if (cents >= 0) continue;
      const amount = -cents / 100;
      // 1.2.0, rule 2: LIA's repayments are commitments (6.4), never living expenses.
      if (liaRepayments.has(t.transactionId)) {
        excluded.debt_repayments++;
        if (EXCLUDED[input.categories[t.transactionId] ?? "none"] !== "debt_repayments")
          liaElsewhere++;
        continue;
      }
      if (health) {
        totals.basic += amount;
        continue;
      }
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
  const unverified = monthly(totals.unverified);
  return {
    gr3_gate_version: SENSITIVE_METHOD_VERSION,
    committed_monthly: committed,
    basic_monthly: basic,
    unverified_monthly: unverified,
    discretionary_monthly: monthly(totals.discretionary),
    living_monthly: round2(committed + basic + unverified),
    months_covered: Math.round(months * 100) / 100,
    one_offs: oneOffs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    excluded,
    lia_repayments_in_other_categories: liaElsewhere,
    unmapped,
  };
}
