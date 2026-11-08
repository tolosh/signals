// SIG-54 section 6: T1 (determinism), T2 (CDR shapes), T3 (ground truth 2.0.0, consistent), T5
// (every population at its minimum; every applicant has a request, drawn independently of
// history), and T6 (set v1 still regenerates to its published hash).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  GROUND_TRUTH_SCHEMA_VERSION_V2,
  SET_V2_MINIMUMS,
  SET_V2_SEED,
  generateApplicant,
  population,
  populationV2,
  serialise,
  type GeneratedApplicant,
} from "../../../src/research/generator/index.js";

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
const load = (p: string) => JSON.parse(readFileSync(p, "utf8")) as { $id: string };
const cdr = load("research/schemas/cdr-banking-v1.schema.json");
ajv.addSchema(cdr);
const validateTruth = ajv.compile(load("research/schemas/ground-truth-v2.schema.json"));
const shape = (def: string) => {
  const v = ajv.getSchema(`${cdr.$id}#/$defs/${def}`);
  if (!v) throw new Error(`no schema ${def}`);
  return v;
};

const POP = populationV2(SET_V2_SEED);
const all = POP.map((spec) => generateApplicant(spec, SET_V2_SEED));
const surplusOf = (t: GeneratedApplicant["truth"]) =>
  t.income.net_monthly - t.expenses.total_monthly - t.liabilities.repayments_monthly;
const consistency = (t: GeneratedApplicant["truth"]) => {
  const bad: string[] = [];
  if (Math.abs(surplusOf(t) - t.surplus_monthly) > 0.005) bad.push("surplus");
  const groups =
    t.expenses.committed_monthly + t.expenses.basic_monthly + t.expenses.discretionary_monthly;
  if (Math.abs(groups - t.expenses.total_monthly) > 0.005) bad.push("groups");
  return bad;
};

describe("T1 determinism", () => {
  it("set v2's seed twice gives byte-identical output", () => {
    const again = populationV2(SET_V2_SEED).map((s) => generateApplicant(s, SET_V2_SEED));
    expect(again.map(serialise).join("\n")).toBe(all.map(serialise).join("\n"));
  }, 120_000);
  it("negative control: a different seed gives different output", () => {
    const other = populationV2(SET_V2_SEED + 1).map((s) => generateApplicant(s, SET_V2_SEED + 1));
    expect(other.map(serialise).join("\n")).not.toBe(all.map(serialise).join("\n"));
  }, 120_000);
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
  }, 120_000);
});

describe("T3 ground truth 2.0.0", () => {
  it("validates against the schema and is internally consistent", () => {
    const bad: string[] = [];
    for (const a of all) {
      const t = a.truth;
      if (!validateTruth(structuredClone(t) as unknown))
        bad.push(`${t.applicant_id}: ${ajv.errorsText(validateTruth.errors)}`);
      for (const b of consistency(t)) bad.push(`${t.applicant_id}: ${b}`);
      expect(t.schema_version).toBe(GROUND_TRUTH_SCHEMA_VERSION_V2);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
  it("negative control: a tampered surplus fails the consistency check", () => {
    const t = structuredClone(all[0]!.truth);
    t.surplus_monthly += 1;
    expect(consistency(t)).toEqual(["surplus"]);
  });
  it("negative control: the v1 truth schema rejects a v2 truth", () => {
    const v1 = ajv.compile(load("research/schemas/ground-truth-v1.schema.json"));
    expect(v1(structuredClone(all[0]!.truth) as unknown)).toBe(false);
  });
  it("every labelled transaction ID exists in the feed", () => {
    const missing: string[] = [];
    for (const a of all) {
      const ids = new Set(
        a.feed.accounts.flatMap((acc) => acc.transactions.map((t) => t.transactionId)),
      );
      const v2 = a.truth.v2!;
      const labelled = [
        ...v2.pay_events.map((e) => e.transaction_id),
        ...v2.dishonour_events.map((e) => e.transaction_id),
        ...v2.bpay.map((b) => b.transaction_id),
        ...v2.liabilities.flatMap((l) => l.repayment_transaction_ids),
      ];
      for (const id of labelled)
        if (id && !ids.has(id)) missing.push(`${a.truth.applicant_id} ${id}`);
    }
    expect(missing.slice(0, 5)).toEqual([]);
  });
});

describe("T5 every population is present at its minimum", () => {
  const count = (tag: string) => POP.filter((s) => s.tags.includes(tag)).length;
  it("each tag in the minimums meets its count", () => {
    const short = Object.entries(SET_V2_MINIMUMS)
      .filter(([tag, min]) => count(tag) < min)
      .map(([tag, min]) => `${tag}: ${count(tag)} < ${min}`);
    expect(short).toEqual([]);
  });
  it("salaried is exactly 200: at least 100 irregular, at least 40 drift, the rest fixed", () => {
    expect(count("salaried")).toBe(200);
    expect(
      count("salaried-irregular") + count("salaried-payer-drift") + count("salaried-fixed"),
    ).toBe(200);
  });
  it("every applicant has a requested lookback of 3, 6 or 12, with 6 most common", () => {
    const requests = all.map((a) => a.truth.v2?.request.lookback_months);
    expect(requests.every((r) => r === 3 || r === 6 || r === 12)).toBe(true);
    const n = (m: number) => requests.filter((r) => r === m).length;
    expect(n(6)).toBeGreaterThan(n(3));
    expect(n(6)).toBeGreaterThan(n(12));
  });
  it("request and history are independent: every request appears with every history length", () => {
    const pairs = new Set(
      all.map((a) => `${a.truth.v2?.request.lookback_months}/${a.truth.history.months}`),
    );
    const missing = [3, 6, 12].flatMap((r) =>
      [1, 3, 6, 12].filter((h) => !pairs.has(`${r}/${h}`)).map((h) => `${r}/${h}`),
    );
    expect(missing).toEqual([]);
  });
  it("some applicants hold less history than they were asked for", () => {
    expect(
      all.filter((a) => a.truth.history.months < (a.truth.v2?.request.lookback_months ?? 0)).length,
    ).toBeGreaterThan(20);
  });
  it("dishonour groups: recent means within 90 days, old-only means none within 90", () => {
    for (const a of all) {
      const ev = a.truth.v2!.dishonour_events;
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
  it("H2 groups carry their labels", () => {
    const with_ = (tag: string) => all.filter((a) => a.truth.tags.includes(tag));
    for (const a of with_("unseen-lenders"))
      expect(a.truth.v2!.liabilities.some((l) => l.unseen_lender)).toBe(true);
    for (const a of with_("repaid-from-unshared"))
      expect(
        a.truth.v2!.liabilities.some(
          (l) => !l.paid_from_shared && l.repayment_transaction_ids.length === 0,
        ),
      ).toBe(true);
    for (const a of with_("natural-declarations"))
      expect(a.application.declared_liabilities.some((d) => /[a-z]/.test(d.provider))).toBe(true);
    for (const a of with_("reference-noise"))
      expect(a.truth.v2!.liabilities.some((l) => l.narrative_ref !== null)).toBe(true);
    for (const a of with_("no-card-biller-cue"))
      expect(a.truth.v2!.liabilities.some((l) => !l.biller_cue)).toBe(true);
    const grant = with_("undisclosed-personal-loan").concat(with_("undisclosed-car-loan"));
    expect(grant.filter((a) => a.truth.tags.includes("account-in-grant"))).toHaveLength(20);
    expect(grant.filter((a) => a.truth.tags.includes("account-not-in-grant"))).toHaveLength(20);
    expect(with_("mortgage-undisclosed").length).toBeGreaterThan(0);
  });
});

describe("T6 set v1 is unchanged", () => {
  it("seed 42 still regenerates to the published set hash", () => {
    const h = createHash("sha256");
    for (const s of population(42)) h.update(serialise(generateApplicant(s, 42))).update("\n");
    expect(h.digest("hex")).toBe(
      "8f5cf973ec46b33bbeccd97e87dcde10edea22919ed9af9bc9469149b2e17ea9",
    );
  }, 60_000);
});

describe("the committed manifest reproduces (D28)", () => {
  it("regenerating set v2 gives the manifest's set hash, counts and per-applicant hashes", () => {
    const m = JSON.parse(readFileSync("research/datasets/synthetic-v2.manifest.json", "utf8")) as {
      seed: number;
      applicants: number;
      set_sha256: string;
      files: { id: string; sha256: string }[];
    };
    expect(m.seed).toBe(SET_V2_SEED);
    expect(m.applicants).toBe(all.length);
    const h = createHash("sha256");
    const files = all.map((a) => {
      const text = serialise(a);
      h.update(text).update("\n");
      return { id: a.truth.applicant_id, sha256: createHash("sha256").update(text).digest("hex") };
    });
    expect(h.digest("hex")).toBe(m.set_sha256);
    expect(files).toEqual(m.files.map(({ id, sha256 }) => ({ id, sha256 })));
  });
});
