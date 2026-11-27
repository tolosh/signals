// SIG-81, narrow (ruling 40741), written before the change. Observed expenses takes a version
// bump (1.2.0):
//   rule 1: other_expenses (Enrich: essential, unverified) counts inside living expenses, as its
//           own unverified line, never as discretionary;
//   rule 2: a debit LIA counts as a repayment is excluded from living expenses, whatever category
//           Enrich gave it (no double counting; review 18, O6).
// The replay is reported as run (research/runs/sig81-observed-expenses-<version>.json, written by
// scripts/sig81-replay.ts); the before record is 1.1.1's, taken before the change.
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  deriveObservedExpenses,
  OBSERVED_EXPENSES_METHOD_VERSION,
} from "../../../src/engines/affordability/observed-expenses.js";
import { pinnedLocalEnrich } from "../../../src/connectors/enrich/pinned.js";
import { generateApplicant, population } from "../../../src/research/generator/index.js";
import { generateSetV22 } from "../../../src/research/generator/v22/index.js";
import { generateSetV23 } from "../../../src/research/generator/v23/index.js";
import {
  debitsOf,
  replayApplicant,
  type SetApplicant,
} from "../../../src/research/sig81/replay.js";

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const AS_OF = "2026-10-31";
const tx = (id: string, day: string, amount: string, description = "SOME PAYEE") => ({
  accountId: "acc-1",
  transactionId: id,
  type: "PAYMENT",
  description,
  postingDateTime: `${day}T00:00:00Z`,
  amount,
});
/** Six monthly debits of each kind, May to October 2026, plus an income line to set the window. */
const FEED = {
  accounts: [
    {
      account: { accountId: "acc-1" },
      transactions: [
        tx("in-0", "2026-05-01", "4000.00", "SALARY"),
        ...[5, 6, 7, 8, 9, 10].flatMap((m) => {
          const d = `2026-${String(m).padStart(2, "0")}-15`;
          return [
            tx(`gro-${m}`, d, "-300.00"),
            tx(`oth-${m}`, d, "-120.00"),
            tx(`lend-${m}`, d, "-250.00", "SOMELENDER PL REPAYMENT"),
            tx(`gym-${m}`, d, "-40.00"),
          ];
        }),
      ],
    },
  ],
};
const CATEGORIES: Record<string, string> = Object.fromEntries(
  FEED.accounts[0]!.transactions.flatMap((t) => {
    if (t.transactionId.startsWith("gro")) return [[t.transactionId, "groceries"]];
    if (t.transactionId.startsWith("in")) return [[t.transactionId, "income"]];
    return [[t.transactionId, "other_expenses"]];
  }),
);
const LENDER = [5, 6, 7, 8, 9, 10].map((m) => `lend-${m}`);
const derive = (extra: Record<string, unknown> = {}) =>
  deriveObservedExpenses({
    feed: FEED,
    categories: CATEGORIES,
    as_of: AS_OF,
    lookback_months: 6,
    one_off_threshold_aud: 5000,
    ...extra,
  } as Parameters<typeof deriveObservedExpenses>[0]) as Mod;

describe("the version", () => {
  it("observed expenses is 1.2.0", () => {
    expect(OBSERVED_EXPENSES_METHOD_VERSION).toBe("1.2.0");
  });
});

describe("rule 1: other_expenses counts inside living expenses, as its own unverified line", () => {
  it("other_expenses is in living expenses and shown as unverified, not discretionary", () => {
    const o = derive();
    const months = o.months_covered as number;
    expect(months).toBeGreaterThan(0);
    // 120 + 250 + 40 a month of other_expenses, with no LIA repayments given.
    expect(o.unverified_monthly).toBeCloseTo((6 * 410) / months, 1);
    expect(o.discretionary_monthly).toBe(0);
    expect(o.basic_monthly).toBeCloseTo((6 * 300) / months, 1);
    expect(o.living_monthly).toBeCloseTo(
      o.committed_monthly + o.basic_monthly + o.unverified_monthly,
      2,
    );
  });
  it("an other_expenses debit above the one-off threshold is a one-off, as committed and basic are", () => {
    const big = {
      accounts: [
        {
          ...FEED.accounts[0]!,
          transactions: [...FEED.accounts[0]!.transactions, tx("big-1", "2026-09-20", "-6000.00")],
        },
      ],
    };
    const o = deriveObservedExpenses({
      feed: big,
      categories: { ...CATEGORIES, "big-1": "other_expenses" },
      as_of: AS_OF,
      lookback_months: 6,
      one_off_threshold_aud: 5000,
    }) as Mod;
    expect(o.one_offs.map((x: Mod) => x.transaction_id)).toEqual(["big-1"]);
    expect(o.unverified_monthly).toBeCloseTo(derive().unverified_monthly, 2);
  });
});

describe("rule 2: a debit LIA counts as a repayment is never also a living expense", () => {
  it("an LIA repayment in other_expenses is excluded, counted as a debt repayment", () => {
    const o = derive({ liability_repayments: LENDER });
    const months = o.months_covered as number;
    expect(o.unverified_monthly).toBeCloseTo((6 * 160) / months, 1);
    expect(o.excluded.debt_repayments).toBe(6);
    expect(o.lia_repayments_in_other_categories).toBe(6);
    expect(o.living_monthly).toBeCloseTo(derive().living_monthly - (6 * 250) / months, 1);
  });
  it("whatever its category: an LIA repayment Enrich called groceries is excluded too", () => {
    const o = derive({ liability_repayments: ["gro-5", "gro-6"] });
    expect(o.basic_monthly).toBeCloseTo((4 * 300) / (o.months_covered as number), 1);
    expect(o.lia_repayments_in_other_categories).toBe(2);
  });
  it("a repayment already in a debt category is counted once, as before", () => {
    const o = derive({
      liability_repayments: LENDER,
      categories: {
        ...CATEGORIES,
        ...Object.fromEntries(LENDER.map((id) => [id, "loan_repayment"])),
      },
    });
    expect(o.excluded.debt_repayments).toBe(6);
    expect(o.lia_repayments_in_other_categories).toBe(0);
  });
  it("no LIA repayments given: nothing else is excluded", () => {
    expect(derive({ liability_repayments: [] })).toEqual(derive());
  });
});

// The replay, reported as run.
type Row = {
  applicant_id: string;
  living_monthly: number;
  committed_monthly: number;
  basic_monthly: number;
  unverified_monthly?: number;
  discretionary_monthly: number;
  one_offs: number;
};
type SetRecord = { outputs_sha256: string; applicants: Row[] };
const record = (v: string): { sets?: Record<string, SetRecord> } | null => {
  const p = `research/runs/sig81-observed-expenses-${v}.json`;
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
};
const seed = (s: string) =>
  (JSON.parse(readFileSync(`research/datasets/${s}.manifest.json`, "utf8")) as { seed: number })
    .seed;
const fixture = (p: string) =>
  (JSON.parse(readFileSync(p, "utf8")) as { categories: Record<string, string> }).categories;

const replays: Record<string, ReturnType<typeof replayApplicant>[]> = {};
beforeAll(async () => {
  const v1 = population(seed("synthetic-v1")).map((s) =>
    generateApplicant(s, seed("synthetic-v1")),
  ) as unknown as SetApplicant[];
  const v22 = generateSetV22(seed("synthetic-v2.2")) as unknown as SetApplicant[];
  const v23 = generateSetV23(seed("synthetic-v2.3")) as unknown as SetApplicant[];
  const c1 = fixture("research/enrich/synthetic-v1-categories-engine-1.8.0.json");
  const c22 = fixture("research/enrich/synthetic-v2.2-categories-no-biller-code-engine-1.8.0.json");
  const r23 = await pinnedLocalEnrich().categorise(debitsOf(v23, true));
  const c23 = Object.fromEntries(r23.results.map((r) => [r.transaction_id, r.category]));
  replays["synthetic-v1"] = v1.map((a) => replayApplicant(a, c1));
  replays["synthetic-v2.2"] = v22.map((a) => replayApplicant(a, c22));
  replays["synthetic-v2.3"] = v23.map((a) => replayApplicant(a, c23));
}, 300_000);

const SETS = ["synthetic-v1", "synthetic-v2.2", "synthetic-v2.3"] as const;
describe("the replay over sets v1, v2.2 and v2.3, as run", () => {
  it.each(SETS)("%s: committed and basic are 1.1.1's; living adds the unverified line", (set) => {
    const before = record("1.1.1")?.sets?.[set]?.applicants ?? [];
    expect(before).toHaveLength(replays[set]?.length ?? -1);
    const off: string[] = [];
    for (const [i, r] of (replays[set] ?? []).entries()) {
      const o = r.observed as Mod;
      const b = before[i]!;
      if (b.applicant_id !== r.applicant_id) off.push(`${r.applicant_id}: order`);
      if (typeof o.unverified_monthly !== "number") {
        off.push(`${r.applicant_id}: no unverified line`);
        continue;
      }
      // Before SIG-83, LIA's repayments are all in debt categories, so committed and basic stay.
      if (o.committed_monthly !== b.committed_monthly) off.push(`${r.applicant_id}: committed`);
      if (o.basic_monthly !== b.basic_monthly) off.push(`${r.applicant_id}: basic`);
      const sum = Math.round((o.committed_monthly + o.basic_monthly + o.unverified_monthly) * 100);
      if (Math.abs(Math.round(o.living_monthly * 100) - sum) > 1)
        off.push(`${r.applicant_id}: living`);
      // The unverified line comes out of discretionary (less any other_expenses one-off).
      const moved = o.unverified_monthly + o.discretionary_monthly;
      if (moved > b.discretionary_monthly + 0.02) off.push(`${r.applicant_id}: discretionary`);
      if (o.one_offs.length === b.one_offs && Math.abs(moved - b.discretionary_monthly) > 0.02)
        off.push(`${r.applicant_id}: unverified`);
    }
    expect(off).toEqual([]);
  });
  it.each(SETS)("%s: the 1.2.0 run record reproduces (D28)", (set) => {
    const after = record("1.2.0")?.sets?.[set];
    const sha = createHash("sha256").update(JSON.stringify(replays[set])).digest("hex");
    expect(after?.outputs_sha256).toBe(sha);
  });
});
