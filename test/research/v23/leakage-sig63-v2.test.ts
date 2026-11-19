// SIG-63 T7 on set v2: the committed record reproduces exactly (D28), and its verdict is the
// recorded one.
import { describe, expect, it } from "vitest";
import { checkSet, TIMEOUT } from "./leakage-sig63-helper.js";

describe("SIG-63 T7: set v2 (D28: the recorded result reproduces)", () => {
  it(
    "reproduces its record, with the recorded verdict",
    async () => {
      const { verdict, recorded } = await checkSet("v2");
      const v = verdict.pass ? "PASS" : `FAILS: ${verdict.failing.join("; ")}`;
      expect(String(recorded.verdict).startsWith(v)).toBe(true);
    },
    TIMEOUT,
  );
});
