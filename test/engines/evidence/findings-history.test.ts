// SIG-42 review ruling 3 (8 November 2026), EQ method 4: findings show; absence needs history.
// Under EQ-R4 a signal below its minimum history is unverified. From method 4, a signal that found
// something adverse (amber or red) shows on any history the evidence checks allow; only absence
// (none_observed), green and evidenced still need the signal's full minimum (EQ-R2: absence is
// never proof; presence is). EQ-01, EQ-02 and EQ-03 caps still apply as ruled. Method 3 replays.
import { describe, expect, it } from "vitest";
import {
  applyEvidence,
  assessEvidence,
  EQ_METHOD_VERSION,
} from "../../../src/engines/evidence/index.js";
import type { RawSignal } from "../../../src/engines/evidence/index.js";
import { FULL, INC_09, LIA_01_NONE, POS_01, applicant, input } from "./helpers.js";

const six = applicant(FULL, "sig42-r3-six");
const three = applicant({ ...FULL, history_months: 3 }, "sig42-r3-three");
const unshared = applicant(
  { ...FULL, coverage: { salary_account_shared: true, unshared_transfer_accounts: 1 } },
  "sig42-r3-unshared",
);
const as = (r: RawSignal, state: RawSignal["state"]): RawSignal => ({
  ...r,
  state,
  nothing_found: false,
  value: "found",
  reason: "Found something adverse",
});
const LIA_01_FOUND = (state: "amber" | "red"): RawSignal => ({
  ...as(LIA_01_NONE, state),
  evidence: { account_ids: ["x-evd"], transaction_count: 4 },
});
const stateOf = (r: RawSignal, ctx: ReturnType<typeof assessEvidence>) =>
  applyEvidence([r], ctx)[0]?.state;

describe("EQ method 4: findings show, absence needs history", () => {
  it("is the current EQ method version", () => {
    expect(EQ_METHOD_VERSION).toBe(4);
    expect(assessEvidence(input(six)).eq_version).toBe(4);
  });

  it("a 12-month signal that found something amber or red shows it on a 6-month history", () => {
    const ctx = assessEvidence(input(six));
    expect(stateOf(as(INC_09, "amber"), ctx)).toBe("amber");
    expect(stateOf(as(INC_09, "red"), ctx)).toBe("red");
  });
  it("its block still says how much history the signal needs", () => {
    const [s] = applyEvidence([as(INC_09, "amber")], assessEvidence(input(six)));
    expect(s?.evidence_quality.completeness.history_months_required).toBe(12);
    expect(s?.confidence).toBe("high");
  });
  it("green on too short a history stays unverified", () => {
    expect(stateOf(INC_09, assessEvidence(input(six)))).toBe("unverified");
  });
  it("evidenced (a POS finding) on too short a history stays unverified", () => {
    expect(stateOf(POS_01, assessEvidence(input(three, 3)))).toBe("unverified");
  });

  it("a 3-month history at a 3-month request: an undisclosed card shows amber", () => {
    expect(stateOf(LIA_01_FOUND("amber"), assessEvidence(input(three, 3)))).toBe("amber");
  });
  it("a 3-month history at a 3-month request with nothing found stays unverified", () => {
    expect(stateOf(LIA_01_NONE, assessEvidence(input(three, 3)))).toBe("unverified");
  });

  it("EQ-03 still caps: the same card on a 3-month history at a 6-month request", () => {
    expect(stateOf(LIA_01_FOUND("amber"), assessEvidence(input(three, 6)))).toBe("unverified");
  });
  it("EQ-02 still caps a signal that depends on absence, even when it found something", () => {
    const ctx = assessEvidence(input(unshared));
    expect(ctx.checks.find((c) => c.id === "EQ-02")?.result).toBe("fail");
    expect(stateOf(LIA_01_FOUND("red"), ctx)).toBe("unverified");
  });

  it("method 3 replays: the amber 12-month signal on 6 months is unverified", () => {
    const ctx = assessEvidence({ ...input(six), eq_version: 3 });
    expect(stateOf(as(INC_09, "amber"), ctx)).toBe("unverified");
  });
});
