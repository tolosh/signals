// E-12, ruled (Colin, 8 November 2026, on SIG-42): "findings show; absence needs history" (EQ
// method 4) applies only to signals that detect presence. Every signal's registry definition says
// whether it detects presence or judges a pattern, and the layer reads that declaration.
import { describe, expect, it } from "vitest";
import { applyEvidence, assessEvidence, DEFINITIONS } from "../../../src/engines/evidence/index.js";
import type { RawSignal, SignalDefinition } from "../../../src/engines/evidence/index.js";
import { FULL, INC_09, LIA_01_NONE, applicant, input } from "../evidence/helpers.js";

describe("every signal declares what it detects", () => {
  it("each definition is presence or pattern", () => {
    for (const d of Object.values(DEFINITIONS))
      expect(["presence", "pattern"], d.id).toContain(d.detects);
  });
  it("presence: all of LIA and INC-05, as ruled; everything else judges a pattern", () => {
    const presence = Object.values(DEFINITIONS)
      .filter((d) => d.detects === "presence")
      .map((d) => d.id)
      .sort();
    expect(presence).toEqual(
      ["INC-05", "LIA-01", "LIA-02", "LIA-03", "LIA-04", "LIA-05", "LIA-06"].sort(),
    );
  });
});

describe("the layer reads the declaration", () => {
  const three = applicant({ ...FULL, history_months: 3 }, "e12-three");
  const six = applicant(FULL, "e12-six");
  const amber = (r: RawSignal): RawSignal => ({
    ...r,
    state: "amber",
    nothing_found: false,
    value: "found",
    reason: "Found",
  });
  const flip = (id: string, detects: "presence" | "pattern") =>
    ({
      ...DEFINITIONS,
      [id]: { ...DEFINITIONS[id], detects } as SignalDefinition,
    }) as Readonly<Record<string, SignalDefinition>>;

  it("a pattern signal declared as presence would show amber below its minimum", () => {
    const [s] = applyEvidence(
      [amber(INC_09)],
      assessEvidence(input(six)),
      flip("INC-09", "presence"),
    );
    expect(s?.state).toBe("amber");
  });
  it("a presence signal declared as pattern would stay capped", () => {
    const [s] = applyEvidence(
      [amber(LIA_01_NONE)],
      assessEvidence(input(three, 3)),
      flip("LIA-01", "pattern"),
    );
    expect(s?.state).toBe("unverified");
  });
});
