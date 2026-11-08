// SIG-54: the generator 2.0.0 features, each on a scripted applicant (scenario() with a v2 block).
// Every label in the ground truth must point at transactions that exist in the feed, so the
// scorers can match by ID rather than by name (SIG-18 review, follow-up 2).
import { describe, expect, it } from "vitest";
import {
  generateApplicant,
  scenario,
  type GeneratedApplicant,
  type SpecOverrides,
} from "../../../src/research/generator/index.js";
import { netFromGross, taxTable } from "../../../src/research/generator/tax.js";

const SEED = 7;
const gen = (over: SpecOverrides, id = "v2-test") => generateApplicant(scenario(over, id), SEED);
type Tx = GeneratedApplicant["feed"]["accounts"][number]["transactions"][number];
const txs = (a: GeneratedApplicant): Tx[] => a.feed.accounts.flatMap((acc) => acc.transactions);
const byId = (a: GeneratedApplicant) => new Map(txs(a).map((t) => [t.transactionId, t]));
const truth2 = (a: GeneratedApplicant) => {
  const t = a.truth;
  if (!t.v2) throw new Error("no v2 truth");
  return t.v2;
};
const fy27 = taxTable("2026-27");

describe("versions", () => {
  it("a v2 applicant carries generator and schema 2.0.0; a v1 one is unchanged at 1.0.0", () => {
    const a = gen({ v2: { requested_lookback: 6 } });
    expect(a.truth.generator_version).toBe("2.0.0");
    expect(a.truth.schema_version).toBe("2.0.0");
    const b = gen({});
    expect(b.truth.generator_version).toBe("1.0.0");
    expect(b.truth.schema_version).toBe("1.0.0");
    expect(b.truth.v2).toBeUndefined();
  });
});

describe("gross is the primary input; net follows forward through the tax table", () => {
  it("records gross, tax, Medicare, net and the table version; pays are net per pay", () => {
    const a = gen({
      income: { cadence: "fortnightly", gross_annual: 100_000 },
      v2: { requested_lookback: 6, gross_primary: true },
    });
    const n = netFromGross(100_000, fy27);
    expect(truth2(a).tax).toEqual(n);
    const perPay = Math.round((n.net_annual / 26) * 100) / 100;
    expect(a.truth.income.streams[0]?.net_per_pay).toBe(perPay);
    const pays = txs(a).filter((t) => t.description.startsWith("SALARY"));
    expect(pays.length).toBeGreaterThan(10);
    for (const p of pays) expect(Number(p.amount)).toBe(perPay);
    expect(a.application.stated_gross_annual).toBe(100_000);
  });
});

describe("the requested lookback is recorded per applicant", () => {
  it("is in the truth, whatever the history length", () => {
    const a = gen({ history_months: 3, v2: { requested_lookback: 12 } });
    expect(truth2(a).request).toEqual({ lookback_months: 12 });
    expect(a.truth.history.months).toBe(3);
  });
});

describe("irregular pay (SIG-16)", () => {
  const base: SpecOverrides = { income: { cadence: "fortnightly", net_per_pay: 3000 } };
  it("overtime raises some pays; each is labelled by transaction ID", () => {
    const a = gen({
      ...base,
      v2: { requested_lookback: 6, pay: { overtime: { share: 0.5, amount: 400 } } },
    });
    const events = truth2(a).pay_events.filter((e) => e.kind === "overtime");
    expect(events.length).toBeGreaterThan(2);
    const ids = byId(a);
    for (const e of events) expect(Number(ids.get(e.transaction_id ?? "")?.amount)).toBe(3400);
  });
  it("a bonus is one larger pay, labelled", () => {
    const a = gen({ ...base, v2: { requested_lookback: 6, pay: { bonus: { amount: 5000 } } } });
    const [e] = truth2(a).pay_events.filter((x) => x.kind === "bonus");
    expect(Number(byId(a).get(e?.transaction_id ?? "")?.amount)).toBe(8000);
  });
  it("a rise partway through: later pays are higher, and net_monthly is the new rate", () => {
    const a = gen({
      ...base,
      v2: { requested_lookback: 6, pay: { change: { after_days: 90, net_per_pay: 3300 } } },
    });
    const [e] = truth2(a).pay_events.filter((x) => x.kind === "change");
    expect(e).toBeDefined();
    const pays = txs(a).filter((t) => t.description.startsWith("SALARY"));
    expect(pays.filter((p) => p.amount === "3000.00").length).toBeGreaterThan(0);
    expect(pays.filter((p) => p.amount === "3300.00").length).toBeGreaterThan(0);
    expect(a.truth.income.net_monthly).toBe(Math.round(3300 * (26 / 12) * 100) / 100);
    expect(truth2(a).received_net_monthly).toBeLessThan(a.truth.income.net_monthly);
  });
  it("a new employer partway through: the payer changes, and both are in the truth", () => {
    const a = gen({
      ...base,
      income: { ...base.income, payer: "HARBOUR LOGISTICS" },
      v2: {
        requested_lookback: 6,
        pay: { change: { after_days: 90, net_per_pay: 3000, payer: "NORTHSIDE HEALTH" } },
      },
    });
    const d = txs(a).map((t) => t.description);
    expect(d).toContain("SALARY HARBOUR LOGISTICS");
    expect(d).toContain("SALARY NORTHSIDE HEALTH");
    expect(truth2(a).payers.map((p) => p.payer)).toEqual(["HARBOUR LOGISTICS", "NORTHSIDE HEALTH"]);
  });
});

describe("payer-name drift (SIG-16)", () => {
  it("over time: the same employer under a second descriptor, both listed as aliases", () => {
    const a = gen({
      income: { payer: "ACME CONSULTING PTY LTD" },
      v2: {
        requested_lookback: 6,
        payer_drift: { mode: "over_time", alias: "ACME CONSULTING P/L PAYROLL" },
      },
    });
    const d = new Set(txs(a).map((t) => t.description));
    expect(d.has("SALARY ACME CONSULTING PTY LTD")).toBe(true);
    expect(d.has("ACME CONSULTING P/L PAYROLL")).toBe(true);
    expect(truth2(a).payers[0]?.aliases).toEqual([
      "SALARY ACME CONSULTING PTY LTD",
      "ACME CONSULTING P/L PAYROLL",
    ]);
  });
  it("across data holders: pay split across two shared accounts at different banks", () => {
    const a = gen({
      income: { payer: "ACME CONSULTING PTY LTD" },
      v2: { requested_lookback: 6, payer_drift: { mode: "across_banks", alias: "ACME CONSULT" } },
    });
    const accounts = a.feed.accounts.filter((acc) =>
      acc.transactions.some((t) => t.type === "TRANSFER_INCOMING" && /ACME/.test(t.description)),
    );
    expect(accounts).toHaveLength(2);
    const bsbs = accounts.map((acc) => (acc.detail as { data: { bsb: string } }).data.bsb);
    expect(new Set(bsbs).size).toBe(2);
  });
});

describe("dishonours, tagged by date (SIG-13)", () => {
  it("each dishonour is a fee on its labelled date, with its ID", () => {
    const a = gen({
      history_months: 6,
      v2: { requested_lookback: 6, dishonours: { days_ago: [10, 40, 150] } },
    });
    const events = truth2(a).dishonour_events;
    expect(events.map((e) => e.days_ago)).toEqual([10, 40, 150]);
    expect(events.map((e) => e.recent)).toEqual([true, true, false]);
    const ids = byId(a);
    for (const e of events) {
      const t = ids.get(e.transaction_id);
      expect(t?.type).toBe("FEE");
      expect(t?.postingDateTime?.slice(0, 10)).toBe(e.date);
    }
    expect(a.truth.behaviours.dishonours).toBe(3);
  });
});

describe("BPAY bills labelled with their true group (SIG-17, ENR-28)", () => {
  it("every BPAY debit in the feed has a label, and every label is a BPAY debit", () => {
    const a = gen({
      liabilities: [{ type: "credit_card", declared: true }],
      commitments: [
        { kind: "utilities", cadence: "quarterly", amount: 450 },
        { kind: "council_rates", cadence: "quarterly", amount: 600 },
        { kind: "insurance", cadence: "annual", amount: 1100 },
      ],
      v2: { requested_lookback: 6 },
    });
    const bpay = txs(a).filter((t) => t.billerCode !== undefined);
    const labels = truth2(a).bpay;
    expect(labels.map((l) => l.transaction_id).sort()).toEqual(
      bpay.map((t) => t.transactionId).sort(),
    );
    const card = labels.filter((l) => l.kind === "card_repayment");
    expect(card.length).toBeGreaterThan(0);
    for (const l of card) expect(l.true_category).toBe("transfer");
    const bills = labels.filter((l) => l.kind === "bill");
    expect(new Set(bills.map((l) => l.item))).toEqual(
      new Set(["commitment:utilities", "commitment:council_rates", "commitment:insurance"]),
    );
    for (const l of bills) expect(l.true_group).toBe("committed");
  });
});

describe("liabilities for H2 (SIG-18 review)", () => {
  it("each liability lists its repayment transaction IDs, all debits in the feed", () => {
    const a = gen({
      liabilities: [{ type: "personal_loan", declared: false, account_shared: true }],
      v2: { requested_lookback: 6 },
    });
    const [l] = truth2(a).liabilities;
    expect(l?.repayment_transaction_ids.length).toBeGreaterThan(3);
    const ids = byId(a);
    for (const id of l?.repayment_transaction_ids ?? [])
      expect(Number(ids.get(id)?.amount)).toBeLessThan(0);
    expect(l?.paid_from_shared).toBe(true);
    expect(a.feed.accounts.some((acc) => acc.account.productCategory === "PERS_LOANS")).toBe(true);
  });
  it("repaid from an unshared account: real, but no repayment is visible (FN1 by design)", () => {
    const a = gen({
      liabilities: [
        { type: "car_loan", declared: false, account_shared: false, paid_from_unshared: true },
      ],
      v2: { requested_lookback: 6 },
    });
    const [l] = truth2(a).liabilities;
    expect(l?.paid_from_shared).toBe(false);
    expect(l?.repayment_transaction_ids).toEqual([]);
    expect(a.truth.coverage.unshared_account_ids).toContain(l?.paid_from_account_id);
    expect(txs(a).some((t) => /LOAN REPAYMENT/.test(t.description))).toBe(false);
  });
  it("a natural-form declaration names the lender as an applicant would", () => {
    const a = gen({
      liabilities: [
        {
          type: "credit_card",
          declared: true,
          provider: "CBA",
          declared_as: "Commonwealth Bank credit card",
        },
      ],
      v2: { requested_lookback: 6 },
    });
    expect(a.application.declared_liabilities[0]?.provider).toBe("Commonwealth Bank credit card");
    expect(truth2(a).liabilities[0]).toMatchObject({
      lender: "CBA",
      declared_as: "Commonwealth Bank credit card",
    });
  });
  it("reference-number noise: the lender narrative carries a reference or customer number", () => {
    const a = gen({
      liabilities: [{ type: "bnpl", declared: false, provider: "AFTERPAY", narrative_ref: true }],
      v2: { requested_lookback: 6 },
    });
    const ids = byId(a);
    for (const id of truth2(a).liabilities[0]?.repayment_transaction_ids ?? [])
      expect(ids.get(id)?.description).toMatch(/^AFTERPAY \d{6,10} INSTALMENT$/);
  });
  it("no 'CREDIT CARD' biller cue: the BPAY biller and narrative don't say credit card", () => {
    const a = gen({
      liabilities: [
        { type: "credit_card", declared: false, provider: "WESTPAC", biller_cue: false },
      ],
      v2: { requested_lookback: 6 },
    });
    const ids = byId(a);
    const paid = (truth2(a).liabilities[0]?.repayment_transaction_ids ?? []).map((id) =>
      ids.get(id),
    );
    expect(paid.length).toBeGreaterThan(0);
    for (const t of paid) {
      expect(t?.billerName).not.toMatch(/CREDIT CARD/i);
      expect(t?.description).not.toMatch(/CREDIT CARD/i);
    }
  });
  it("an unseen lender is flagged in the truth", () => {
    const a = gen({
      liabilities: [
        { type: "personal_loan", declared: false, provider: "WISR", unseen_lender: true },
      ],
      v2: { requested_lookback: 6 },
    });
    expect(truth2(a).liabilities[0]).toMatchObject({ lender: "WISR", unseen_lender: true });
  });
  it("a mortgage records its purpose and feature; an offset account is shared", () => {
    const a = gen({
      liabilities: [
        {
          type: "mortgage",
          declared: true,
          account_shared: true,
          mortgage: { purpose: "investor", feature: "offset" },
        },
      ],
      v2: { requested_lookback: 6 },
    });
    expect(truth2(a).liabilities[0]?.mortgage).toEqual({ purpose: "investor", feature: "offset" });
    expect(a.feed.accounts.some((acc) => acc.account.productName === "Mortgage Offset")).toBe(true);
    expect(
      a.feed.accounts.some((acc) => acc.account.productCategory === "RESIDENTIAL_MORTGAGES"),
    ).toBe(true);
  });
});
