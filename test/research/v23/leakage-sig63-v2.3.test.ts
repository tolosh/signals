// SIG-63 T7 under r1 (SIG-63.json as first registered), set v2.3: never run. The v2.2 control
// failed under r1 (D-L4-1c, D-L4-1d not caught), so by the pass rule no later result stands and
// set v2.3 was not run under r1 (SIG-63 comment 40468). This pins that: no r1 record for v2.3
// exists, and the r1 v2.2 record is a failure. T7 on v2.3 ran once, under r2
// (leakage-sig63r2-v2.3.test.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recordPath } from "./leakage-sig63-helper.js";

describe("SIG-63 T7 r1: set v2.3 was not run (the v2.2 control failed)", () => {
  it("no r1 record for v2.3; the r1 v2.2 record fails on D-L4-1c and D-L4-1d", () => {
    expect(recordPath("v2.3", "r1")).toBeNull();
    const v22 = recordPath("v2.2", "r1");
    expect(v22).not.toBeNull();
    const rec = JSON.parse(readFileSync(v22 ?? "", "utf8")) as { verdict: string };
    expect(rec.verdict).toBe("FAILS: D-L4-1c: not caught; D-L4-1d: not caught");
  });
});
