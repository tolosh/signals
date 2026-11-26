// SIG-74 T5: mutations. Removing the default-ignorable stripping (back to Cf only, as keyword list
// 1.0.0 did), or the joined-form derivation of lender names (back to LIA 1.3.5's provider words),
// each makes T1 fail. Each mutant is the shipped code with one part switched off through its own
// factory option, swapped in for the module the engines import. Written before the change.
import { afterEach, describe, expect, it, vi } from "vitest";

const MASK = "../../../src/engines/display-mask.js";
const LENDERS = "../../../src/engines/families/lia/lenders.js";
type MaskModule = Record<string, unknown> & {
  makeMasker?: (o: {
    nfkc: boolean;
    stripFormat: boolean;
    exemptions: boolean;
    ignorable?: boolean;
  }) => { mask: (t: string) => string; clean: (t: string) => string };
};
type LendersModule = Record<string, unknown> & {
  makeLenderDisplay?: (o: { joined: boolean }) => Record<string, unknown>;
};
const load = async <T>(path: string): Promise<T> => (await import(/* @vite-ignore */ path)) as T;

/** T1 on two keywords, split by the two kinds of character, against their plain controls. */
async function t1Leaks(): Promise<string[]> {
  const { applicantFor, leaksOf } = await import("./corpus.js");
  return [
    ["IVF", "\u200b"],
    ["IVF", "\u034f"],
    ["CARDIOLOG", "\u200b"],
    ["PARISH", "\u00ad"],
  ].flatMap(([k = "", c = ""]) => leaksOf(k, applicantFor(k, c), applicantFor(k, null)));
}

/**
 * T5 as run (comment 40710): as built, T1's probes leave the recorded CAR result (SIG-75), which
 * also satisfied the mutant checks as first written ("not empty"). Deviation D3 (D28, Colin,
 * 26 November 2026): the as-built check asserts the recorded result, and each mutant must change
 * it, which is what "makes T1 fail" means once T1's as-run result isn't empty.
 */
const AS_BUILT = ["fragment CAR"];

describe("T5: mutations", () => {
  afterEach(() => {
    vi.doUnmock(MASK);
    vi.doUnmock(LENDERS);
    vi.resetModules();
  });

  it("as built, T1's probes leave only the recorded CAR result (as run, D3)", async () => {
    expect(await t1Leaks()).toEqual(AS_BUILT);
  });
  it("without the default-ignorable stripping (Cf only), T1 fails", async () => {
    const actual = await load<MaskModule>(MASK);
    expect(typeof actual.makeMasker).toBe("function");
    const m = actual.makeMasker?.({
      nfkc: true,
      stripFormat: true,
      exemptions: true,
      ignorable: false,
    });
    expect(typeof m?.clean).toBe("function");
    vi.resetModules();
    vi.doMock(MASK, () => ({ ...actual, maskText: m?.mask, cleanText: m?.clean }));
    expect(await t1Leaks()).not.toEqual(AS_BUILT);
  });
  it("without the joined-form lender names (1.3.5's provider words), T1 fails", async () => {
    const actual = await load<LendersModule>(LENDERS);
    expect(typeof actual.makeLenderDisplay).toBe("function");
    const d = actual.makeLenderDisplay?.({ joined: false }) ?? {};
    vi.resetModules();
    vi.doMock(LENDERS, () => ({ ...actual, ...d }));
    expect(await t1Leaks()).not.toEqual(AS_BUILT);
  });
});
