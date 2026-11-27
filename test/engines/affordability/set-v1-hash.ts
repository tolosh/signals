// SIG-42 ruling 3 (10 November 2026, 06:39): observed income and observed expenses keep their
// versions under GR-3 gate 1.2.0, provided replay tests pin both versions. These hashes cover the
// whole result of each method for every set v1 applicant (a 6-month request, with the committed
// category cache), with the gate's version field taken out so the same hash can be taken at gate
// 1.1.0; the gate versions the results carry are returned beside the hash, for the test to pin.
// (The methods' own versions are constants, not result fields; the test pins those.)
import { createHash } from "node:crypto";
import { deriveIncome, deriveIncomeByPayerKey } from "../../../src/engines/affordability/income.js";
import { deriveObservedExpenses } from "../../../src/engines/affordability/observed-expenses.js";
import { asV111 } from "../sig81/as-v111.js";
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
    // Observed income 1.0.2 (SIG-64) records the keyword list's version too; set back likewise.
    delete rest.keyword_list_version;
    return { v, rest };
  };
  for (const a of set.applicants) {
    const feed = {
      accounts: (a.feed as unknown as { accounts: RawAccount[] }).accounts.map((acc) => ({
        account: acc.account,
        transactions: acc.transactionList.data.transactions,
      })),
    };
    const input = {
      feed,
      as_of: AS_OF_DATE,
      lookback_months: 6,
      min_occurrences: 3,
      categories: set.categories,
    };
    // Observed income 1.0.2 (SIG-64) shows each payer masked; each is put back to the unmasked
    // payer its stream is keyed by, so the hash taken before SIG-64 proves only the payer changed.
    const keyed = deriveIncomeByPayerKey(input).streams;
    const shown = deriveIncome(input);
    const i = strip({
      ...shown,
      streams: shown.streams.map((s, n) => ({ ...s, payer: keyed[n]?.payer ?? s.payer })),
    });
    // SIG-81: observed expenses 1.2.0 in 1.1.1's shape (test/engines/sig81/as-v111.ts), so the
    // 1.1.1 hash still proves the gate changes nothing.
    const e = strip(
      asV111(
        deriveObservedExpenses({
          feed,
          categories: set.categories,
          as_of: AS_OF_DATE,
          lookback_months: 6,
          one_off_threshold_aud: 5000,
        }),
      ),
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
