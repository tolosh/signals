// SIG-18 (H2) T1 to T3: the hidden-liability detector that LIA-01 (SIG-42) is built on. The method
// is pre-registered in research/preregistrations/SIG-18.json. A detected-undisclosed liability is
// what LIA-01 reports amber; none is green. T4 (the set v1 result, D28) is in lia-01-run.test.ts.
import { describe, expect, it } from "vitest";
import {
  detectLiabilities,
  normaliseProvider,
  type LiabilityFeed,
  type LiabilityInput,
} from "../../../src/engines/liabilities/index.js";

const AS_OF = "2026-10-31";
type Tx = LiabilityFeed["accounts"][number]["transactions"][number];
let n = 0;
const tx = (date: string, description: string, amount: number, extra: Partial<Tx> = {}): Tx => ({
  accountId: "acc-evd",
  transactionId: `t${++n}`,
  type: "PAYMENT",
  description,
  postingDateTime: `${date}T00:00:00Z`,
  amount: amount.toFixed(2),
  ...extra,
});
const monthly = (description: string, amount: number, months: number, extra: Partial<Tx> = {}) =>
  Array.from({ length: months }, (_, i) =>
    tx(`2026-${String(10 - i).padStart(2, "0")}-15`, description, -amount, extra),
  );
const everyday = (transactions: Tx[]) => ({
  account: { accountId: "acc-evd", productCategory: "TRANS_AND_SAVINGS_ACCOUNTS" },
  transactions,
});
const input = (
  transactions: Tx[],
  categories: Record<string, string>,
  over: Partial<LiabilityInput> = {},
): LiabilityInput => ({
  feed: { accounts: [everyday(transactions)] },
  categories,
  declared: [],
  as_of: AS_OF,
  min_occurrences: 3,
  amount_tolerance: 0.15,
  ...over,
});
const categorise = (txs: Tx[], category: string) =>
  Object.fromEntries(txs.map((t) => [t.transactionId, category]));

describe("T1 an undisclosed repayment to a named lender", () => {
  it("a $450 monthly repayment for 6 months, not in the application, is undisclosed with those 6 as evidence", () => {
    const repayments = monthly("SOCIETYONE LOAN REPAYMENT", 450, 6);
    const r = detectLiabilities(input(repayments, categorise(repayments, "loan_repayment")));
    expect(r.undisclosed).toHaveLength(1);
    const [found] = r.undisclosed;
    expect(found).toMatchObject({ family: "loan", provider: "SOCIETYONE", cadence: "monthly" });
    expect(found?.evidence).toEqual(repayments.map((t) => t.transactionId).sort());
    expect(found?.monthly).toBe(450);
  });
});

describe("T2 the same repayment declared", () => {
  it("is found, and is disclosed, so nothing is undisclosed", () => {
    const repayments = monthly("SOCIETYONE LOAN REPAYMENT", 450, 6);
    const r = detectLiabilities(
      input(repayments, categorise(repayments, "loan_repayment"), {
        declared: [{ type: "personal_loan", provider: "SOCIETYONE", repayment_monthly: 450 }],
      }),
    );
    expect(r.liabilities).toHaveLength(1);
    expect(r.liabilities[0]?.declared).toBe(true);
    expect(r.undisclosed).toEqual([]);
  });
});

describe("T3 a gym direct debit", () => {
  it("a monthly gym debit is not a liability", () => {
    const gym = monthly("FITNESS FIRST DIRECT DEBIT", 65, 6);
    const r = detectLiabilities(input(gym, categorise(gym, "subscriptions")));
    expect(r.liabilities).toEqual([]);
  });
});

describe("the pre-registered method", () => {
  it("a card in the grant is a liability without any repayment", () => {
    const r = detectLiabilities({
      ...input([], {}),
      feed: {
        accounts: [
          everyday([]),
          {
            account: {
              accountId: "acc-card",
              productCategory: "CRED_AND_CHRG_CARDS",
              productName: "NAB Credit Card",
            },
            transactions: [],
          },
        ],
      },
    });
    expect(r.undisclosed).toMatchObject([
      { family: "credit_card", provider: "NAB", sources: ["account"] },
    ]);
  });

  it("a BPAY card repayment categorised as transfer (ENR-28) is found from the biller name", () => {
    const bpay = monthly("BPAY ANZ CREDIT CARD PAYMENT", 180, 4, {
      billerName: "ANZ CREDIT CARD PAYMENT",
    });
    const r = detectLiabilities(input(bpay, categorise(bpay, "transfer")));
    expect(r.undisclosed).toMatchObject([{ family: "credit_card", provider: "ANZ" }]);
  });

  it("an account found in the grant and its repayments are one liability", () => {
    const bpay = monthly("BPAY ANZ CREDIT CARD PAYMENT", 180, 4, {
      billerName: "ANZ CREDIT CARD PAYMENT",
    });
    const r = detectLiabilities({
      ...input(bpay, categorise(bpay, "transfer")),
      feed: {
        accounts: [
          everyday(bpay),
          {
            account: {
              accountId: "acc-card",
              productCategory: "CRED_AND_CHRG_CARDS",
              productName: "ANZ Credit Card",
            },
            transactions: [],
          },
        ],
      },
    });
    expect(r.liabilities).toHaveLength(1);
    expect(r.liabilities[0]?.sources).toEqual(["account", "outflow"]);
  });

  it("too few occurrences, amounts outside tolerance, or no cadence: not recurring", () => {
    const two = monthly("NIMBLE LOAN REPAYMENT", 95, 2);
    expect(detectLiabilities(input(two, categorise(two, "sacc_loan"))).liabilities).toEqual([]);
    const varied = [450, 300, 600, 200, 700].map((a, i) =>
      tx(`2026-${String(10 - i).padStart(2, "0")}-15`, "PLENTI LOAN REPAYMENT", -a),
    );
    expect(
      detectLiabilities(input(varied, categorise(varied, "loan_repayment"))).liabilities,
    ).toEqual([]);
    // Gaps of 20, 45 and 20 days: the median, 20, is in no cadence band.
    const scattered = ["2026-08-01", "2026-08-21", "2026-10-05", "2026-10-25"].map((d) =>
      tx(d, "ZIP PAY INSTALMENT", -60),
    );
    expect(detectLiabilities(input(scattered, categorise(scattered, "bnpl"))).liabilities).toEqual(
      [],
    );
  });

  it("fortnightly and weekly cadences are found, and amounts are monthly equivalents", () => {
    const fortnightly = Array.from({ length: 6 }, (_, i) =>
      tx(
        new Date(Date.UTC(2026, 9, 30) - i * 14 * 864e5).toISOString().slice(0, 10),
        "CASH CONVERTERS LOAN REPAYMENT",
        -95,
      ),
    );
    const r = detectLiabilities(input(fortnightly, categorise(fortnightly, "sacc_loan")));
    expect(r.undisclosed).toMatchObject([
      { family: "sacc", provider: "CASH CONVERTERS", cadence: "fortnightly" },
    ]);
    expect(r.undisclosed[0]?.monthly).toBeCloseTo((95 * 26) / 12, 2);
  });

  it("own-account transfers and credits are never lender outflows", () => {
    const own = monthly("TRANSFER TO 062-000 12345678 LOAN", 450, 6);
    const refunds = monthly("SOCIETYONE LOAN REPAYMENT", -450, 6);
    const r = detectLiabilities(
      input([...own, ...refunds], {
        ...categorise(own, "loan_repayment"),
        ...categorise(refunds, "loan_repayment"),
      }),
    );
    expect(r.liabilities).toEqual([]);
  });

  it("transactions after as_of are outside the window", () => {
    const later = monthly("SOCIETYONE LOAN REPAYMENT", 450, 6);
    const r = detectLiabilities(
      input(later, categorise(later, "loan_repayment"), { as_of: "2026-04-30" }),
    );
    expect(r.liabilities).toEqual([]);
  });

  it("providers normalise the same way on both sides", () => {
    expect(normaliseProvider("MONEY3 LOAN REPAYMENT")).toBe("MONEY");
    expect(normaliseProvider("Money3")).toBe("MONEY");
    expect(normaliseProvider("AFTERPAY INSTALMENT")).toBe("AFTERPAY");
    expect(normaliseProvider("BPAY NAB CREDIT CARD PAYMENT")).toBe("NAB");
    expect(normaliseProvider("Cash Converters Pty Ltd")).toBe("CASH CONVERTERS");
  });

  it("is deterministic: the same input gives the same output", () => {
    const repayments = monthly("SOCIETYONE LOAN REPAYMENT", 450, 6);
    const i = input(repayments, categorise(repayments, "loan_repayment"));
    expect(JSON.stringify(detectLiabilities(i))).toBe(JSON.stringify(detectLiabilities(i)));
  });
});
