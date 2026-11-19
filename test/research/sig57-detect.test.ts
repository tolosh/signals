// SIG-57 T1, T2, T3, T7 and T8 (research/preregistrations/SIG-57.json): the alias detector.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LiabilityFeed, LiabilityTransaction } from "../../src/engines/liabilities/index.js";
import { UNSEEN_PROVIDERS, UNSEEN_PROVIDERS_V21 } from "../../src/research/generator/catalog.js";
import { UNSEEN_PROVIDERS_V22 } from "../../src/research/generator/v22/catalog.js";
import { aliasIndex, resolve } from "../../src/research/sig57/aliases.js";
import { detectWithAliases } from "../../src/research/sig57/detect.js";

const table = JSON.parse(readFileSync("research/aliases/lender-aliases-1.0.0.json", "utf8"));
const index = aliasIndex(table);
const AS_OF = "2026-10-31";

/** Six monthly debits ending at as-of. */
const monthly = (
  accountId: string,
  description: string,
  amount: number,
  extra: Partial<LiabilityTransaction> = {},
): LiabilityTransaction[] =>
  [5, 6, 7, 8, 9, 10].map((m) => ({
    accountId,
    transactionId: `${accountId}-${description.replace(/\W/g, "")}-${m}`,
    type: "PAYMENT",
    description,
    postingDateTime: `2026-${String(m).padStart(2, "0")}-15T00:00:00Z`,
    amount: (-amount).toFixed(2),
    ...extra,
  }));
const txn = (transactions: LiabilityTransaction[]) => ({
  account: { accountId: "txn", productCategory: "TRANS_AND_SAVINGS_ACCOUNTS" },
  transactions,
});
const base = { as_of: AS_OF, min_occurrences: 3, amount_tolerance: 0.15 };

describe("SIG-57 resolution and normalisation", () => {
  it("resolves a canonical name, an abbreviation and a legal name to one lender", () => {
    expect(resolve("Commonwealth Bank credit card", index).lender).toBe("cba");
    expect(resolve("CBA LOW RATE", index).lender).toBe("cba");
    expect(resolve("COMMONWEALTH BANK OF AUSTRALIA", index).lender).toBe("cba");
  });

  it("T2: a reference number normalises away", () => {
    const a = resolve("AFTERPAY 12345678 INSTALMENT", index);
    const b = resolve("AFTERPAY INSTALMENT", index);
    expect(a).toEqual(b);
    expect(a.lender).toBe("afterpay");
    expect(resolve("ACME LENDING REF12345 PAYMENT", index)).toEqual(
      resolve("ACME LENDING PAYMENT", index),
    );
  });

  it("a name the table shares between lenders resolves to none", () => {
    const r = resolve("WESTPAC BANKING CORPORATION", index);
    expect(r.lender).toBeNull();
    expect(r.identity).toBe("WESTPAC BANKING CORPORATION");
  });

  it("an unknown name keeps its normalised form as identity", () => {
    expect(resolve("Quokka Lending Co 99812 repayment", index)).toEqual({
      lender: null,
      identity: "QUOKKA LENDING CO",
    });
  });
});

describe("SIG-57 detector", () => {
  it("T1: a declared Commonwealth Bank card matches a CBA card in the grant", () => {
    const feed: LiabilityFeed = {
      accounts: [
        {
          account: {
            accountId: "card",
            productCategory: "CRED_AND_CHRG_CARDS",
            productName: "CBA Low Rate Credit Card",
          },
          transactions: [],
        },
      ],
    };
    const r = detectWithAliases(
      {
        ...base,
        feed,
        categories: {},
        declared: [{ type: "credit_card", provider: "Commonwealth Bank credit card" }],
      },
      index,
      { disclosure: "name_only" },
    );
    expect(r.liabilities.map((l) => [l.family, l.identity, l.declared])).toEqual([
      ["credit_card", "cba", true],
    ]);
    expect(r.undisclosed).toEqual([]);
  });

  it("T3: an unseen lender with a regular repayment is detected, unresolved, never dropped", () => {
    const lines = monthly("txn", "QUOKKA LENDING 5512 REPAYMENT", 210);
    const categories = Object.fromEntries(lines.map((t) => [t.transactionId, "loan_repayment"]));
    const r = detectWithAliases(
      { ...base, feed: { accounts: [txn(lines)] }, categories, declared: [] },
      index,
      { disclosure: "name_only" },
    );
    expect(r.undisclosed.map((l) => [l.family, l.identity, l.lender])).toEqual([
      ["loan", "QUOKKA LENDING", null],
    ]);
  });

  it("a biller name that resolves to a single-family lender is a lender outflow", () => {
    const lines = monthly("txn", "BPAY PAYMENT", 80, { billerName: "AFTERPAY" });
    const r = detectWithAliases(
      { ...base, feed: { accounts: [txn(lines)] }, categories: {}, declared: [] },
      index,
      { disclosure: "name_only" },
    );
    expect(r.undisclosed.map((l) => [l.family, l.identity])).toEqual([["bnpl", "afterpay"]]);
  });

  it("a biller name for a multi-family lender counts only with CARD in it", () => {
    const plain = monthly("txn", "BPAY PAYMENT", 300, { billerName: "NAB" });
    const card = monthly("txn", "BPAY PAYMENT 2", 300, { billerName: "NAB CARDS" });
    const run = (lines: LiabilityTransaction[]) =>
      detectWithAliases(
        { ...base, feed: { accounts: [txn(lines)] }, categories: {}, declared: [] },
        index,
        { disclosure: "name_only" },
      ).undisclosed.map((l) => [l.family, l.identity]);
    expect(run(plain)).toEqual([]);
    expect(run(card)).toEqual([["credit_card", "nab"]]);
  });

  it("name-only disclosure ignores amounts; amount-assisted pairs by repayment", () => {
    const lines = monthly("txn", "QUOKKA LENDING REPAYMENT", 200);
    const categories = Object.fromEntries(lines.map((t) => [t.transactionId, "loan_repayment"]));
    const input = {
      ...base,
      feed: { accounts: [txn(lines)] },
      categories,
      declared: [{ type: "personal_loan", provider: "Quokka Finance", repayment_monthly: 205 }],
    };
    expect(detectWithAliases(input, index, { disclosure: "name_only" }).undisclosed).toHaveLength(
      1,
    );
    expect(
      detectWithAliases(input, index, { disclosure: "amount_assisted", tolerance: 0.05 })
        .undisclosed,
    ).toHaveLength(0);
    expect(
      detectWithAliases(
        { ...input, declared: [{ ...input.declared[0]!, repayment_monthly: 260 }] },
        index,
        { disclosure: "amount_assisted", tolerance: 0.15 },
      ).undisclosed,
    ).toHaveLength(1);
  });

  it("T7: no output depends on a biller code", () => {
    const lines = [
      ...monthly("txn", "BPAY PAYMENT", 80, { billerName: "AFTERPAY" }),
      ...monthly("txn", "ZIP REPAYMENT", 40),
    ];
    const categories = Object.fromEntries(
      lines.filter((t) => t.description.startsWith("ZIP")).map((t) => [t.transactionId, "bnpl"]),
    );
    const withCode = (code: string | undefined) =>
      lines.map((t) => ({ ...t, billerCode: code }) as LiabilityTransaction);
    const run = (ts: LiabilityTransaction[]) =>
      JSON.stringify(
        detectWithAliases(
          { ...base, feed: { accounts: [txn(ts)] }, categories, declared: [] },
          index,
          { disclosure: "name_only" },
        ),
      );
    expect(run(withCode("12345"))).toBe(run(withCode(undefined)));
    expect(run(withCode("99"))).toBe(run(lines));
  });
});

describe("T8: the SIG-57 code holds no lender name", () => {
  it("no string literal in src/research/sig57 is a table name, alias or reserved name", () => {
    const reserved = [UNSEEN_PROVIDERS, UNSEEN_PROVIDERS_V21, UNSEEN_PROVIDERS_V22].flatMap((m) =>
      Object.values(m)
        .flat()
        .map((n) => String(n).toUpperCase()),
    );
    const names = new Set<string>([
      ...reserved,
      ...table.lenders.flatMap((l: { canonical: string; aliases: { text: string }[] }) => [
        l.canonical,
        ...l.aliases.map((a) => a.text),
      ]),
    ]);
    const dir = "src/research/sig57";
    const found: string[] = [];
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const m of src.matchAll(/(["'`])((?:(?!\1).){2,})\1/g)) {
        const s = (m[2] ?? "").toUpperCase();
        if ([...names].some((n) => s === n || ` ${s} `.includes(` ${n} `))) found.push(f);
      }
    }
    expect(found).toEqual([]);
  });
});
