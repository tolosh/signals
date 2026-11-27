// SIG-82 (mandate 40777; ruling 40775, 2): Rollup.state is optional in contract 1.9.0. It is set
// only when the evidence layer is unverified (RU-4); otherwise the object carries the reasons
// that move it (RU-1) and no state. top_reasons and reasons_to_say_yes stay required arrays, so
// the lender app can always render the object (Lovable audit, SIG-82 40782).
import { describe, expect, it } from "vitest";
import { loadContract, schemaValidator } from "../contract/helpers.js";

const doc = loadContract();
const rollup = schemaValidator(doc)("Rollup");

describe("contract 1.9.0: the roll-up's optional state", () => {
  it("is version 1.9.0 or later", () => {
    const [major, minor] = doc.info.version.split(".").map(Number);
    expect((major ?? 0) * 100 + (minor ?? 0)).toBeGreaterThanOrEqual(109);
  });

  it("accepts a roll-up with no state and the signals that move it", () => {
    const r = rollup({
      top_reasons: [{ signal_id: "INC-01", state: "amber", reason: "Pay varies" }],
      reasons_to_say_yes: [],
    });
    expect(r.errors).toBeNull();
    expect(r.valid).toBe(true);
  });

  it("accepts the unverified state with evidence-layer reasons", () => {
    const r = rollup({
      state: "unverified",
      top_reasons: [{ signal_id: null, state: "unverified", reason: "No income account shared" }],
      reasons_to_say_yes: [],
    });
    expect(r.valid).toBe(true);
  });

  it("still requires both reason arrays, and at most 3 top reasons", () => {
    expect(rollup({ reasons_to_say_yes: [] }).valid).toBe(false);
    expect(rollup({ top_reasons: [] }).valid).toBe(false);
    const four = Array.from({ length: 4 }, (_, i) => ({ signal_id: `X-0${i}`, reason: "r" }));
    expect(rollup({ top_reasons: four, reasons_to_say_yes: [] }).valid).toBe(false);
  });

  it("rejects a state outside RollupState", () => {
    expect(rollup({ state: "excellent", top_reasons: [], reasons_to_say_yes: [] }).valid).toBe(
      false,
    );
  });
});
