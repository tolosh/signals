// SIG-18 review follow-up 4 (8 November 2026): the scorer tagged misses "FN1 no visible repayment"
// even when the repayments were visible, because it only saw a debit whose whole narrative
// normalised to the provider's name. FN1 is pre-registered as "no debit to the provider in any
// shared account": a narrative naming the provider among other words is still a debit to it.
// Needed before SIG-57 runs on set v2's noisy narratives.
import { describe, expect, it } from "vitest";
import type { LiabilityFeed } from "../../src/engines/liabilities/index.js";
import { missCause } from "../../src/research/liabilities-score.js";

const config = { min_occurrences: 3, amount_tolerance: 0.15 };
/** Six fortnightly debits ending 2026-10-17, each with the given narrative and category. */
function feedOf(description: string, category?: string) {
  const categories: Record<string, string> = {};
  const transactions = Array.from({ length: 6 }, (_, i) => {
    const id = `t${i}`;
    if (category) categories[id] = category;
    const day = new Date(Date.UTC(2026, 9, 17 - i * 14)).toISOString().slice(0, 10);
    return {
      accountId: "acc-pay",
      transactionId: id,
      type: "PAYMENT",
      description,
      postingDateTime: `${day}T02:00:00Z`,
      amount: "-60.00",
    };
  });
  const feed: LiabilityFeed = {
    accounts: [
      {
        account: { accountId: "acc-pay", productCategory: "TRANS_AND_SAVINGS_ACCOUNTS" },
        transactions,
      },
    ],
  };
  return { feed, categories };
}
const cause = (
  description: string,
  category: string | undefined,
  found: { family: "bnpl"; provider: string; declared: boolean }[] = [],
) => {
  const { feed, categories } = feedOf(description, category);
  return missCause(feed, categories, config, found, "bnpl", "AFTERPAY");
};

describe("FN1 no visible repayment: only when no debit names the provider", () => {
  it("a narrative with other words around the provider is a visible repayment, not FN1", () => {
    expect(cause("PAYMENT TO AFTERPAY AU REF", "bnpl")).not.toBe("FN1 no visible repayment");
  });
  it("…and is tagged by what actually happened: detected under another provider name", () => {
    expect(
      cause("PAYMENT TO AFTERPAY AU REF", "bnpl", [
        { family: "bnpl", provider: "TO AFTERPAY AU REF", declared: false },
      ]),
    ).toBe("unregistered: detected under another provider name");
  });
  it("visible but not categorised as a lender is FN2, as before", () => {
    expect(cause("PAYMENT TO AFTERPAY AU REF", undefined)).toBe("FN2 not identified as a lender");
  });
  it("no debit naming the provider is still FN1", () => {
    expect(cause("WOOLWORTHS SYDNEY", "groceries")).toBe("FN1 no visible repayment");
  });
  it("the provider must appear as whole words: AFTERPAYMENTS is not AFTERPAY", () => {
    expect(cause("AFTERPAYMENTS CAFE", "bnpl")).toBe("FN1 no visible repayment");
  });
});

describe("FN6 matched as disclosed: only when the detection was read as disclosed", () => {
  it("is FN6 when the detector found it and matched a declaration", () => {
    expect(
      cause("AFTERPAY", "bnpl", [{ family: "bnpl", provider: "AFTERPAY", declared: true }]),
    ).toBe("FN6 matched as disclosed");
  });
  it("is not FN6 when nothing explains the miss", () => {
    expect(cause("AFTERPAY", "bnpl")).toBe("unregistered: not explained");
  });
});
