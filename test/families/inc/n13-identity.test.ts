// SIG-41 ruling 4 (ADR 0004): N-13 moves from the INC family into the evidence-quality layer
// (EQ-R4), and INC's output must be byte-identical before and after. The hashes were taken at
// main d2e59a0 (INC 1.2.1, N-13 still in the family), before any change on this branch.
import { describe, expect, it } from "vitest";
import { asmIncomeHash, setV1Hash } from "./output-hash.js";

describe("N-13 in the layer: INC's output is byte-identical to d2e59a0", () => {
  it("over set v1, lookback max(3, history months)", () => {
    expect(setV1Hash("history")).toBe(
      "4742985ef585437c6c773bf05d29595e7e04ad858b9a61beaf9fdc8363ee1a20",
    );
  });
  it("over set v1, a 6-month request", () => {
    expect(setV1Hash(6)).toBe("cfef52b5297bbd8303afd6063e9104cf201eed41e769b12375e7e187e63a4f6c");
  });
  it("over the mock's asm_income", () => {
    expect(asmIncomeHash()).toBe(
      "196d4b0402361264b2e7a2821d757dcae3290c3d1dde9f4864d47f275c2efeba",
    );
  });
});
