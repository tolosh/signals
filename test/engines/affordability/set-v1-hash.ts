// SIG-42 ruling 3 (10 November 2026, 06:39): observed income and observed expenses keep their
// versions under GR-3 gate 1.2.0, provided replay tests pin both versions. These hashes cover the
// whole result of each method for every set v1 applicant (a 6-month request, with the committed
// category cache), with the gate's version field taken out so the same hash can be taken at gate
// 1.1.0; the gate versions the results carry are returned beside the hash, for the test to pin.
// (The methods' own versions are constants, not result fields; the test pins those.)
import { createHash } from "node:crypto";
import { deriveIncome } from "../../../src/engines/affordability/income.js";
import { deriveObservedExpenses } from "../../../src/engines/affordability/observed-expenses.js";
import { AS_OF_DATE } from "../../../src/research/generator/index.js";
import { loadSet } from "../../../src/research/liabilities-score.js";

type RawAccount = {
  account: { accountId: string; productCategory?: string };
  transactionList: { data: { transactions: never[] } };
};

export function setV1Replay() {
  const set = loadSet();
  const income = createHash("sha256");
  const expenses = createHash("sha256");
  const versions = { income: new Set<string>(), expenses: new Set<string>() };
  const strip = (r: object) => {
    const rest: Record<string, unknown> = { ...r };
    const v = String(rest.gr3_gate_version);
    delete rest.gr3_gate_version;
    return { v, rest };
  };
  for (const a of set.applicants) {
    const feed = {
      accounts: (a.feed as unknown as { accounts: RawAccount[] }).accounts.map((acc) => ({
        account: acc.account,
        transactions: acc.transactionList.data.transactions,
      })),
    };
    const i = strip(
      deriveIncome({
        feed,
        as_of: AS_OF_DATE,
        lookback_months: 6,
        min_occurrences: 3,
        categories: set.categories,
      }),
    );
    const e = strip(
      deriveObservedExpenses({
        feed,
        categories: set.categories,
        as_of: AS_OF_DATE,
        lookback_months: 6,
        one_off_threshold_aud: 5000,
      }),
    );
    versions.income.add(i.v);
    versions.expenses.add(e.v);
    income.update(JSON.stringify(i.rest)).update("\n");
    expenses.update(JSON.stringify(e.rest)).update("\n");
  }
  return {
    income: { hash: income.digest("hex"), versions: [...versions.income] },
    expenses: { hash: expenses.digest("hex"), versions: [...versions.expenses] },
  };
}
