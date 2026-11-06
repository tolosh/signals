// Net monthly income from transactions (SIG-16; Product Specification AF-I1, AF-I2, AF-I5).
// Recurring credits are grouped by normalised payer name and cadence; own-account transfers,
// refunds, loan disbursements, advances, interest and repayments received are never income.
// The method and its parameters are pre-registered in research/preregistrations/SIG-16.json.
// Pure: no clock, no randomness, relative imports only (D3).

export type IncomeTransaction = {
  accountId: string;
  transactionId: string;
  type: string;
  description: string;
  postingDateTime?: string;
  valueDateTime?: string;
  amount: string;
};
export type IncomeFeed = {
  accounts: {
    account: { accountId: string; productCategory?: string };
    detail?: unknown;
    transactions: IncomeTransaction[];
  }[];
};
export type IncomeInput = {
  feed: IncomeFeed;
  /** End of the lookback window, inclusive (YYYY-MM-DD). */
  as_of: string;
  lookback_months: number;
  min_occurrences: number;
};
export type Cadence = "weekly" | "fortnightly" | "monthly";
export type IncomeStream = {
  payer: string;
  cadence: Cadence;
  occurrences: number;
  median_amount: number;
  monthly: number;
  account_ids: string[];
};
export type Exclusion =
  | "own_account_transfer"
  | "refund"
  | "advance_or_loan"
  | "interest"
  | "repayment_received"
  | "not_a_transaction_account";
export type IncomeResult = {
  net_monthly: number;
  streams: IncomeStream[];
  excluded: Record<Exclusion, number>;
  /** Credits considered but not part of any stream (irregular, or too few). */
  unmatched_credits: number;
};

export const INCOME_METHOD_VERSION = "1.0.0";

const CADENCE_BANDS: [Cadence, number, number, number][] = [
  ["weekly", 5, 9, 52 / 12],
  ["fortnightly", 12, 16, 26 / 12],
  ["monthly", 26, 35, 1],
];
const BSB_NUMBER = /\b\d{3}-?\d{3}\s+\d{6,10}\b/;
const RULES: [Exclusion, RegExp][] = [
  ["refund", /REFUND|REVERSAL|CASHBACK/],
  [
    "advance_or_loan",
    /LOAN|ADVANCE|BEFOREPAY|MYPAYNOW|CASHD|AFTERPAY|ZIP PAY|ZIP MONEY|HUMM|KLARNA/,
  ],
  ["interest", /INTEREST/],
  ["repayment_received", /PAYMENT RECEIVED|REPAYMENT RECEIVED/],
];
const TRANSACTION_ACCOUNTS = "TRANS_AND_SAVINGS_ACCOUNTS";
const DAY_MS = 86_400_000;

const dayOf = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);
const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number) =>
  [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 30;
/** The day after the same calendar day `months` earlier, clamped to a shorter month's end. */
function lookbackStart(asOf: string, months: number): number {
  const [y = 0, m = 1, d = 1] = asOf.slice(0, 10).split("-").map(Number);
  const index = y * 12 + (m - 1) - months;
  const ty = Math.floor(index / 12);
  const tm = (index % 12) + 1;
  return Math.floor(Date.UTC(ty, tm - 1, Math.min(d, daysIn(ty, tm))) / DAY_MS) + 1;
}
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};
export const normalisePayer = (description: string) =>
  description
    .toUpperCase()
    .replace(/[^A-Z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

type Line = {
  account: string;
  category: string | undefined;
  day: number;
  cents: number;
  t: IncomeTransaction;
};

export function deriveIncome(input: IncomeInput): IncomeResult {
  const end = dayOf(input.as_of);
  const start = lookbackStart(input.as_of, input.lookback_months);
  const lines: Line[] = input.feed.accounts.flatMap((acc) =>
    acc.transactions
      .map((t) => ({
        account: acc.account.accountId,
        category: acc.account.productCategory,
        day: dayOf(t.postingDateTime ?? t.valueDateTime ?? ""),
        cents: Math.round(Number(t.amount) * 100),
        t,
      }))
      .filter((l) => Number.isFinite(l.day) && l.day >= start && l.day <= end),
  );

  const debits = new Map<string, Set<string>>();
  for (const l of lines)
    if (l.cents < 0) {
      const key = `${l.day}:${-l.cents}`;
      debits.set(key, (debits.get(key) ?? new Set()).add(l.account));
    }
  const pairedWithOtherAccount = (l: Line) =>
    [...(debits.get(`${l.day}:${l.cents}`) ?? [])].some((a) => a !== l.account);

  const excluded: Record<Exclusion, number> = {
    own_account_transfer: 0,
    refund: 0,
    advance_or_loan: 0,
    interest: 0,
    repayment_received: 0,
    not_a_transaction_account: 0,
  };
  const groups = new Map<string, Line[]>();
  for (const l of lines) {
    if (l.cents <= 0) continue;
    if (l.category !== undefined && l.category !== TRANSACTION_ACCOUNTS) {
      excluded.not_a_transaction_account++;
      continue;
    }
    const narrative = l.t.description.toUpperCase();
    if (BSB_NUMBER.test(narrative) || pairedWithOtherAccount(l)) {
      excluded.own_account_transfer++;
      continue;
    }
    const rule = RULES.find(([, re]) => re.test(narrative));
    if (rule) {
      excluded[rule[0]]++;
      continue;
    }
    const payer = normalisePayer(narrative);
    groups.set(payer, [...(groups.get(payer) ?? []), l]);
  }

  const streams: IncomeStream[] = [];
  let unmatched = 0;
  for (const [payer, group] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const days = group.map((l) => l.day).sort((a, b) => a - b);
    const gap = median(days.slice(1).map((d, i) => d - (days[i] ?? d)));
    const band = CADENCE_BANDS.find(([, lo, hi]) => gap >= lo && gap <= hi);
    if (group.length < input.min_occurrences || !band) {
      unmatched += group.length;
      continue;
    }
    const amount = median(group.map((l) => l.cents)) / 100;
    streams.push({
      payer,
      cadence: band[0],
      occurrences: group.length,
      median_amount: amount,
      monthly: Math.round(amount * band[3] * 100) / 100,
      account_ids: [...new Set(group.map((l) => l.account))].sort(),
    });
  }
  const total = streams.reduce((s, x) => s + x.monthly, 0);
  return {
    net_monthly: Math.round(total * 100) / 100,
    streams,
    excluded,
    unmatched_credits: unmatched,
  };
}
