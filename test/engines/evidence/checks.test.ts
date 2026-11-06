// SIG-39 section 6 tests T1, T2, T3 and T9: the assessment-level checks EQ-01 to EQ-03 and the
// capping they drive (Product Specification Amendment 2, §2 EQ-R3 and §3 RU-4, RU-5).
import { describe, expect, it } from "vitest";
import { AS_OF_DATE } from "../../../src/research/generator/index.js";
import {
  applyEvidence,
  assessEvidence,
  evidenceRollup,
  type EvidenceCheck,
} from "../../../src/engines/evidence/index.js";
import { FULL, INC_01, LIA_01_NONE, POS_01, STUBS, applicant, input, truncate } from "./helpers.js";

const check = (checks: EvidenceCheck[], id: string) => {
  const found = checks.find((c) => c.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
};

describe("T1 the salary account is not shared", () => {
  const a = applicant({ ...FULL, coverage: { salary_account_shared: false } }, "sig39-t1");
  const ctx = assessEvidence(input(a));
  const signals = applyEvidence([INC_01, LIA_01_NONE, POS_01], ctx);

  it("EQ-01 fails", () => {
    expect(check(ctx.checks, "EQ-01").result).toBe("fail");
    expect(ctx.primary_income_account_shared).toBe(false);
  });

  it("every signal is capped at unverified", () => {
    expect(signals.map((s) => s.state)).toEqual(["unverified", "unverified", "unverified"]);
    for (const s of signals) {
      expect(s.evidence_quality.completeness.primary_income_account_shared).toBe(false);
      expect(s.evidence_quality.resolve_with.join(" ")).toMatch(/salary or benefit is paid into/);
    }
  });

  it("the roll-up is unverified (RU-4)", () => {
    expect(evidenceRollup(ctx).state).toBe("unverified");
  });
});

describe("T2 55% of the lookback window returned", () => {
  // A 6-month window ending 31 October starts on 1 May: 184 days. Keep the last 101 (55%).
  const a = truncate(applicant(FULL, "sig39-t2"), "2026-07-23");
  const ctx = assessEvidence(input(a));

  it("EQ-03 fails and the roll-up is unverified (RU-4)", () => {
    const eq03 = check(ctx.checks, "EQ-03");
    expect(eq03.result).toBe("fail");
    // Coverage is measured from the first transaction returned, which can land a day after the cut.
    expect(eq03.detail).toMatch(/returned 5[45]% of the 6-month/);
    expect(evidenceRollup(ctx).state).toBe("unverified");
    expect(applyEvidence(STUBS, ctx).every((s) => s.state === "unverified")).toBe(true);
  });

  it("boundaries: 60% to 90% is partial, 90% or more is pass", () => {
    const partial = assessEvidence(input(truncate(applicant(FULL, "sig39-t2"), "2026-06-20")));
    expect(check(partial.checks, "EQ-03").result).toBe("partial");
    expect(evidenceRollup(partial).state).toBeNull();
    expect(evidenceRollup(partial).green_allowed).toBe(false);
    const full = assessEvidence(input(applicant(FULL, "sig39-t2")));
    expect(check(full.checks, "EQ-03").result).toBe("pass");
  });
});

describe("T3 regular transfers to an unshared own account", () => {
  // Low pay makes the monthly transfers material against income under interpretation E-2.
  const a = applicant(
    {
      ...FULL,
      income: { cadence: "monthly", net_per_pay: 3600, gross_annual: 52000 },
      coverage: { salary_account_shared: true, unshared_transfer_accounts: 1 },
    },
    "sig39-t3",
  );
  const ctx = assessEvidence(input(a));
  const eq02 = check(ctx.checks, "EQ-02");
  const [lia01] = applyEvidence([LIA_01_NONE], ctx);
  const number = /TRANSFER TO 062-000 (\d+)/.exec(
    JSON.stringify(a.feed).match(/TRANSFER TO 062-000 \d+/)?.[0] ?? "",
  )?.[1];

  it("EQ-02 fails, with resolve[] naming the account by its last four digits", () => {
    expect(eq02.result).toBe("fail");
    expect(eq02.review_required).toBe(true);
    expect(number).toBeDefined();
    expect(eq02.resolve_with).toEqual([
      `Connect the account receiving transfers ending ${number?.slice(-4)}`,
    ]);
    expect(JSON.stringify(ctx)).not.toContain(number);
  });

  it("LIA-01 returns unverified, not none_observed", () => {
    expect(lia01?.state).toBe("unverified");
    expect(lia01?.evidence_quality.review_required).toBe(true);
    expect(lia01?.evidence_quality.completeness.unshared_own_account_transfers).toBe(1);
    expect(lia01?.evidence_quality.resolve_with).toEqual(eq02.resolve_with);
  });

  it("signals that do not depend on absence are not capped by EQ-02", () => {
    const [inc01] = applyEvidence([INC_01], ctx);
    expect(inc01?.state).toBe("green");
    expect(evidenceRollup(ctx).state).toBeNull();
    expect(evidenceRollup(ctx).green_allowed).toBe(false);
  });

  it("transfers that are regular but not material are partial", () => {
    const rich = assessEvidence(
      input(
        applicant(
          {
            ...FULL,
            income: { cadence: "monthly", net_per_pay: 14000, gross_annual: 230000 },
            coverage: { salary_account_shared: true, unshared_transfer_accounts: 1 },
          },
          "sig39-t3-rich",
        ),
      ),
    );
    expect(check(rich.checks, "EQ-02").result).toBe("partial");
    expect(applyEvidence([LIA_01_NONE], rich)[0]?.state).toBe("none_observed");
  });

  it("an own-account transfer to a shared account is matched by BSB and account number", () => {
    const shared = a.feed.accounts[0]?.detail as { data: { bsb: string; accountNumber: string } };
    const bsb = `${shared.data.bsb.slice(0, 3)}-${shared.data.bsb.slice(3)}`;
    const feed = structuredClone(input(a).feed);
    for (const acc of feed.accounts)
      for (const t of acc.transactions)
        t.description = t.description.replace(
          /TRANSFER TO 062-000 \d+/,
          `TRANSFER TO ${bsb} ${shared.data.accountNumber}`,
        );
    const matched = assessEvidence({ ...input(a), feed });
    expect(check(matched.checks, "EQ-02").result).toBe("pass");
  });
});

describe("T9 negative control: full coverage, 6 months of CDR, income account shared", () => {
  const a = applicant(FULL, "sig39-t9");
  const ctx = assessEvidence(input(a));
  const signals = applyEvidence([INC_01, LIA_01_NONE, POS_01], ctx);

  it("all EQ checks pass", () => {
    expect(ctx.checks.map((c) => [c.id, c.result])).toEqual([
      ["EQ-01", "pass"],
      ["EQ-02", "pass"],
      ["EQ-03", "pass"],
    ]);
    expect(evidenceRollup(ctx)).toEqual({ state: null, green_allowed: true, reasons: [] });
  });

  it("nothing is capped", () => {
    expect(signals.map((s) => s.state)).toEqual(["green", "none_observed", "evidenced"]);
    expect(signals.every((s) => s.evidence_quality.resolve_with.length === 0)).toBe(true);
    expect(ctx.window).toEqual({ start: "2026-05-01", end: AS_OF_DATE });
  });

  it("the negative control holds across set v1's salaried base, not only one seed", () => {
    for (let i = 0; i < 20; i++) {
      const c = assessEvidence(input(applicant(FULL, `sig39-t9-${i}`)));
      expect(c.checks.map((x) => x.result)).toEqual(["pass", "pass", "pass"]);
    }
  });
});
