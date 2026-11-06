// SIG-12 section 6 tests, plus the scenario knobs SIG-39 to SIG-45 will need.
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  GROUND_TRUTH_SCHEMA_VERSION,
  generateApplicant,
  population,
  scenario,
  serialise,
  type GeneratedApplicant,
  type SpecOverrides,
} from "../../src/research/generator/index.js";

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
const load = (p: string) => JSON.parse(readFileSync(p, "utf8")) as { $id: string };
const cdr = load("research/schemas/cdr-banking-v1.schema.json");
ajv.addSchema(cdr);
const validateTruth = ajv.compile(load("research/schemas/ground-truth-v1.schema.json"));
const shape = (def: string) => {
  const v = ajv.getSchema(`${cdr.$id}#/$defs/${def}`);
  if (!v) throw new Error(`no schema ${def}`);
  return v;
};

const SEED = 42;
const POP = population(SEED);
const all = POP.map((spec) => generateApplicant(spec, SEED));
const one = (overrides: SpecOverrides) => generateApplicant(scenario(overrides, "probe"), SEED);
const txns = (a: GeneratedApplicant) => a.feed.accounts.flatMap((acc) => acc.transactions);
const surplusOf = (t: GeneratedApplicant["truth"]) =>
  t.income.net_monthly - t.expenses.total_monthly - t.liabilities.repayments_monthly;

describe("T1 determinism", () => {
  it("seed 42 twice gives byte-identical output for the whole population", () => {
    const again = population(SEED).map((spec) => generateApplicant(spec, SEED));
    expect(again.map(serialise).join("\n")).toBe(all.map(serialise).join("\n"));
  });

  it("negative control: a different seed gives different output", () => {
    const other = population(43).map((spec) => generateApplicant(spec, 43));
    expect(other.map(serialise).join("\n")).not.toBe(all.map(serialise).join("\n"));
  });
});

describe("T2 every applicant has the CDR / openfeed banking shapes", () => {
  it("accounts, account detail, balances and transactions all validate", () => {
    const errors: string[] = [];
    for (const a of all) {
      const checks: [string, unknown][] = [
        ["AccountListResponse", a.feed.accountList],
        ...a.feed.accounts.flatMap((acc): [string, unknown][] => [
          ["AccountDetailResponse", acc.detail],
          ["BalanceResponse", acc.balance],
          ["TransactionListResponse", acc.transactionList],
        ]),
      ];
      for (const [def, value] of checks) {
        const v = shape(def);
        if (!v(value)) errors.push(`${a.truth.applicant_id} ${def}: ${ajv.errorsText(v.errors)}`);
      }
    }
    expect(errors.slice(0, 5)).toEqual([]);
  });

  it("negative control: a transaction with a numeric amount is rejected", () => {
    const bad = structuredClone(all[0]!.feed.accounts[0]!.transactionList) as {
      data: { transactions: Record<string, unknown>[] };
    };
    bad.data.transactions[0]!.amount = -12.5;
    expect(shape("TransactionListResponse")(bad)).toBe(false);
  });
});

describe("T4 ground truth", () => {
  it("is present, valid against the versioned schema and internally consistent", () => {
    const bad: string[] = [];
    for (const a of all) {
      const t = a.truth;
      if (!validateTruth(structuredClone(t) as unknown))
        bad.push(`${t.applicant_id}: ${ajv.errorsText(validateTruth.errors)}`);
      if (Math.abs(surplusOf(t) - t.surplus_monthly) > 0.005)
        bad.push(`${t.applicant_id}: surplus`);
      const groups =
        t.expenses.committed_monthly + t.expenses.basic_monthly + t.expenses.discretionary_monthly;
      if (Math.abs(groups - t.expenses.total_monthly) > 0.005)
        bad.push(`${t.applicant_id}: groups`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(all[0]!.truth.schema_version).toBe(GROUND_TRUTH_SCHEMA_VERSION);
  });

  it("negative control: a tampered surplus fails the consistency check", () => {
    const t = structuredClone(all[0]!.truth);
    t.surplus_monthly += 1;
    expect(Math.abs(surplusOf(t) - t.surplus_monthly) > 0.005).toBe(true);
  });
});

describe("population v1 (section 4 target)", () => {
  it("has 200 salaried profiles plus every listed variant", () => {
    const count = (tag: string) => POP.filter((s) => s.tags.includes(tag)).length;
    expect(count("salaried-base")).toBe(200);
    for (const tag of [
      "variable-income",
      "gig",
      "benefits",
      "undisclosed-card",
      "bnpl",
      "sacc",
      "wage-advance",
      "gambling",
      "coverage-gap",
    ]) {
      expect(count(tag), tag).toBeGreaterThan(0);
    }
  });
});

describe("scenario knobs for SIG-39 to SIG-45", () => {
  it("salary account not shared: salary lands in an unshared account, the truth says so", () => {
    const a = one({ coverage: { salary_account_shared: false } });
    expect(a.truth.coverage.salary_account_shared).toBe(false);
    expect(txns(a).some((t) => t.description.includes("SALARY"))).toBe(false);
    expect(a.truth.coverage.unshared_account_ids.length).toBeGreaterThan(0);
  });

  it("transfers to unshared accounts appear as outgoing transfers and are counted", () => {
    const a = one({ coverage: { unshared_transfer_accounts: 2 } });
    expect(a.truth.coverage.unshared_transfer_accounts).toBe(2);
    expect(a.truth.coverage.transfers_to_unshared_count).toBeGreaterThan(0);
    const out = txns(a).filter(
      (t) => t.type === "TRANSFER_OUTGOING" && t.description.startsWith("TRANSFER TO"),
    );
    expect(out.length).toBe(a.truth.coverage.transfers_to_unshared_count);
  });

  it.each([1, 3, 6, 12] as const)("history of %i months", (months) => {
    const a = one({ history_months: months });
    expect(a.truth.history.months).toBe(months);
    const dates = txns(a)
      .map((t) => (t.postingDateTime ?? "").slice(0, 10))
      .sort();
    expect(dates[0]! >= a.truth.history.start_date).toBe(true);
    expect(dates.at(-1)! <= a.truth.history.end_date).toBe(true);
  });

  it("statement feed drops MCC, biller code and merchant name", () => {
    const a = one({ feed: "uploaded_statement" });
    expect(a.truth.feed_type).toBe("uploaded_statement");
    expect(txns(a).some((t) => t.merchantCategoryCode ?? t.billerCode ?? t.merchantName)).toBe(
      false,
    );
    expect(txns(one({ feed: "cdr" })).some((t) => t.merchantCategoryCode)).toBe(true);
  });

  it("labels liabilities, with undisclosed ones marked", () => {
    const a = one({
      liabilities: [{ type: "credit_card", declared: false, account_shared: true, limit: 6000 }],
    });
    const card = a.truth.liabilities.items.find((l) => l.type === "credit_card");
    expect(card).toMatchObject({ declared: false, account_shared: true, limit: 6000 });
    expect(card!.monthly_commitment).toBeGreaterThan(0);
  });

  it("labels quarterly and annual commitments with their monthly equivalent", () => {
    const a = one({
      history_months: 12,
      commitments: [
        { kind: "council_rates", cadence: "quarterly", amount: 600 },
        { kind: "insurance", cadence: "annual", amount: 1200 },
      ],
    });
    const rates = a.truth.commitments.find((c) => c.kind === "council_rates");
    const insurance = a.truth.commitments.find((c) => c.kind === "insurance");
    expect(rates).toMatchObject({ cadence: "quarterly", amount: 600, monthly_equivalent: 200 });
    expect(insurance).toMatchObject({ cadence: "annual", amount: 1200, monthly_equivalent: 100 });
    expect(rates!.occurrences_in_window).toBe(4);
    expect(insurance!.occurrences_in_window).toBe(1);
  });

  it("labels positive behaviours", () => {
    const a = one({
      behaviours: {
        positive: { rent_on_time: true, cards_cleared_in_full: true, savings_monthly: 500 },
      },
    });
    expect(a.truth.behaviours.positive).toMatchObject({
      rent_on_time: true,
      cards_cleared_in_full: true,
      savings_growing: true,
      no_dishonours: true,
    });
    expect(txns(a).some((t) => t.description.includes("SAVINGS"))).toBe(true);
  });
});
