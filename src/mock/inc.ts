// Family 1 INC fixtures for the mock (SIG-41): asm_income carries all 13 INC signals, computed by
// the real engine from a synthetic scripted feed, so the fixture cannot drift from the code. The
// applicant is salaried with weekly gig income on top: INC-03 and INC-10 are amber; INC-02 is
// unverified, because the gross-up (SIG-46) is on hold (D24). No real data.
import { dayOf, isoOf } from "../engines/evidence/dates.js";
import type { Feed, FeedTransaction } from "../engines/evidence/index.js";
import { assessInc } from "../engines/families/inc/index.js";

type Json = Record<string, unknown>;
const AS_OF = "2026-10-31";
const END = dayOf(AS_OF);
const START = END - 364;

function feed(): Feed {
  const tx: FeedTransaction[] = [];
  let n = 0;
  const add = (day: number, description: string, amount: number) =>
    tx.push({
      accountId: "acc_inc_pay",
      transactionId: `txn_inc_${String(++n).padStart(4, "0")}`,
      type: amount > 0 ? "TRANSFER_INCOMING" : "PAYMENT",
      description,
      postingDateTime: `${isoOf(day)}T02:00:00Z`,
      amount: amount.toFixed(2),
    });
  add(START, "WOOLWORTHS SYDNEY", -85.4);
  for (let d = END - 2; d >= START; d -= 14) add(d, "SALARY ACME CONSULTING PTY LTD", 3000);
  for (let d = END - 4; d >= START; d -= 7) add(d, "UBER AUSTRALIA PTY PAYOUT", 800);
  tx.sort((a, b) => ((a.postingDateTime ?? "") < (b.postingDateTime ?? "") ? -1 : 1));
  return {
    accounts: [
      {
        account: { accountId: "acc_inc_pay", productCategory: "TRANS_AND_SAVINGS_ACCOUNTS" },
        detail: { data: { bsb: "062000", accountNumber: "11112222" } },
        transactions: tx,
      },
    ],
  };
}

/** The INC result for the scripted applicant, in the contract's shapes. */
export const incResult = () =>
  assessInc({
    feed: feed(),
    feed_type: "cdr",
    as_of: AS_OF,
    lookback_months: 6,
    application: {
      occupation: "Software Engineer",
      stated_gross_annual: 101_400,
      loan_amount: 450_000,
      household_earners: 2,
    },
    config: {
      occupation_bands: { "software engineer": { min_monthly: 5000, max_monthly: 12000 } },
    },
  });

/** asm_income: the AF-T1 assessment with its signals replaced by the 13 INC signals. */
export function incomeAssessment<T extends Json>(base: T): T & { signals: Json[] } {
  return {
    ...base,
    id: "asm_income",
    applicant_id: "apl_assessed",
    signals: incResult().signals as unknown as Json[],
  };
}
