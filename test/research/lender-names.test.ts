// SIG-42 ruling 2 (10 November 2026, 06:39): LIA's list of known multi-word lender names must not
// break the synthetic sets' unseen-lender check. The unseen-lender groups test lenders the engines
// have never named (catalog.ts: SIG-57 must not add them either), so no reserved name may be on
// the list, and no listed name may change how a reserved name is shown: each reserved name falls
// back to the first-word rule. This test lives under test/research/, where the reserved names may
// be written; the set v2.1 leakage test keeps them out of src/ and the other tests.
import { describe, expect, it } from "vitest";
import { LENDER_NAMES, lenderOf } from "../../src/engines/families/lia/lenders.js";
import { UNSEEN_PROVIDERS, UNSEEN_PROVIDERS_V21 } from "../../src/research/generator/catalog.js";
import { UNSEEN_PROVIDERS_V22 } from "../../src/research/generator/v22/catalog.js";

const reserved = [
  ...new Set(
    [UNSEEN_PROVIDERS, UNSEEN_PROVIDERS_V21, UNSEEN_PROVIDERS_V22].flatMap((m) =>
      Object.values(m).flat(),
    ),
  ),
];

describe("the lender list leaves every reserved unseen-lender name alone", () => {
  it("covers the three sets' reserved names", () => {
    expect(reserved.length).toBeGreaterThan(30);
  });
  it("no reserved name is on the list", () => {
    expect(LENDER_NAMES.filter((n) => reserved.includes(n))).toEqual([]);
  });
  it.each(reserved)("%s is still shown by its first word", (name) => {
    expect(lenderOf(`${name} LOAN REF`)).toBe(name.split(" ")[0]);
  });
});
