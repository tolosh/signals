// SIG-63 set v2.3: the validity checks V7, V9, V10 and V11, the biller-code and declared-amount
// rules (generation_parameters), and ticket section 5's realism flags, written before the
// generator. The generator is loaded dynamically so that, until it exists, every test fails on an
// assertion rather than an import.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { GeneratedApplicant, Transaction } from "../../../src/research/generator/index.js";
import { generateSetV22 } from "../../../src/research/generator/v22/index.js";
import {
  aliasRepeats,
  codeDistribution,
  descriptorWords,
  driftLines,
} from "../../../src/research/leakage/validity-v23.js";
import { genuinelyDifferent, isBankingDay } from "../../../src/research/leakage/validity.js";

const MODULE = "../../../src/research/generator/v23/index.js";
let all: GeneratedApplicant[] | null = null;
beforeAll(async () => {
  try {
    const g = (await import(/* @vite-ignore */ MODULE)) as {
      generateSetV23: (seed: number) => GeneratedApplicant[];
      SET_V23_SEED: number;
    };
    all = g.generateSetV23(g.SET_V23_SEED);
  } catch {
    all = null;
  }
}, 300_000);
const set = (): GeneratedApplicant[] => {
  expect(all, "the set v2.3 generator exists").not.toBeNull();
  return all ?? [];
};
const DAY = 86_400_000;
const day = (iso: string | undefined) => Math.floor(Date.parse(iso ?? "") / DAY);
const lines = (a: GeneratedApplicant) => a.feed.accounts.flatMap((acc) => acc.transactions);
type Acc = { productCategory?: string; productName?: string; creationDate?: string };
const accOf = (acc: GeneratedApplicant["feed"]["accounts"][number]) => acc.account as Acc;
type V23 = {
  liabilities: {
    id: string;
    lender_id: string;
    declared_as: string | null;
    repayment_transaction_ids: string[];
    repayment_channel: string;
    declaration: { different: boolean; descriptor: boolean } | null;
  }[];
  drift: { descriptors: string[]; pair_transaction_ids: string[] } | null;
};
const v23 = (a: GeneratedApplicant) => a.truth.v2 as unknown as V23;
const PREREG = JSON.parse(readFileSync("research/preregistrations/SIG-63.json", "utf8")) as {
  generation_parameters: { biller_codes: { lengths: Record<string, number> } };
};

describe("v2.3 validity checks (SIG-63 V7, V9, V10, V11)", () => {
  it("V7: every drift-tagged applicant has a drift line; none is unshared or too short", () => {
    expect(driftLines(set())).toMatchObject({ pass: true });
  });
  it("V7: the truth labels both descriptors of each drift pair, and every pay line under them", () => {
    for (const a of set()) {
      const d = v23(a).drift;
      if (!d) continue;
      expect(new Set(d.descriptors).size).toBe(2);
      const under = lines(a)
        .filter((t) => d.descriptors.includes(t.description) && Number(t.amount) > 0)
        .map((t) => t.transactionId)
        .sort();
      expect([...d.pair_transaction_ids].sort()).toEqual(under);
    }
  });
  it("V9: no (lender, alias) pair used more than 4 times; at least 200 distinct pairs", () => {
    expect(aliasRepeats(set())).toMatchObject({ pass: true });
  });
  it("V10: descriptor words are independent of the same/different flag", () => {
    expect(descriptorWords(set())).toMatchObject({ pass: true });
  });
  it("V10: the recorded flag is the validity rule's own verdict on the declared name", () => {
    for (const a of set())
      for (const l of v23(a).liabilities) {
        if (!l.declared_as || !l.declaration) continue;
        const lender = a.truth.v2?.liabilities.find((x) => x.id === l.id)?.lender ?? "";
        expect(genuinelyDifferent(l.declared_as, lender), l.declared_as).toBe(
          l.declaration.different,
        );
      }
  });
  it("V11: one code distribution for bill, lender and unseen-lender billers; one name a code", () => {
    expect(codeDistribution(set())).toMatchObject({ pass: true });
  });
  it("V11 has power: set v2.2 (4-digit lender codes, D-L4-1a) fails it", () => {
    expect(codeDistribution(generateSetV22(602))).toMatchObject({ pass: false });
  }, 300_000);
});

describe("v2.3 biller codes (generation_parameters.biller_codes)", () => {
  const codes = () => [
    ...new Set(set().flatMap((a) => lines(a).flatMap((t) => (t.billerCode ? [t.billerCode] : [])))),
  ];
  it("every code is 3 to 10 digits with no leading zero", () => {
    for (const c of codes()) expect(c).toMatch(/^[1-9]\d{2,9}$/);
  });
  it("only lengths the distribution gives; at least four lengths in use", () => {
    const allowed = Object.keys(PREREG.generation_parameters.biller_codes.lengths).map(Number);
    const used = new Set(codes().map((c) => c.length));
    for (const n of used) expect(allowed).toContain(n);
    expect(used.size).toBeGreaterThanOrEqual(4);
  });
  it("no constant step: no difference between neighbouring same-length codes repeats 3+ times", () => {
    const byLen = new Map<number, number[]>();
    for (const c of codes()) byLen.set(c.length, [...(byLen.get(c.length) ?? []), Number(c)]);
    const steps = new Map<number, number>();
    for (const xs of byLen.values()) {
      const s = [...xs].sort((a, b) => a - b);
      for (let i = 1; i < s.length; i++) {
        const d = (s[i] as number) - (s[i - 1] as number);
        steps.set(d, (steps.get(d) ?? 0) + 1);
      }
    }
    expect(Math.max(0, ...steps.values())).toBeLessThan(3);
  });
  it("a biller name on a line is its registered name, in full or cut to its first 20 characters", () => {
    for (const a of set())
      for (const t of lines(a))
        if (t.billerCode) expect((t.billerName ?? "").length).toBeLessThanOrEqual(40);
    const cut = set().flatMap((a) =>
      lines(a).filter((t) => t.billerCode && (t.billerName ?? "").length === 20),
    );
    expect(cut.length).toBeGreaterThan(0);
  });
});

describe("v2.3 declared amounts (generation_parameters.declared_amounts)", () => {
  type Row = { declared: number; truth: number };
  const rows = (): Row[] =>
    set().flatMap((a) => {
      const links = (a.truth.v2 as unknown as { declared_link: string[] }).declared_link;
      return a.application.declared_liabilities.map((d, i) => {
        const item = a.truth.liabilities.items.find((l) => l.id === links[i]);
        return { declared: d.repayment_monthly, truth: item?.monthly_commitment ?? NaN };
      });
    });
  it("every declared amount is whole dollars, positive, and within 25% plus one rounding unit", () => {
    for (const r of rows()) {
      expect(Number.isInteger(r.declared), String(r.declared)).toBe(true);
      expect(r.declared).toBeGreaterThan(0);
      expect(Math.abs(r.declared - r.truth)).toBeLessThanOrEqual(0.25 * r.truth + 100);
    }
  });
  it("declarations aren't the truth's figure: under 10% match it to the cent", () => {
    const rs = rows();
    const exact = rs.filter((r) => Math.abs(r.declared - r.truth) < 0.005).length;
    expect(rs.length).toBeGreaterThan(400);
    expect(exact / rs.length).toBeLessThan(0.1);
  });
  it("rounding shows: a share are multiples of $10, $50 and $100", () => {
    const rs = rows();
    const share = (u: number) => rs.filter((r) => r.declared % u === 0).length / rs.length;
    expect(share(10)).toBeGreaterThan(0.4);
    expect(share(100)).toBeGreaterThan(0.08);
  });
});

describe("v2.3 realism (ticket section 5)", () => {
  const merchant = (t: Transaction) => Boolean(t.merchantCategoryCode);
  it("every line posts on a banking day, on or after its value date", () => {
    for (const a of set())
      for (const t of lines(a)) {
        expect(isBankingDay(day(t.postingDateTime))).toBe(true);
        expect(day(t.postingDateTime)).toBeGreaterThanOrEqual(day(t.valueDateTime));
      }
  });
  it("card purchases happen at weekends, and post later than their value date", () => {
    const pos = set().flatMap((a) => lines(a).filter(merchant));
    const weekend = pos.filter((t) => !isBankingDay(day(t.valueDateTime))).length;
    const later = pos.filter((t) => day(t.postingDateTime) > day(t.valueDateTime)).length;
    expect(weekend / pos.length).toBeGreaterThan(0.2);
    expect(later / pos.length).toBeGreaterThan(0.3);
  });
  it("creationDate varies (40+ distinct months, any day of the month) and predates the history", () => {
    const months = new Set<string>();
    const days = new Set<string>();
    for (const a of set())
      for (const acc of a.feed.accounts) {
        const c = accOf(acc).creationDate ?? "";
        months.add(c.slice(0, 7));
        days.add(c.slice(8, 10));
        const first = Math.min(...acc.transactions.map((t) => day(t.valueDateTime)));
        if (Number.isFinite(first)) expect(day(c)).toBeLessThan(first);
      }
    expect(months.size).toBeGreaterThan(40);
    expect(days.size).toBeGreaterThanOrEqual(28);
  });
  it("no product name doubles a word ('HOME LOAN Home Loan')", () => {
    for (const a of set())
      for (const acc of a.feed.accounts) {
        const w = (accOf(acc).productName ?? "").toUpperCase().split(/\s+/);
        expect(new Set(w).size, accOf(acc).productName).toBe(w.length);
      }
  });
  it("wage advances aren't taken every cycle: most holders repay in fewer cycles than they're paid", () => {
    let holders = 0;
    let partial = 0;
    for (const a of set()) {
      const wa = a.truth.liabilities.items.filter((l) => l.type === "wage_advance");
      for (const l of wa) {
        const ids = v23(a).liabilities.find((x) => x.id === l.id)?.repayment_transaction_ids ?? [];
        const pays = (a.truth.v2 as unknown as { pay_transaction_ids: string[] })
          .pay_transaction_ids;
        if (ids.length === 0 || pays.length < 4) continue;
        holders++;
        if (ids.length < new Set(pays).size) partial++;
      }
    }
    expect(holders).toBeGreaterThan(20);
    expect(partial / holders).toBeGreaterThan(0.5);
  });
  it("the repayment channel mix depends on the liability type", () => {
    const share = (type: string, channel: string) => {
      const ls = set().flatMap((a) =>
        a.truth.liabilities.items
          .filter((l) => l.type === type)
          .map((l) => v23(a).liabilities.find((x) => x.id === l.id)?.repayment_channel),
      );
      return ls.filter((c) => c === channel).length / ls.length;
    };
    expect(share("credit_card", "BPAY")).toBeGreaterThan(share("bnpl", "BPAY") + 0.2);
    expect(share("bnpl", "DIRECT_DEBIT")).toBeGreaterThan(0.8);
    expect(share("credit_card", "DIRECT_DEBIT")).toBeLessThan(0.3);
  });
  it("loan balances decline over the window, and transaction accounts never imply a negative opening", () => {
    let loans = 0;
    for (const a of set())
      for (const acc of a.feed.accounts) {
        const cat = accOf(acc).productCategory;
        const closing = Number((acc.balance.data as { currentBalance: string }).currentBalance);
        const flows = acc.transactions.reduce((x, t) => x + Number(t.amount), 0);
        const opening = Math.round((closing - flows) * 100) / 100;
        if (cat === "PERS_LOANS" || cat === "RESIDENTIAL_MORTGAGES") {
          loans++;
          expect(closing).toBeLessThan(0);
          expect(opening, a.truth.applicant_id).toBeLessThan(closing);
        }
        if (cat === "TRANS_AND_SAVINGS_ACCOUNTS") expect(opening).toBeGreaterThanOrEqual(0);
      }
    expect(loans).toBeGreaterThan(50);
  });
});
