// SIG-41 closing check (Colin, 8 November 2026): the independent re-review's 363 mismatch
// histories (research/reviews/sig41-2026-11-08/, copied to test/fixtures/) are re-run at the
// current INC engine. Every remaining difference from the plain 60% rule must be explained by the
// evidence layer (EQ-01), a missing regular income stream (fix 1: unverified), D25 rounding or the
// N-1 regular-income basis; none may be "no stream → green", and none a cross-reference error.
// The counts are asserted exactly (D28 form: the result reproduces), and printed.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classify, type Entry, type Verdict } from "./review-harness.js";

const entries = JSON.parse(
  readFileSync("test/fixtures/sig41-random-mismatches.json", "utf8"),
) as Entry[];
let verdicts: Verdict[] = [];
const count = (f: (v: Verdict) => string) =>
  verdicts.reduce<Record<string, number>>((m, v) => ((m[f(v)] = (m[f(v)] ?? 0) + 1), m), {});

describe("the re-review's 363 mismatch histories at INC 1.2.1", () => {
  it("re-runs every history", () => {
    expect(entries).toHaveLength(363);
    verdicts = entries.map(classify);
    console.log(
      "SIG-41 regression, by cause:",
      JSON.stringify(
        count((v) => v.now),
        null,
        1,
      ),
    );
  }, 300_000);

  it("explains every remaining difference by EQ-01, a missing stream, D25 or N-1", () => {
    expect(verdicts.filter((v) => v.now === "unexplained").map((v) => v.id)).toEqual([]);
    expect(
      verdicts.filter((v) => v.now === "unverified: evidence layer (other)").map((v) => v.id),
    ).toEqual([]);
  });

  it("has zero 'no stream → green'", () => {
    expect(verdicts.filter((v) => v.no_stream_green).map((v) => v.id)).toEqual([]);
  });

  it("has zero cross-reference errors", () => {
    expect(
      verdicts.filter((v) => v.xref_errors.length > 0).map((v) => [v.id, v.xref_errors]),
    ).toEqual([]);
  });

  it("A-405, the reviewer's 'no stream → green' case, is now unverified", () => {
    const a405 = verdicts.find((v) => v.id === "A-405");
    expect(a405?.engine).toBe("unverified");
    expect(a405?.now).toBe("unverified: no regular income stream (fix 1)");
  });

  it("only family C fails to rebuild exactly (its near-60% factor was stored to 2 dp)", () => {
    const off = verdicts.filter((v) => !v.rebuilt_reference_matches);
    expect(off.every((v) => v.id.startsWith("C-"))).toBe(true);
  });
});
