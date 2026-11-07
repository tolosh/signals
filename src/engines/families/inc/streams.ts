// The income streams family 1 reads (SIG-41). The streams are SIG-16's (deriveIncome, method
// 1.0.0, with its pre-registered minimum of 3 occurrences); this module does not re-derive
// income. It types each stream (AF-I2) and links the credits that formed it, so each signal
// can cite its evidence. Interpretations N-1 to N-3 in docs/adr/0004-inc-family.md.
import {
  deriveIncome,
  normalisePayer,
  type Exclusion,
  type IncomeStream,
} from "../../affordability/income.js";
import { dayOf, lookbackStart } from "../../evidence/dates.js";
import type { Feed } from "../../evidence/types.js";
import type { IncConfig, StreamType } from "./config.js";

/** N-1: streams are found over up to 12 months, the longest history any INC signal needs. */
export const STREAM_LOOKBACK_MONTHS = 12;
const MIN_OCCURRENCES = 3;
const CYCLE_DAYS = { weekly: 7, fortnightly: 14, monthly: 30.4375 } as const;
const BSB_NUMBER = /\b\d{3}-?\d{3}\s+\d{6,10}\b/;

export type Credit = { day: number; amount: number; transactionId: string; account: string };
export type TypedStream = IncomeStream & {
  type: StreamType;
  cycle_days: number;
  /** Oldest first. */
  credits: Credit[];
  first: number;
  last: number;
};
export type Streams = {
  streams: TypedStream[];
  excluded: Record<Exclusion, number>;
  net_monthly: number;
  window: { start: number; end: number };
};

const has = (payer: string, names: readonly string[]) =>
  names.some((n) => payer.includes(normalisePayer(n)));

/** N-2: a stream's type comes from its payer name (AF-I2), against the workspace's lists. */
export function typeOf(payer: string, config: IncConfig): StreamType {
  if (has(payer, config.gig_payers)) return "gig_platform";
  if (has(payer, config.benefit_payers)) return "government_benefit";
  if (/\bCOMMISSION\b/.test(payer)) return "commission";
  if (/\b(OVERTIME|BONUS)\b/.test(payer)) return "overtime_bonus";
  if (/\b(RENT|RENTAL|PROPERTY MANAGEMENT|REAL ESTATE)\b/.test(payer)) return "rental";
  return "salary";
}

export const SALARY_LIKE: ReadonlySet<StreamType> = new Set([
  "salary",
  "overtime_bonus",
  "commission",
]);

export function streamsOf(feed: Feed, asOf: string, config: IncConfig): Streams {
  const income = deriveIncome({
    feed,
    as_of: asOf,
    lookback_months: STREAM_LOOKBACK_MONTHS,
    min_occurrences: MIN_OCCURRENCES,
  });
  const start = lookbackStart(asOf, STREAM_LOOKBACK_MONTHS);
  const end = dayOf(asOf);
  const streams = income.streams.map((s): TypedStream => {
    // N-3: a stream's credits are the credits in its accounts whose normalised narrative is its
    // payer, in the same window, that are not own-account transfers.
    const credits = feed.accounts
      .filter((a) => s.account_ids.includes(a.account.accountId))
      .flatMap((a) =>
        a.transactions.map((t) => ({
          day: dayOf(t.postingDateTime ?? t.valueDateTime ?? ""),
          amount: Number(t.amount),
          transactionId: t.transactionId,
          account: a.account.accountId,
          t,
        })),
      )
      .filter(
        (c) =>
          c.amount > 0 &&
          c.day >= start &&
          c.day <= end &&
          !BSB_NUMBER.test(c.t.description.toUpperCase()) &&
          normalisePayer(c.t.description) === s.payer,
      )
      .map((c): Credit => ({
        day: c.day,
        amount: c.amount,
        transactionId: c.transactionId,
        account: c.account,
      }))
      .sort((a, b) => a.day - b.day || (a.transactionId < b.transactionId ? -1 : 1));
    return {
      ...s,
      type: typeOf(s.payer, config),
      cycle_days: CYCLE_DAYS[s.cadence],
      credits,
      first: credits[0]?.day ?? end,
      last: credits[credits.length - 1]?.day ?? end,
    };
  });
  return {
    streams,
    excluded: income.excluded,
    net_monthly: income.net_monthly,
    window: { start, end },
  };
}
