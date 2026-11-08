// SIG-41 ruling 4 (ADR 0004, N-13; ADR 0002, E-11): a signal whose evaluator lacks an input it
// needs (an occupation, a stated salary, a regular income stream) is capped by the
// evidence-quality layer under EQ-R4, not by the family. The evaluator says what is missing in
// `missing_input`; the layer makes the signal unverified with that reason and resolve_with.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyEvidence,
  assessEvidence,
  type RawSignal,
} from "../../../src/engines/evidence/index.js";
import { FULL, INC_01, LIA_01_NONE, applicant, input } from "./helpers.js";

const gap = {
  reason: "Not verified: the application has no occupation",
  resolve_with: ["Add the applicant's occupation to the application"],
};
const withGap = (r: RawSignal, extra: Partial<RawSignal> = {}): RawSignal => ({
  ...r,
  ...extra,
  missing_input: gap,
});
const full = assessEvidence(input(applicant(FULL, "n13-full")));
const noSalary = assessEvidence(
  input(applicant({ ...FULL, coverage: { salary_account_shared: false } }, "n13-eq01")),
);

describe("EQ-R4: a missing input makes the signal unverified, in the layer", () => {
  it("with nothing else wrong: unverified, the input's reason first, its resolve_with first", () => {
    const [s] = applyEvidence([withGap(INC_01, { resolve_with: ["Already asked"] })], full);
    expect(s).toMatchObject({
      state: "unverified",
      value: null,
      reason: gap.reason,
      confidence: "low",
    });
    expect(s?.evidence_quality.resolve_with).toEqual([...gap.resolve_with, "Already asked"]);
    expect(s?.evidence_quality.review_required).toBe(false);
  });

  it("an absence signal with a missing input is unverified, not none_observed", () => {
    const [s] = applyEvidence([withGap(LIA_01_NONE)], full);
    expect(s?.state).toBe("unverified");
  });

  it("an evidence check that caps the signal comes first; the missing input adds nothing (E-11)", () => {
    const [plain] = applyEvidence([INC_01], noSalary);
    const [s] = applyEvidence([withGap(INC_01)], noSalary);
    expect(plain?.state).toBe("unverified");
    expect(s).toEqual(plain);
  });

  it("without a missing input, the output is unchanged", () => {
    const [a] = applyEvidence([INC_01], full);
    const [b] = applyEvidence([{ ...INC_01 }], full);
    expect(b).toEqual(a);
    expect(a?.state).toBe("green");
  });
});

describe("the INC family no longer caps signals itself", () => {
  it("its source sets no unverified state", () => {
    const src = readFileSync("src/engines/families/inc/index.ts", "utf8");
    expect(src).not.toMatch(/state: "unverified"/);
    expect(src).toMatch(/missing_input/);
  });
});
