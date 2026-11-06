// SIG-39 section 6 tests T4, T5, T6 and T8: the per-signal block, absence (EQ-R2), minimum
// evidence (EQ-R4), statement feeds (EQ-R5) and determinism (EQ-R6).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  applyEvidence,
  assessEvidence,
  DEFINITIONS,
  DEFINITIONS_VERSION,
  definition,
} from "../../../src/engines/evidence/index.js";
import {
  FULL,
  INC_01,
  INC_09,
  LIA_01_NONE,
  LIA_03_UNRECOGNISED,
  STUBS,
  applicant,
  input,
} from "./helpers.js";

describe("T4 full coverage and no liabilities", () => {
  const ctx = assessEvidence(input(applicant(FULL, "sig39-t4")));
  const [lia01] = applyEvidence([LIA_01_NONE], ctx);

  it("LIA-01 returns none_observed with its completeness, never none", () => {
    expect(lia01?.state).toBe("none_observed");
    expect(lia01?.state).not.toBe("green");
    expect(lia01?.evidence_quality.completeness).toEqual({
      primary_income_account_shared: true,
      unshared_own_account_transfers: 0,
      institutions_without_shared_account: 0,
      history_months_available: expect.any(Number) as number,
      history_months_required: 6,
    });
    expect(lia01?.evidence_quality.completeness.history_months_available).toBeGreaterThan(5.9);
    expect(JSON.stringify(lia01)).not.toMatch(/"none"/);
  });

  it("carries the definition's family, code, name and roll-up class", () => {
    expect(lia01).toMatchObject({
      id: "LIA-01",
      family: 3,
      family_code: "LIA",
      name: "Undisclosed liabilities",
      rollup_class: "knockout",
    });
  });
});

describe("T5 a 12-month signal on a 6-month history", () => {
  const ctx = assessEvidence(input(applicant(FULL, "sig39-t5")));
  const [inc09, inc01] = applyEvidence([INC_09, INC_01], ctx);

  it("is unverified, with resolve[] asking for 12 months", () => {
    expect(inc09?.state).toBe("unverified");
    expect(inc09?.evidence_quality.completeness.history_months_required).toBe(12);
    expect(inc09?.evidence_quality.resolve_with).toEqual([
      "Share 12 months of transaction history",
    ]);
  });

  it("a 6-month signal on the same history is not capped", () => {
    expect(inc01?.state).toBe("green");
  });

  it("the same 12-month signal runs on a 12-month history requested and returned", () => {
    const long = assessEvidence(input(applicant({ ...FULL, history_months: 12 }, "sig39-t5"), 12));
    expect(applyEvidence([INC_09], long)[0]?.state).toBe("green");
  });
});

describe("T6 a statement feed with an unrecognised adverse line", () => {
  const ctx = assessEvidence(input(applicant({ ...FULL, feed: "uploaded_statement" }, "sig39-t6")));
  const [lia03, lia01] = applyEvidence([LIA_03_UNRECOGNISED, LIA_01_NONE], ctx);

  it("the affected signal is unverified, not green or none_observed", () => {
    expect(lia03?.state).toBe("unverified");
    expect(lia03?.evidence_quality.reliability.feed_type).toBe("uploaded_statement");
    expect(lia03?.evidence_quality.resolve_with[0]).toMatch(/2 debits/);
  });

  it("a signal with no unrecognised lines is not capped, but its reliability shows the feed", () => {
    expect(lia01?.state).toBe("none_observed");
    expect(lia01?.evidence_quality.reliability.field_population_pct).toBe(0);
  });

  it("the same unrecognised lines on a CDR feed do not cap (EQ-R5 is for statements)", () => {
    const cdr = assessEvidence(input(applicant(FULL, "sig39-t6")));
    const [s] = applyEvidence([LIA_03_UNRECOGNISED], cdr);
    expect(s?.state).toBe("none_observed");
    expect(s?.evidence_quality.reliability.field_population_pct).toBeGreaterThan(50);
  });
});

describe("T8 identical inputs twice give byte-identical EQ output", () => {
  const run = () => {
    const ctx = assessEvidence(
      input(applicant({ ...FULL, coverage: { unshared_transfer_accounts: 2 } }, "sig39-t8")),
    );
    return JSON.stringify({ ctx, signals: applyEvidence(STUBS, ctx) });
  };
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");

  it("has an identical hash", () => {
    expect(sha(run())).toBe(sha(run()));
  });
});

describe("the signal definition registry (EQ-R4, EQ-R6)", () => {
  it("is versioned, and every definition declares history, feeds, absence and class", () => {
    expect(DEFINITIONS_VERSION).toBe(1);
    for (const d of Object.values(DEFINITIONS)) {
      expect(d.min_history_months).toBeGreaterThan(0);
      expect(d.feeds.length).toBeGreaterThan(0);
      expect(typeof d.depends_on_absence).toBe("boolean");
      expect(d.id.startsWith(d.family_code)).toBe(true);
    }
  });

  it("resolves retired IDs as aliases and never reuses them", () => {
    expect(definition("COV-01")?.id).toBe("EQ-01");
    expect(definition("COV-02")?.id).toBe("EQ-02");
    expect(definition("COV-03")?.id).toBe("EQ-03");
    expect(definition("LIQ-04")?.id).toBe("TRJ-01");
    expect(Object.keys(DEFINITIONS)).not.toContain("LIQ-04");
    expect(Object.keys(DEFINITIONS).some((k) => k.startsWith("COV"))).toBe(false);
  });

  it("an unknown signal ID is refused, not given a default", () => {
    expect(() =>
      applyEvidence([{ ...INC_01, id: "XYZ-01" }], assessEvidence(input(applicant(FULL, "x")))),
    ).toThrow(/XYZ-01/);
  });
});
