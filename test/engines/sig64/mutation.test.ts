// SIG-64 T7: mutation checks. Removing each of NFKC, the removal of format characters (Unicode
// Cf), the exemptions (LENDER_NAMES and CREDIT UNION) and income masking makes tests fail. The
// first three are switched off through the masker's options (makeMasker); income masking is
// switched off by replacing the shared masker with the identity, for INC and observed income.
// Written before the change it tests.
import { afterEach, describe, expect, it, vi } from "vitest";
import { oracle, strings } from "./probes.js";

type Options = { nfkc: boolean; stripFormat: boolean; exemptions: boolean };
type MaskModule = {
  makeMasker?: (o: Options) => { mask: (text: string) => string };
  maskText?: (text: string) => string;
};
const MODULE = "../../../src/engines/display-mask.js";
async function maskModule(): Promise<MaskModule> {
  try {
    return (await import(/* @vite-ignore */ MODULE)) as MaskModule;
  } catch {
    return {};
  }
}
const leaks = oracle();
const ALL: Options = { nfkc: true, stripFormat: true, exemptions: true };
/** The probes each mutant must fail on: T1's fullwidth and split forms, T2's exempt names. */
const PROBES = {
  nfkc: "ＩＶＦ NIMBLE",
  stripFormat: "I\u200bVF NIMBLE",
  exemptions: "HEALTH PROFESSIONALS BANK",
} as const;
const passes = (mask: (t: string) => string) => ({
  nfkc: leaks(mask(PROBES.nfkc)).length === 0,
  stripFormat: leaks(mask(PROBES.stripFormat)).length === 0,
  exemptions: mask(PROBES.exemptions) === PROBES.exemptions,
});

describe("T7: mutation checks", () => {
  afterEach(() => {
    vi.doUnmock(MODULE);
    vi.resetModules();
  });

  it("the masker as built passes every probe", async () => {
    const m = await maskModule();
    expect(typeof m.makeMasker).toBe("function");
    const mask = m.makeMasker?.(ALL).mask ?? (() => "");
    expect(passes(mask)).toEqual({ nfkc: true, stripFormat: true, exemptions: true });
    expect(m.maskText?.(PROBES.nfkc)).toBe(mask(PROBES.nfkc));
  });
  it.each(["nfkc", "stripFormat", "exemptions"] as const)(
    "without %s, its probe fails",
    async (part) => {
      const m = await maskModule();
      expect(typeof m.makeMasker).toBe("function");
      const mask = m.makeMasker?.({ ...ALL, [part]: false }).mask ?? ((t: string) => t);
      expect(passes(mask)[part]).toBe(false);
    },
  );
  it("without income masking, INC and observed income show IVF (T4 fails)", async () => {
    const actual = await maskModule();
    expect(typeof actual.maskText).toBe("function");
    vi.resetModules();
    vi.doMock(MODULE, () => ({ ...actual, maskText: (t: string) => t }));
    const { runProbe } = await import("./probes.js");
    const { repeat } = await import("../../families/lia/script.js");
    const r = runProbe(repeat(5, 14, { description: "IVF NIMBLE REPAY", amount: 900 }, 3), []);
    expect(strings(r.inc).flatMap(leaks)).toContain("IVF");
    expect(strings(r.income).flatMap(leaks)).toContain("IVF");
  });
});
