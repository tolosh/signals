// SIG-54 set v2.1: set v2's T1 to T6 on the new set (generator 2.1.0, ground truth 2.1.0, its own
// seed). Unchanged by design from set v2 (the review's item 11): the request drawn independently
// of history, the tax module, and set v1 at 8f5cf973…; set v2 still regenerates to c190552d…
// (test/research/v2/population.test.ts).
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import * as gen from "../../../src/research/generator/index.js";

const g = gen as typeof gen & {
  SET_V21_SEED?: number;
  SET_V21_MINIMUMS?: Record<string, number>;
  GENERATOR_VERSION_V21?: string;
  GROUND_TRUTH_SCHEMA_VERSION_V21?: string;
};
const SEED = g.SET_V21_SEED ?? 541;
const population = gen.populationV2 as (s: number, v?: "2.0" | "2.1") => gen.ApplicantSpec[];
const POP = population(SEED, "2.1");
const all = POP.map((s) => gen.generateApplicant(s, SEED));

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
const load = (p: string) => JSON.parse(readFileSync(p, "utf8")) as { $id: string };
const cdr = load("research/schemas/cdr-banking-v1.schema.json");
ajv.addSchema(cdr);
const SCHEMA = "research/schemas/ground-truth-v2.1.schema.json";

describe("v2.1 T1 determinism", () => {
  it("the seed twice gives byte-identical output; a different seed doesn't", () => {
    const again = population(SEED, "2.1").map((s) => gen.generateApplicant(s, SEED));
    expect(again.map(gen.serialise).join("\n")).toBe(all.map(gen.serialise).join("\n"));
    const other = population(SEED + 1, "2.1").map((s) => gen.generateApplicant(s, SEED + 1));
    expect(other.map(gen.serialise).join("\n")).not.toBe(all.map(gen.serialise).join("\n"));
  }, 180_000);
  it("is generator 2.1.0 and ground truth 2.1.0, with its own seed", () => {
    expect(SEED).not.toBe(gen.SET_V2_SEED);
    for (const a of all) {
      expect(a.truth.generator_version).toBe("2.1.0");
      expect(a.truth.schema_version).toBe("2.1.0");
    }
  });
});

describe("v2.1 T2 CDR shapes", () => {
  it("accounts, details, balances and transactions validate", () => {
    const errors: string[] = [];
    for (const a of all)
      for (const [def, value] of [
        ["AccountListResponse", a.feed.accountList],
        ...a.feed.accounts.flatMap((acc) => [
          ["AccountDetailResponse", acc.detail],
          ["BalanceResponse", acc.balance],
          ["TransactionListResponse", acc.transactionList],
        ]),
      ] as [string, unknown][]) {
        const v = ajv.getSchema(`${cdr.$id}#/$defs/${def}`);
        if (v && !v(value)) errors.push(`${a.truth.applicant_id} ${def}`);
      }
    expect(errors.slice(0, 5)).toEqual([]);
  }, 120_000);
});

describe("v2.1 T3 ground truth 2.1.0", () => {
  it("validates and is consistent; every labelled ID is in the feed", () => {
    expect(existsSync(SCHEMA)).toBe(true);
    const validate = ajv.compile(load(SCHEMA));
    const bad: string[] = [];
    for (const a of all) {
      const t = a.truth;
      if (!validate(structuredClone(t) as unknown)) bad.push(`${t.applicant_id}: schema`);
      const surplus =
        t.income.net_monthly - t.expenses.total_monthly - t.liabilities.repayments_monthly;
      if (Math.abs(surplus - t.surplus_monthly) > 0.005) bad.push(`${t.applicant_id}: surplus`);
      const ids = new Set(
        a.feed.accounts.flatMap((x) => x.transactions.map((y) => y.transactionId)),
      );
      const v2 = t.v2!;
      for (const id of [
        ...v2.pay_events.map((e) => e.transaction_id),
        ...v2.dishonour_events.map((e) => e.transaction_id),
        ...v2.bpay.map((b) => b.transaction_id),
        ...v2.liabilities.flatMap((l) => l.repayment_transaction_ids),
      ])
        if (id && !ids.has(id)) bad.push(`${t.applicant_id}: ${id}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

describe("v2.1 T5 populations and the request", () => {
  const count = (tag: string) => POP.filter((s) => s.tags.includes(tag)).length;
  it("every tag meets its minimum, and the minimums are the real ones", () => {
    const min = g.SET_V21_MINIMUMS ?? {};
    expect(Object.keys(min).length).toBeGreaterThan(20);
    expect(Object.entries(min).filter(([t, m]) => count(t) < m)).toEqual([]);
  });
  it("the request is independent of history: every request with every history length", () => {
    const pairs = new Set(
      all.map((a) => `${a.truth.v2?.request.lookback_months}/${a.truth.history.months}`),
    );
    const missing = [3, 6, 12].flatMap((r) => [1, 3, 6, 12].filter((h) => !pairs.has(`${r}/${h}`)));
    expect(missing).toEqual([]);
  });
});

describe("v2.1 manifest reproduces (D28)", () => {
  it("regenerating gives the manifest's seed, count, set hash and per-applicant hashes", () => {
    const path = "research/datasets/synthetic-v2.1.manifest.json";
    expect(existsSync(path)).toBe(true);
    const m = JSON.parse(readFileSync(path, "utf8")) as {
      seed: number;
      applicants: number;
      set_sha256: string;
      files: { id: string; sha256: string }[];
    };
    expect(m.seed).toBe(SEED);
    expect(m.applicants).toBe(all.length);
    const h = createHash("sha256");
    const files = all.map((a) => {
      const text = gen.serialise(a);
      h.update(text).update("\n");
      return { id: a.truth.applicant_id, sha256: createHash("sha256").update(text).digest("hex") };
    });
    expect(h.digest("hex")).toBe(m.set_sha256);
    expect(files).toEqual(m.files.map(({ id, sha256 }) => ({ id, sha256 })));
  });
});
