// Family 3 LIA fixtures for the mock (SIG-42): asm_liabilities carries the six LIA signals,
// computed by the real engine from a synthetic scripted feed, so the fixture cannot drift from the
// code. The applicant is salaried and declares one personal loan, SocietyOne, repaid on time.
// LIA 1.2.0 output:
//   LIA-01 amber, 3 undisclosed: an NAB card repaid by BPAY ($180 a month), Afterpay ($130) and
//     Zip ($97.50), $407.50 a month in all; the assessed surplus isn't read (review ruling 1);
//   LIA-02 amber: a lender (Plenti) paid out a loan 40 days ago;
//   LIA-05 amber: two BNPL providers, $227.50 a month, the same figures as in LIA-01;
//   LIA-03 and LIA-04 none_observed; LIA-06 unverified, parked (review ruling 2).
// No real data.
import { dayOf, isoOf } from "../engines/evidence/dates.js";
import { assessLia, type LiaFeed } from "../engines/families/lia/index.js";

type Json = Record<string, unknown>;
const AS_OF = "2026-10-31";
const END = dayOf(AS_OF);
const START = END - 364;

function scripted(): { feed: LiaFeed; categories: Record<string, string> } {
  const tx: LiaFeed["accounts"][number]["transactions"] = [];
  const categories: Record<string, string> = {};
  let n = 0;
  const add = (
    day: number,
    description: string,
    amount: number,
    category?: string,
    billerName?: string,
  ) => {
    const id = `txn_lia_${String(++n).padStart(4, "0")}`;
    if (category) categories[id] = category;
    tx.push({
      accountId: "acc_lia_pay",
      transactionId: id,
      type: amount > 0 ? "TRANSFER_INCOMING" : "PAYMENT",
      description,
      postingDateTime: `${isoOf(day)}T02:00:00Z`,
      amount: amount.toFixed(2),
      ...(billerName ? { billerName } : {}),
    });
  };
  add(START, "WOOLWORTHS SYDNEY", -85.4, "groceries");
  for (let d = END - 2; d >= START; d -= 14) add(d, "SALARY ACME CONSULTING PTY LTD", 3000);
  for (let d = END - 3; d >= START; d -= 7) add(d, "COLES 4729 PARRAMATTA", -140, "groceries");
  for (let d = END - 5; d >= START; d -= 30)
    add(d, "SOCIETYONE LOAN REPAYMENT", -450, "loan_repayment");
  for (let d = END - 9; d >= END - 160; d -= 30)
    add(d, "BPAY NAB CREDIT CARD PAYMENT", -180, "transfer", "NAB CREDIT CARD PAYMENT");
  for (let d = END - 4; d >= END - 160; d -= 14) add(d, "AFTERPAY INSTALMENT", -60, "bnpl");
  for (let d = END - 6; d >= END - 160; d -= 14) add(d, "ZIP PAY INSTALMENT", -45, "bnpl");
  add(END - 40, "PLENTI LOAN DISBURSEMENT", 2000);
  tx.sort((a, b) => ((a.postingDateTime ?? "") < (b.postingDateTime ?? "") ? -1 : 1));
  return {
    feed: {
      accounts: [
        {
          account: { accountId: "acc_lia_pay", productCategory: "TRANS_AND_SAVINGS_ACCOUNTS" },
          detail: { data: { bsb: "062000", accountNumber: "11112222" } },
          transactions: tx,
        },
      ],
    },
    categories,
  };
}

/** The LIA result for the scripted applicant, in the contract's shapes. */
export const liaResult = () => {
  const { feed, categories } = scripted();
  return assessLia({
    feed,
    feed_type: "cdr",
    as_of: AS_OF,
    lookback_months: 6,
    categories,
    application: {
      declared_liabilities: [
        { type: "personal_loan", provider: "SocietyOne", repayment_monthly: 450 },
      ],
      assessed_surplus_monthly: 2400,
    },
  });
};

/** asm_liabilities: the AF-T1 assessment with its signals replaced by the six LIA signals. */
export function liabilitiesAssessment<T extends Json>(base: T): T & { signals: Json[] } {
  return {
    ...base,
    id: "asm_liabilities",
    applicant_id: "apl_assessed",
    signals: liaResult().signals as unknown as Json[],
  };
}
