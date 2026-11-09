// SIG-60 T7: set v2.2 under the frozen pre-registration.
//
// Ruling, 9 November 2026 (Colin, SIG-60 comment 40197): T7's verdict stands as run, failing on
// 4 of 27 labels, and the pre-registration is not amended. Under D28, CI asserts that the
// recorded result reproduces exactly, not that it passes. Until that ruling this test asserted a
// pass and failed; it now pins the recorded verdict instead. A change in either direction (a label
// that stops leaking, a new leak, a validity check that starts failing) fails here and needs a new
// record and a new ruling.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkSet, RECORD, TIMEOUT } from "./leakage-helper.js";

/** The four labels over the margin, as recorded and ruled. */
const RULED_LEAKS = ["T-repayment", "T-pay", "T-card-repayment", "T-drift-line-main"];

describe("T7: set v2.2 (D28: the recorded result reproduces)", () => {
  it(
    "reproduces its record exactly, and the verdict is the recorded one: fails on the four ruled labels",
    () => {
      const { result, verdict } = checkSet("v2.2");
      const recorded = JSON.parse(readFileSync(RECORD("v2.2"), "utf8")) as { verdict: string };
      expect(verdict.pass).toBe(false);
      expect(`FAILS: ${verdict.failing.join("; ")}`).toBe(recorded.verdict);
      expect(verdict.failing).toEqual(RULED_LEAKS.map((id) => `${id}: leak`));
      // Every label is present, and no validity check fails: the four are leaks, nothing else.
      expect(result.labels.length).toBe(27);
      expect(result.labels.filter((l) => l.status === "absent")).toEqual([]);
      expect(result.validity.filter((v) => !v.pass).map((v) => v.id)).toEqual([]);
    },
    TIMEOUT,
  );
});
