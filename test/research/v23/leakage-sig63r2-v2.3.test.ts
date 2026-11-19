// SIG-63 T7 under re-registration r2, set v2.3, run once. The committed record reproduces exactly
// (D28). Its verdict field is as run (8 labels: SIG-60's rule, the label's overall status only).
// Ruling, Colin, 20 November 2026 (on SIG-63 comment 40469): SIG-63's pass rule, "within margin
// on every family", counts a family-level flag as a failure, so the verdict is 10 labels:
// T-dishonour-fee and T-drift-pair-second fail on their family flags. The record isn't edited.
import { describe, expect, it } from "vitest";
import { checkSet, TIMEOUT } from "./leakage-sig63-helper.js";

const AS_RUN = [
  "L-unseen-lender: leak",
  "L-no-card-cue: leak",
  "L-account-in-grant: leak",
  "T-repayment: leak",
  "T-pay: leak",
  "T-card-repayment: leak",
  "T-bounced-debit: leak",
  "T-drift-pair-main: leak",
];
const RULED = [
  "L-unseen-lender: leak",
  "L-no-card-cue: leak",
  "L-account-in-grant: leak",
  "T-repayment: leak",
  "T-pay: leak",
  "T-card-repayment: leak",
  "T-dishonour-fee: family flag (accounts)",
  "T-bounced-debit: leak",
  "T-drift-pair-main: leak",
  "T-drift-pair-second: family flag (amount_magnitude, reference)",
];

describe("SIG-63 T7 r2: set v2.3 (D28: the recorded result reproduces)", () => {
  it(
    "reproduces its record; the record's verdict is as run, the ruled verdict fails 10 labels",
    async () => {
      const { verdict, recorded } = await checkSet("v2.3", "r2");
      expect(recorded.verdict).toBe(`FAILS: ${AS_RUN.join("; ")}`);
      expect(verdict.pass).toBe(false);
      expect(verdict.failing).toEqual(RULED);
    },
    TIMEOUT,
  );
});
