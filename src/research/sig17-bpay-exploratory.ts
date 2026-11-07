// SIG-17, exploratory and NOT pre-registered (SIG-56 item 5): the figure behind "an exploratory
// run with those bills counted reached 96.9%". BPAY bill payments that the local Enrich engine
// categorised as "transfer" (ENR-28) are counted as committed bills instead, using the same test
// as the SIG-17 miss analysis: a debit categorised "transfer" whose narrative starts "BPAY " and
// is not a credit-card payment. Everything else is the pre-registered SIG-17 primary method:
// fully covered applicants, 6-month lookback, one-off threshold $5,000, within 15%.
// This reproduces a figure; it is not a result and changes no SIG-17 record.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  deriveObservedExpenses,
  type ExpenseFeed,
} from "../engines/affordability/observed-expenses.js";
import { AS_OF_DATE, generateApplicant, population, serialise } from "./generator/index.js";

export const BPAY_EXPLORATORY = Object.freeze({
  lookback_months: 6,
  one_off_threshold_aud: 5000,
  tolerance: 0.15,
  bill_category: "utilities",
});

export type BpayExploratoryResult = {
  set: string;
  seed: number;
  set_sha256: string;
  applicants: number;
  within: number;
  share: number;
  recategorised_debits: number;
};

export function bpayBillsAsCommitted(
  manifestPath = "research/datasets/synthetic-v1.manifest.json",
): BpayExploratoryResult {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    set: string;
    seed: number;
    set_sha256: string;
  };
  const cache = JSON.parse(
    readFileSync("research/enrich/synthetic-v1-categories.json", "utf8"),
  ) as { set_sha256: string; categories: Record<string, string> };
  if (cache.set_sha256 !== manifest.set_sha256)
    throw new Error("category cache is for another set");

  const hash = createHash("sha256");
  const applicants = population(manifest.seed).map((spec) => {
    const a = generateApplicant(spec, manifest.seed);
    hash.update(serialise(a)).update("\n");
    return a;
  });
  const sha = hash.digest("hex");
  if (sha !== manifest.set_sha256) throw new Error(`set hash ${sha} does not match the manifest`);

  const covered = applicants.filter(
    (a) => a.truth.coverage.unshared_account_ids.length === 0 && a.truth.history.months >= 3,
  );
  let within = 0;
  let recategorised = 0;
  for (const a of covered) {
    const feed = a.feed as unknown as ExpenseFeed;
    const categories: Record<string, string> = { ...cache.categories };
    for (const t of feed.accounts.flatMap((acc) => acc.transactions)) {
      const bill =
        Number(t.amount) < 0 &&
        categories[t.transactionId] === "transfer" &&
        /^BPAY /.test(t.description) &&
        !/CREDIT CARD/.test(t.description);
      if (bill) {
        categories[t.transactionId] = BPAY_EXPLORATORY.bill_category;
        recategorised++;
      }
    }
    const derived = deriveObservedExpenses({
      feed,
      categories,
      as_of: AS_OF_DATE,
      lookback_months: BPAY_EXPLORATORY.lookback_months,
      one_off_threshold_aud: BPAY_EXPLORATORY.one_off_threshold_aud,
    }).living_monthly;
    const truth = a.truth.expenses.committed_monthly + a.truth.expenses.basic_monthly;
    if (Math.abs(derived - truth) / truth <= BPAY_EXPLORATORY.tolerance) within++;
  }
  return {
    set: manifest.set,
    seed: manifest.seed,
    set_sha256: sha,
    applicants: covered.length,
    within,
    share: within / covered.length,
    recategorised_debits: recategorised,
  };
}
