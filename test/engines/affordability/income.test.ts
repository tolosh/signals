// SIG-16 section 6 tests: net monthly income from transactions (AF-I1, AF-I2, AF-I5), with the
// pre-registered configuration in research/preregistrations/SIG-16.json.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deriveIncome,
  type IncomeFeed,
  type IncomeTransaction,
} from "../../../src/engines/affordability/income.js";
import {
  AS_OF_DATE,
  generateApplicant,
  population,
} from "../../../src/research/generator/index.js";

const prereg = JSON.parse(readFileSync("research/preregistrations/SIG-16.json", "utf8")) as {
  primary_configuration: { lookback_months: number; min_occurrences: number };
  tolerance_pct: number;
  target_share_within: number;
};
const PRIMARY = prereg.primary_configuration;

let n = 0;
const tx = (
  accountId: string,
  date: string,
  amount: number,
  description: string,
  type = "TRANSFER_INCOMING",
): IncomeTransaction => ({
  accountId,
  transactionId: `t${++n}`,
  type,
  description,
  postingDateTime: `${date}T00:00:00Z`,
  amount: amount.toFixed(2),
});
const account = (
  id: string,
  transactions: IncomeTransaction[],
  extra: Record<string, unknown> = {},
) => ({
  account: { accountId: id, productCategory: "TRANS_AND_SAVINGS_ACCOUNTS" },
  detail: {
    data: { bsb: "062000", accountNumber: id === "evd" ? "11111111" : "22222222", ...extra },
  },
  transactions,
});
/** Dates every `step` days back from the as-of date, oldest first. */
const every = (step: number, count: number, from = "2026-10-30") => {
  const end = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) =>
    new Date(end - (count - 1 - i) * step * 86_400_000).toISOString().slice(0, 10),
  );
};
const salary = every(14, 13).map((d) => tx("evd", d, 3000, "SALARY ACME PTY LTD"));
const derive = (feed: IncomeFeed, over: Partial<typeof PRIMARY> = {}) =>
  deriveIncome({ feed, as_of: AS_OF_DATE, ...PRIMARY, ...over });

describe("T1 a fortnightly salary of $3,000 for 6 months", () => {
  it("derives $6,500 a month exactly", () => {
    const result = derive({ accounts: [account("evd", salary)] });
    expect(result.net_monthly).toBe(6500);
    expect(result.streams).toHaveLength(1);
    expect(result.streams[0]).toMatchObject({ cadence: "fortnightly", median_amount: 3000 });
  });

  it("weekly and monthly cadences normalise by 52/12 and 1 (AF-I1)", () => {
    const weekly = every(7, 26).map((d) => tx("evd", d, 1000, "SALARY ACME"));
    expect(derive({ accounts: [account("evd", weekly)] }).net_monthly).toBeCloseTo(4333.33, 2);
    const monthly = every(30, 6).map((d) => tx("evd", d, 5200, "SALARY ACME"));
    expect(derive({ accounts: [account("evd", monthly)] }).net_monthly).toBe(5200);
  });
});

describe("T2 a transfer from the applicant's own savings account", () => {
  it("is excluded when matched by a same-day debit in a shared savings account", () => {
    const days = every(30, 6);
    const feed = {
      accounts: [
        account("evd", [
          ...salary,
          ...days.map((d) => tx("evd", d, 500, "INTERNET TRANSFER FROM SAVINGS")),
        ]),
        account(
          "sav",
          days.map((d) => tx("sav", d, -500, "INTERNET TRANSFER TO EVERYDAY", "TRANSFER_OUTGOING")),
        ),
      ],
    };
    expect(derive(feed).net_monthly).toBe(6500);
    expect(derive(feed).excluded.own_account_transfer).toBe(6);
  });

  it("is excluded when the narrative carries a BSB and account number", () => {
    const sweep = every(14, 13).map((d) => tx("evd", d, 700, "TRANSFER FROM 062-000 123456"));
    const result = derive({ accounts: [account("evd", [...salary, ...sweep])] });
    expect(result.net_monthly).toBe(6500);
    expect(result.excluded.own_account_transfer).toBe(13);
  });
});

describe("T3 a Beforepay advance", () => {
  it("is excluded, however regular", () => {
    const advances = every(14, 13).map((d) => tx("evd", d, 300, "BEFOREPAY ADVANCE"));
    const result = derive({ accounts: [account("evd", [...salary, ...advances])] });
    expect(result.net_monthly).toBe(6500);
    expect(result.excluded.advance_or_loan).toBe(13);
  });

  it("refunds, interest and card payments received are excluded too (AF-I5)", () => {
    const noise = [
      ...every(30, 6).map((d) => tx("evd", d, 120, "REFUND WOOLWORTHS")),
      ...every(30, 6).map((d) => tx("evd", d, 2.5, "CREDIT INTEREST")),
    ];
    const card = {
      account: { accountId: "card", productCategory: "CRED_AND_CHRG_CARDS" },
      transactions: every(30, 6).map((d) => tx("card", d, 400, "PAYMENT RECEIVED THANK YOU")),
    };
    const result = derive({ accounts: [account("evd", [...salary, ...noise]), card] });
    expect(result.net_monthly).toBe(6500);
  });
});

describe("negative control (pre-registered): shuffled payer names", () => {
  it("finds no stream when every credit has a unique payer", () => {
    const letters = (i: number) =>
      String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26));
    const shuffled = salary.map((t, i) => ({ ...t, description: `PAYER ${letters(i)}` }));
    expect(derive({ accounts: [account("evd", shuffled)] }).net_monthly).toBe(0);
  });
});

describe("T4 across synthetic set v1's salaried profiles", () => {
  it(`at least ${prereg.target_share_within * 100}% fall within ${prereg.tolerance_pct * 100}%`, () => {
    const applicants = population(42)
      .filter((s) => s.tags.includes("salaried-base"))
      .map((s) => generateApplicant(s, 42));
    expect(applicants).toHaveLength(200);
    const within = applicants.filter((a) => {
      const derived = derive(a.feed as unknown as IncomeFeed).net_monthly;
      return (
        Math.abs(derived - a.truth.income.net_monthly) / a.truth.income.net_monthly <=
        prereg.tolerance_pct
      );
    }).length;
    expect(within / applicants.length).toBeGreaterThanOrEqual(prereg.target_share_within);
  }, 60_000);
});
