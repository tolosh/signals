// SIG-55: EQ-03 detects gaps in the middle of the lookback window (found by the SIG-39 review).
// Coverage is the days covered by returned data: a silence that is a gap (E-10) is
// uncovered. Interpretations E-9 (measured across the feed) and E-10 (a silence is judged against
// its neighbours) are in docs/adr/0002-evidence-quality-interpretations.md, for ruling.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AS_OF_DATE,
  generateApplicant,
  population,
} from "../../../src/research/generator/index.js";
import {
  applyEvidence,
  assessEvidence,
  EQ_METHOD_VERSION,
  type EvidenceCheck,
  type Feed,
} from "../../../src/engines/evidence/index.js";
import { FULL, INC_01, applicant, input } from "./helpers.js";
import type { GeneratedApplicant } from "../../../src/research/generator/index.js";

const eq03 = (checks: EvidenceCheck[]) => {
  const c = checks.find((x) => x.id === "EQ-03");
  if (!c) throw new Error("no EQ-03");
  return c;
};
/** Removes every transaction from `from` to `to` inclusive, as if the data holder skipped them. */
function hole(a: GeneratedApplicant, from: string, to: string): GeneratedApplicant {
  const feed = a.feed as unknown as Feed;
  return {
    ...a,
    feed: {
      ...a.feed,
      accounts: feed.accounts.map((acc) => ({
        ...acc,
        transactions: acc.transactions.filter((t) => {
          const d = (t.postingDateTime ?? "").slice(0, 10);
          return d < from || d > to;
        }),
      })),
    } as unknown as GeneratedApplicant["feed"],
  };
}
const base = applicant(FULL, "sig-55-full");

describe("SIG-55 T1 to T3: a hole in the middle of the window", () => {
  it("T1: a 31-day hole in a 6-month window makes EQ-03 partial, and the detail names it", () => {
    const c = eq03(assessEvidence(input(hole(base, "2026-07-01", "2026-07-31"))).checks);
    expect(c.result).toBe("partial");
    expect(c.detail).toMatch(/No transactions from 2026-0[67]-\d\d to 2026-0[78]-\d\d/);
    expect(c.resolve_with.join(" ")).toMatch(/Share the full history from 2026-0[67]-\d\d to/);
    expect(c.detail).not.toMatch(/\d{6,}/);
  });

  it("T2: a 90-day hole makes EQ-03 fail, and the signals unverified (RU-4)", () => {
    const ctx = assessEvidence(input(hole(base, "2026-06-01", "2026-08-29")));
    expect(eq03(ctx.checks).result).toBe("fail");
    expect(applyEvidence([INC_01], ctx)[0]?.state).toBe("unverified");
  });

  it("T3 (negative control): a gap-free feed with a quiet fortnight passes", () => {
    expect(eq03(assessEvidence(input(base)).checks).result).toBe("pass");
    const quiet = eq03(assessEvidence(input(hole(base, "2026-07-01", "2026-07-14"))).checks);
    expect(quiet.result).toBe("pass");
    expect(quiet.detail).not.toMatch(/No transactions from/);
  });
});

describe("SIG-55 E-10: a silence is judged against its neighbours", () => {
  it("a feed active only once a month has no gaps, but a 3-month hole in it is still found", () => {
    const monthly = (months: number[]): GeneratedApplicant => {
      const feed = base.feed as unknown as Feed;
      const [first] = feed.accounts;
      if (!first) throw new Error("no account");
      const transactions = months.map((m, i) => ({
        ...(first.transactions[0] as Feed["accounts"][number]["transactions"][number]),
        transactionId: `m${i}`,
        postingDateTime: `2026-${String(m).padStart(2, "0")}-15T00:00:00Z`,
      }));
      return {
        ...base,
        feed: { ...base.feed, accounts: [{ ...first, transactions }] },
      } as unknown as GeneratedApplicant;
    };
    // Opening debit on the window's first day, then monthly.
    const steady = monthly([5, 6, 7, 8, 9, 10]);
    expect(eq03(assessEvidence(input(steady)).checks).result).toBe("pass");
    const gapped = eq03(assessEvidence(input(monthly([5, 6, 10]))).checks);
    expect(gapped.result).not.toBe("pass");
    expect(gapped.detail).toMatch(/No transactions from 2026-06-16 to 2026-10-14/);
  });

  it("a change from fortnightly to monthly pay in a pay-only feed is not a gap", () => {
    const feed = base.feed as unknown as Feed;
    const [first] = feed.accounts;
    if (!first) throw new Error("no account");
    const template = first.transactions[0] as Feed["accounts"][number]["transactions"][number];
    const days = [
      "2026-05-01",
      "2026-05-14",
      "2026-05-28",
      "2026-06-11",
      "2026-06-25",
      "2026-07-09",
      "2026-07-23",
      "2026-08-06",
      "2026-08-29",
      "2026-09-29",
      "2026-10-29",
    ];
    const transactions = days.map((d, i) => ({
      ...template,
      transactionId: `p${i}`,
      postingDateTime: `${d}T00:00:00Z`,
    }));
    const a = {
      ...base,
      feed: { ...base.feed, accounts: [{ ...first, transactions }] },
    } as unknown as GeneratedApplicant;
    const c = eq03(assessEvidence(input(a)).checks);
    expect(c.result).toBe("pass");
    expect(c.detail).not.toMatch(/No transactions from/);
  });
});

describe("SIG-55 T4: set v1 is unchanged", () => {
  const set = population(42).map((spec) => generateApplicant(spec, 42));
  const ctx = (a: GeneratedApplicant, version?: 1 | 2) =>
    assessEvidence({
      feed: a.feed as unknown as Feed,
      feed_type: a.truth.feed_type,
      as_of: AS_OF_DATE,
      lookback_months: 6,
      ...(version ? { eq_version: version } : {}),
    });

  it("every EQ-03 result at the 6-month request is the same as under the earlier method", () => {
    const changed = set.filter((a) => eq03(ctx(a).checks).result !== eq03(ctx(a, 1).checks).result);
    expect(changed.map((a) => a.truth.applicant_id)).toEqual([]);
  }, 60_000);

  it("138 of 380 are still unverified (the SIG-39 result of record)", () => {
    const unverified = set.filter((a) => {
      const c = ctx(a).checks;
      return c.some((x) => (x.id === "EQ-01" || x.id === "EQ-03") && x.result === "fail");
    });
    expect(unverified).toHaveLength(138);
  }, 60_000);
});

describe("SIG-55 T5 and EQ-R6: deterministic and versioned", () => {
  it("T5: identical inputs give a byte-identical context", () => {
    const i = input(hole(base, "2026-07-01", "2026-07-31"));
    const h = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
    expect(h(assessEvidence(i))).toBe(h(assessEvidence(i)));
  });

  // Updated by the SIG-55 ruling (8 November 2026): the current method is 3 (the 60-day ceiling,
  // test/engines/evidence/gap-ceiling.test.ts); version 1 still replays.
  it("the method is version 3 and recorded; version 1 replays the earlier first-transaction rule", () => {
    expect(EQ_METHOD_VERSION).toBe(3);
    const gapped = input(hole(base, "2026-07-01", "2026-07-31"));
    const now = assessEvidence(gapped);
    expect(now.eq_version).toBe(3);
    const then = assessEvidence({ ...gapped, eq_version: 1 });
    expect(then.eq_version).toBe(1);
    expect(eq03(then.checks).result).toBe("pass");
    expect(eq03(then.checks).detail).not.toMatch(/No transactions from/);
  });
});
