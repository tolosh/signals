// SIG-63 T9 and V8: every reserved unseen-lender name of set v2.3 is invented. The ASIC check
// record (name, register, search date, result) is committed, and every name returns no match on
// the ASIC Professional Registers (credit licensees and credit representatives). V6 is carried:
// no reserved name appears in src/ or in a test outside the research code. Written before the
// generator and the check.
import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { unseenLendersInCode } from "../../../src/research/leakage/validity.js";

const RECORD = "research/datasets/synthetic-v2.3.reserved-names-asic.json";
const MODULE = "../../../src/research/generator/v23/index.js";
let names: string[] | null = null;
beforeAll(async () => {
  try {
    const g = (await import(/* @vite-ignore */ MODULE)) as {
      UNSEEN_PROVIDERS_V23: Record<string, readonly string[]>;
    };
    names = Object.values(g.UNSEEN_PROVIDERS_V23).flat();
  } catch {
    names = null;
  }
});
const reserved = () => {
  expect(names, "the set v2.3 generator exists").not.toBeNull();
  return names ?? [];
};
type Check = { name: string; register: string; searched: string; result: string };

describe("v2.3 reserved names (T9, V8)", () => {
  it("at least two reserved names per liability type, none repeated", () => {
    expect(reserved().length).toBeGreaterThanOrEqual(14);
    expect(new Set(reserved()).size).toBe(reserved().length);
  });
  it("none is a reserved name of an earlier set (they are new inventions)", async () => {
    const v22 = (await import("../../../src/research/generator/v22/index.js")).UNSEEN_PROVIDERS_V22;
    const v1 = await import("../../../src/research/generator/catalog.js");
    const old = new Set(
      [v22, v1.UNSEEN_PROVIDERS, v1.UNSEEN_PROVIDERS_V21].flatMap((m) =>
        Object.values(m as Record<string, readonly string[]>).flat(),
      ),
    );
    expect(reserved().filter((n) => old.has(n))).toEqual([]);
  });
  it("the ASIC check record is committed: each name on both registers, searched, no match", () => {
    expect(existsSync(RECORD), RECORD).toBe(true);
    const rec = JSON.parse(readFileSync(RECORD, "utf8")) as { set: string; checks: Check[] };
    expect(rec.set).toBe("synthetic-v2.3");
    for (const n of reserved())
      for (const register of ["credit licensees", "credit representatives"]) {
        const c = rec.checks.find((x) => x.name === n && x.register === register);
        expect(c, `${n} on ${register}`).toBeDefined();
        expect(c?.searched).toMatch(/^2026-\d\d-\d\d$/);
        expect(c?.result).toBe("no match");
      }
  });
  it("V6 carried: no reserved name in src/ or a test outside the research code", () => {
    expect(unseenLendersInCode(reserved())).toMatchObject({ pass: true });
  });
});
