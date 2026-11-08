// SIG-60 T7, negative control: set v2.1 (withdrawn) is caught on every channel its review found.
import { describe, expect, it } from "vitest";
import { checkSet, TIMEOUT } from "./leakage-helper.js";

describe("T7 negative control: set v2.1", () => {
  it(
    "reproduces its record and is caught on every channel of the set v2.1 review",
    () => {
      const { result, verdict } = checkSet("v2.1");
      expect(result.channels.length).toBe(17);
      expect(result.channels.filter((c) => !c.caught)).toEqual([]);
      expect(verdict.pass).toBe(true);
    },
    TIMEOUT,
  );
});
