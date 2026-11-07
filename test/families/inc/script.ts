// Scripted applicants for the SIG-41 tests: CDR-shaped feeds whose income pattern is known
// exactly, so each INC signal can be driven to a chosen state. Built here rather than through
// the SIG-12 generator, which has no knobs for falling pay, missed cycles or payer changes, and
// which stays unchanged while set v1 is under independent review.
import { dayOf, isoOf, lookbackStart } from "../../../src/engines/evidence/dates.js";
import type { Feed, FeedTransaction } from "../../../src/engines/evidence/index.js";
import {
  assessInc,
  type IncApplication,
  type IncConfig,
  type IncInput,
  type IncResult,
} from "../../../src/engines/families/inc/index.js";

export const AS_OF = "2026-10-31";
const END = dayOf(AS_OF);

export type Cadence = "weekly" | "fortnightly" | "monthly";
export type Pay = {
  /** The narrative, as the bank shows it, e.g. "SALARY ACME CONSULTING PTY LTD". */
  description: string;
  cadence: Cadence;
  /** The amount of the i-th pay, counting from the most recent (i = 0). */
  amount: number | ((i: number, day: number) => number);
  /** Days before AS_OF of the most recent pay; default 2. */
  last?: number;
  /** Pays (counting from the most recent) that are missing. */
  skip?: number[];
  /** Only pays on or after this date. */
  from?: string;
  /** Only pays on or before this date. */
  to?: string;
  account?: string;
};

const STEP: Record<Exclude<Cadence, "monthly">, number> = { weekly: 7, fortnightly: 14 };

/** Pay days, most recent first, inside the history. */
function payDays(p: Pay, start: number): number[] {
  const last = END - (p.last ?? 2);
  const lo = Math.max(start, p.from ? dayOf(p.from) : -Infinity);
  const hi = Math.min(last, p.to ? dayOf(p.to) : Infinity);
  const days: number[] = [];
  if (p.cadence === "monthly") {
    const anchor = isoOf(last);
    for (let k = 0; ; k++) {
      const d = lookbackStart(anchor, k) - 1;
      if (d < lo) break;
      days.push(d);
    }
  } else for (let d = last; d >= lo; d -= STEP[p.cadence]) days.push(d);
  return days.filter((d) => d <= hi);
}

export type Script = {
  months?: number;
  pays: Pay[];
  /** Further transactions, e.g. advances or own-account transfers. */
  extra?: (Omit<FeedTransaction, "transactionId" | "accountId"> & { account?: string })[];
  /** A second shared account, for own-account transfers between accounts in the grant. */
  second_account?: boolean;
};

const ACCOUNTS = [
  { id: "acc-pay", bsb: "062000", number: "11112222" },
  { id: "acc-save", bsb: "062000", number: "33334444" },
];

export function feed(s: Script): Feed {
  const months = s.months ?? 12;
  const start = lookbackStart(AS_OF, months);
  const tx: Record<string, FeedTransaction[]> = { "acc-pay": [], "acc-save": [] };
  let n = 0;
  const add = (account: string, t: Omit<FeedTransaction, "transactionId" | "accountId">) =>
    tx[account]?.push({
      ...t,
      accountId: account,
      transactionId: `t${String(++n).padStart(5, "0")}`,
    });
  // An opening debit on the first day, so the history starts where the script says it does.
  add("acc-pay", {
    type: "PAYMENT",
    description: "WOOLWORTHS SYDNEY",
    postingDateTime: `${isoOf(start)}T09:00:00Z`,
    amount: "-85.40",
  });
  for (const p of s.pays) {
    const days = payDays(p, start);
    days.forEach((day, i) => {
      if (p.skip?.includes(i)) return;
      const amount = typeof p.amount === "number" ? p.amount : p.amount(i, day);
      add(p.account ?? "acc-pay", {
        type: "TRANSFER_INCOMING",
        description: p.description,
        postingDateTime: `${isoOf(day)}T02:00:00Z`,
        amount: amount.toFixed(2),
      });
    });
  }
  for (const e of s.extra ?? []) {
    const { account = "acc-pay", ...t } = e;
    add(account, t);
  }
  const accounts = ACCOUNTS.filter((a) => a.id === "acc-pay" || s.second_account).map((a) => ({
    account: { accountId: a.id, productCategory: "TRANS_AND_SAVINGS_ACCOUNTS" },
    detail: { data: { bsb: a.bsb, accountNumber: a.number } },
    transactions: (tx[a.id] ?? []).sort((x, y) =>
      (x.postingDateTime ?? "") < (y.postingDateTime ?? "") ? -1 : 1,
    ),
  }));
  return { accounts };
}

export const SALARY = "SALARY ACME CONSULTING PTY LTD";
/** 12 months of steady fortnightly salary: the stable applicant (T7). */
export const STEADY: Pay = { description: SALARY, cadence: "fortnightly", amount: 3000 };

/** Bands and gross-up used where a test needs them; production defaults are in the engine. */
export const TEST_CONFIG: Partial<IncConfig> = {
  occupation_bands: { "software engineer": { min_monthly: 5000, max_monthly: 9000 } },
  policy_loan_amount: 50_000,
};
/** A stand-in for SIG-46's gross-up, so INC-02's thresholds can be tested (see ADR 0004, N-4). */
export const STUB_GROSS_UP = (netMonthly: number) => netMonthly * 1.3;

export function run(
  s: Script,
  application: IncApplication = {},
  config: Partial<IncConfig> = TEST_CONFIG,
  extra: Partial<Pick<IncInput, "lookback_months" | "gross_up">> = {},
): IncResult {
  return assessInc({
    feed: feed(s),
    feed_type: "cdr",
    as_of: AS_OF,
    lookback_months: extra.lookback_months ?? 6,
    application,
    config,
    gross_up: "gross_up" in extra ? (extra.gross_up ?? null) : STUB_GROSS_UP,
  });
}

export function signal(r: IncResult, id: string) {
  const s = r.signals.find((x) => x.id === id);
  if (!s) throw new Error(`No ${id} in the INC output`);
  return s;
}
export const stateOf = (r: IncResult, id: string) => signal(r, id).state;
