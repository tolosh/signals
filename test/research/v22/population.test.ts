// SIG-60 set v2.2: T1 to T6 (section 6), written before the generator. The generator is loaded
// dynamically so that, until it exists, every test fails on an assertion rather than an import.
import { createHash, createHmac } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import type { GeneratedApplicant } from "../../../src/research/generator/index.js";
import { serialise } from "../../../src/research/generator/index.js";
import { netFromGross, taxTable } from "../../../src/research/generator/tax.js";

type V22 = {
  generateSetV22: (seed: number) => GeneratedApplicant[];
  SET_V22_SEED: number;
  SET_V22_MINIMUMS: Record<string, number>;
  GENERATOR_VERSION_V22: string;
  GROUND_TRUTH_SCHEMA_VERSION_V22: string;
};
const MODULE = "../../../src/research/generator/v22/index.js";
let g: V22 | null = null;
let all: GeneratedApplicant[] = [];
beforeAll(async () => {
  try {
    g = (await import(/* @vite-ignore */ MODULE)) as V22;
    all = g.generateSetV22(g.SET_V22_SEED);
  } catch {
    g = null;
  }
}, 300_000);
const need = (): V22 => {
  expect(g, "the set v2.2 generator exists").not.toBeNull();
  return g as V22;
};
const SCHEMA = "research/schemas/ground-truth-v2.2.schema.json";
const MANIFEST = "research/datasets/synthetic-v2.2.manifest.json";
const lines = (a: GeneratedApplicant) => a.feed.accounts.flatMap((acc) => acc.transactions);
type Extras = {
  pay_transaction_ids: string[];
  drift: { mode: string; alias: string; transaction_ids: string[] } | null;
  dishonour_lines: { debit: string; returned: string; fee: string | null }[];
  declared_link: (string | null)[];
};
const extras = (a: GeneratedApplicant) => a.truth.v2 as unknown as Extras;

describe("v2.2 T1 determinism", () => {
  it("the same seed twice gives byte-identical output; a different seed doesn't", () => {
    const v = need();
    const text = all.map(serialise).join("\n");
    expect(v.generateSetV22(v.SET_V22_SEED).map(serialise).join("\n")).toBe(text);
    expect(
      v
        .generateSetV22(v.SET_V22_SEED + 1)
        .map(serialise)
        .join("\n"),
    ).not.toBe(text);
  }, 300_000);
  it("is generator 2.2.0 and ground truth 2.2.0, with its own seed", () => {
    const v = need();
    expect(v.GENERATOR_VERSION_V22).toBe("2.2.0");
    expect(v.GROUND_TRUTH_SCHEMA_VERSION_V22).toBe("2.2.0");
    expect([42, 54, 541]).not.toContain(v.SET_V22_SEED);
    for (const a of all) {
      expect(a.truth.generator_version).toBe("2.2.0");
      expect(a.truth.schema_version).toBe("2.2.0");
    }
  });
});

describe("v2.2 IDs come from HMAC(seed, counter), in a shuffled order", () => {
  it("applicant k is HMAC-SHA256(seed, 'applicant|k'), in output order", () => {
    const v = need();
    all.forEach((a, k) =>
      expect(a.truth.applicant_id).toBe(
        `syn-v22-${createHmac("sha256", String(v.SET_V22_SEED)).update(`applicant|${k}`).digest("hex").slice(0, 16)}`,
      ),
    );
  });
  it("account and transaction IDs carry no applicant ID, index or digit", () => {
    need();
    for (const a of all)
      for (const acc of a.feed.accounts) {
        const id = String((acc.account as { accountId: string }).accountId);
        expect(id).toMatch(/^[a-z]+$/);
        for (const t of acc.transactions) expect(t.transactionId).toMatch(/^[a-z]+$/);
      }
  });
});

describe("v2.2 T2 CDR shapes", () => {
  it("accounts, details, balances and transactions validate", () => {
    need();
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats.default(ajv);
    const cdr = JSON.parse(readFileSync("research/schemas/cdr-banking-v1.schema.json", "utf8")) as {
      $id: string;
    };
    ajv.addSchema(cdr);
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
        const validate = ajv.getSchema(`${cdr.$id}#/$defs/${def}`);
        expect(validate, def).toBeTruthy();
        if (validate && !validate(value)) errors.push(`${a.truth.applicant_id} ${def}`);
      }
    expect(errors.slice(0, 5)).toEqual([]);
  }, 120_000);
});

describe("v2.2 T3 ground truth 2.2.0", () => {
  it("validates and is consistent; every labelled ID is in the feed", () => {
    need();
    expect(existsSync(SCHEMA)).toBe(true);
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats.default(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(SCHEMA, "utf8")) as object);
    const bad: string[] = [];
    for (const a of all) {
      const t = a.truth;
      if (!validate(structuredClone(t) as unknown)) bad.push(`${t.applicant_id}: schema`);
      const surplus =
        t.income.net_monthly - t.expenses.total_monthly - t.liabilities.repayments_monthly;
      if (Math.abs(surplus - t.surplus_monthly) > 0.005) bad.push(`${t.applicant_id}: surplus`);
      const ids = new Set(lines(a).map((x) => x.transactionId));
      const v2 = t.v2;
      const x = extras(a);
      if (!v2) {
        bad.push(`${t.applicant_id}: no v2 block`);
        continue;
      }
      for (const id of [
        ...v2.pay_events.map((e) => e.transaction_id),
        ...v2.dishonour_events.map((e) => e.transaction_id),
        ...v2.bpay.map((b) => b.transaction_id),
        ...v2.liabilities.flatMap((l) => l.repayment_transaction_ids),
        ...x.pay_transaction_ids,
        ...(x.drift?.transaction_ids ?? []),
        ...x.dishonour_lines.flatMap((d) => [d.debit, d.returned, ...(d.fee ? [d.fee] : [])]),
      ])
        if (id && !ids.has(id)) bad.push(`${t.applicant_id}: ${id}`);
      const declaredIds = new Set(t.liabilities.items.filter((l) => l.declared).map((l) => l.id));
      expect(x.declared_link.length).toBe(a.application.declared_liabilities.length);
      for (const link of x.declared_link)
        if (!link || !declaredIds.has(link)) bad.push(`${t.applicant_id}: declared link ${link}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  }, 120_000);
});

describe("v2.2 T4 tax and the static scan", () => {
  it("net recomputes from gross through the tax table for every taxed applicant", () => {
    need();
    let taxed = 0;
    for (const a of all) {
      const tax = a.truth.v2?.tax;
      if (!tax) continue;
      taxed++;
      expect(netFromGross(tax.gross_annual, taxTable("2026-27"))).toEqual({
        gross_annual: tax.gross_annual,
        tax: tax.tax,
        medicare_levy: tax.medicare_levy,
        net_annual: tax.net_annual,
        tax_table: tax.tax_table,
      });
    }
    expect(taxed).toBeGreaterThan(400);
  });
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
    });
  it("the generator imports nothing from src/engines/, and no engine imports the generator", () => {
    need();
    const gen = files("src/research/generator").filter((p) =>
      /from\s+["'][^"']*engines\//.test(readFileSync(p, "utf8")),
    );
    const eng = files("src/engines").filter((p) =>
      /from\s+["'][^"']*research\//.test(readFileSync(p, "utf8")),
    );
    expect([...gen, ...eng]).toEqual([]);
  });
});

describe("v2.2 T5 populations and the request", () => {
  const count = (tag: string) => all.filter((a) => a.truth.tags.includes(tag)).length;
  it("every tag meets its minimum, and the minimums carry forward set v2.1's", () => {
    const v = need();
    const v21 = JSON.parse(
      readFileSync("research/datasets/synthetic-v2.1.manifest.json", "utf8"),
    ) as { minimums: Record<string, number> };
    for (const [tag, min] of Object.entries(v21.minimums))
      expect(v.SET_V22_MINIMUMS[tag], tag).toBeGreaterThanOrEqual(min);
    expect(
      Object.entries(v.SET_V22_MINIMUMS)
        .filter(([t, m]) => count(t) < m)
        .map(([t, m]) => `${t}: ${count(t)} < ${m}`),
    ).toEqual([]);
  });
  it("the request is independent of history: every pair, chi-square and permutation p > 0.05", () => {
    need();
    const R = [3, 6, 12];
    const H = [1, 3, 6, 12];
    const req = all.map((a) => a.truth.v2?.request.lookback_months ?? 0);
    const his = all.map((a) => a.truth.history.months);
    const chi = (r: number[]) => {
      let x = 0;
      for (const i of R)
        for (const j of H) {
          const e =
            (r.filter((v) => v === i).length * his.filter((v) => v === j).length) / r.length;
          const o = r.filter((v, k) => v === i && his[k] === j).length;
          if (e > 0) x += (o - e) ** 2 / e;
        }
      return x;
    };
    const observed = chi(req);
    for (const i of R)
      for (const j of H) expect(req.some((v, k) => v === i && his[k] === j)).toBe(true);
    // 6 degrees of freedom: the 0.95 quantile is 12.592.
    expect(observed).toBeLessThan(12.592);
    // Permutation test with a fixed shuffle (SHA-256), 2,000 permutations.
    let atLeast = 0;
    const perm = [...req];
    for (let p = 0; p < 2000; p++) {
      for (let i = perm.length - 1; i > 0; i--) {
        const j = createHash("sha256").update(`perm|${p}|${i}`).digest().readUInt32BE(0) % (i + 1);
        [perm[i], perm[j]] = [perm[j] as number, perm[i] as number];
      }
      if (chi(perm) >= observed) atLeast++;
    }
    expect(atLeast / 2000).toBeGreaterThan(0.05);
  }, 120_000);
  it("dishonour groups: recent within 90 days, two-plus has at least two, old-only none recent", () => {
    need();
    for (const a of all) {
      const ev = a.truth.v2?.dishonour_events ?? [];
      const tags = a.truth.tags;
      if (tags.includes("dishonour-one-recent")) expect(ev.filter((e) => e.recent)).toHaveLength(1);
      if (tags.includes("dishonour-two-plus-recent"))
        expect(ev.filter((e) => e.recent).length).toBeGreaterThanOrEqual(2);
      if (tags.includes("dishonour-old-only")) {
        expect(ev.length).toBeGreaterThan(0);
        expect(ev.some((e) => e.recent)).toBe(false);
      }
      if (tags.includes("dishonour-clean")) expect(ev).toEqual([]);
    }
  });
});

describe("v2.2 T6 hashes", () => {
  it("the committed manifest reproduces: seed, count, set hash and per-applicant hashes", () => {
    const v = need();
    expect(existsSync(MANIFEST)).toBe(true);
    const m = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
      seed: number;
      applicants: number;
      set_sha256: string;
      generator_version: string;
      files: { id: string; sha256: string }[];
      withdrawn?: unknown;
    };
    expect(m.seed).toBe(v.SET_V22_SEED);
    expect(m.generator_version).toBe("2.2.0");
    expect(m.applicants).toBe(all.length);
    expect(m.withdrawn).toBeUndefined();
    const h = createHash("sha256");
    const files = all.map((a) => {
      const text = serialise(a);
      h.update(text).update("\n");
      return { id: a.truth.applicant_id, sha256: createHash("sha256").update(text).digest("hex") };
    });
    expect(h.digest("hex")).toBe(m.set_sha256);
    expect(files).toEqual(m.files.map(({ id, sha256 }) => ({ id, sha256 })));
  }, 120_000);
});
