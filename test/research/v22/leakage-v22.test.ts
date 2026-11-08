// SIG-60 T7: set v2.2 is within every pre-registered margin, with every label present, and passes
// every validity check.
import { describe, expect, it } from "vitest";
import { checkSet, TIMEOUT } from "./leakage-helper.js";

describe("T7: set v2.2", () => {
  it(
    "reproduces its record; every label is present and within margin; every check passes",
    () => {
      const { result, verdict } = checkSet("v2.2");
      expect(result.labels.filter((l) => l.status === "absent").map((l) => l.id)).toEqual([]);
      expect(result.labels.filter((l) => l.status === "leak").map((l) => l.id)).toEqual([]);
      expect(result.validity.filter((v) => !v.pass).map((v) => v.id)).toEqual([]);
      expect(verdict).toEqual({ pass: true, failing: [] });
    },
    TIMEOUT,
  );
});
