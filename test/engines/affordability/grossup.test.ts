// SIG-46: gross income from observed net pay (research/preregistrations/SIG-46.json, tests).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { grossUp, type GrossUpInput } from "../../../src/engines/affordability/grossup.js";
import { TAX_TABLES, type TaxTable } from "../../../src/engines/affordability/tax-tables.js";

const FY27 = "2026-10-31";
const FY26 = "2026-03-31";
const gross = (net: number, as_of = FY27, tables?: readonly TaxTable[]) => {
  const r = grossUp({ net: { salary_wage: net }, as_of }, tables);
  if (r.state !== "verified") throw new Error("expected a gross figure");
  return r.gross_income_annual;
};

describe("T1: known answers to $1 a year", () => {
  // Net from the ATO's published tax at each 2026-27 threshold, plus the 2% levy (X-2).
  it.each([
    [45_000, 45_000 - 4_020 - 900],
    [135_000, 135_000 - 31_020 - 2_700],
    [190_000, 190_000 - 51_370 - 3_800],
  ])("2026-27: gross %d from net %d", (want, net) => {
    expect(Math.abs(gross(net) - want)).toBeLessThanOrEqual(1);
  });

  it("2025-26: the ATO's Medicare example (Angie, $29,000, levy $98.90)", () => {
    const net = 29_000 - 0.16 * (29_000 - 18_200) - 98.9;
    expect(Math.abs(gross(net, FY26) - 29_000)).toBeLessThanOrEqual(1);
  });

  it("net at or below the tax-free threshold grosses to itself", () => {
    expect(gross(15_000)).toBe(15_000);
  });

  it("benefits are untaxed and added unchanged; variable income is taxed with pay", () => {
    const r = grossUp({ net: { salary_wage: 40_080, variable: 0, benefits: 5_000 }, as_of: FY27 });
    expect(r.state === "verified" && Math.abs(r.gross_income_annual - 50_000)).toBeLessThanOrEqual(
      1,
    );
    const split = grossUp({ net: { salary_wage: 30_000, variable: 10_080 }, as_of: FY27 });
    expect(
      split.state === "verified" && Math.abs(split.gross_income_annual - 45_000),
    ).toBeLessThanOrEqual(1);
  });

  it("records basis, table and the reasons gross may be misstated", () => {
    const r = grossUp({ net: { salary_wage: 101_280 }, as_of: FY27 });
    if (r.state !== "verified") throw new Error("verified expected");
    expect(r.basis).toBe("inferred");
    expect(r.table).toEqual({ id: "AU-RES-2026-27", version: 1 });
    expect(r.resolve_with).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/HELP/),
        expect.stringMatching(/salary sacrifice/i),
        expect.stringMatching(/non-resident/i),
        expect.stringMatching(/offset/i),
        expect.stringMatching(/provisional/i),
      ]),
    );
    expect(r.trace.length).toBeGreaterThanOrEqual(3);
  });
});

describe("T3: unverified net gives unverified gross", () => {
  it.each<[string, GrossUpInput["net"]]>([
    ["unverified", { state: "unverified" }],
    ["null", null],
    ["zero", { salary_wage: 0 }],
    ["negative", { salary_wage: -10 }],
  ])("%s net", (_, net) => {
    const r = grossUp({ net, as_of: FY27 });
    expect(r.state).toBe("unverified");
    expect(r).not.toHaveProperty("gross_income_annual");
  });

  it("a window outside every table is unverified", () => {
    expect(grossUp({ net: { salary_wage: 50_000 }, as_of: "2019-01-01" }).state).toBe("unverified");
  });
});

describe("T4: a mid-year table version is pinned, and replay reproduces", () => {
  const v1 = TAX_TABLES.find((t) => t.id === "AU-RES-2026-27" && t.version === 1)!;
  const v2: TaxTable = {
    ...v1,
    version: 2,
    effective_from: "2027-01-01",
    medicare: { ...v1.medicare, lower: 29_000, upper: 36_250, provisional: false },
  };
  const tables = [...TAX_TABLES, v2];

  it("before the change pins version 1; after pins version 2", () => {
    const before = grossUp({ net: { salary_wage: 30_000 }, as_of: FY27 }, tables);
    const after = grossUp({ net: { salary_wage: 30_000 }, as_of: "2027-02-01" }, tables);
    expect(before.state === "verified" && before.table.version).toBe(1);
    expect(after.state === "verified" && after.table.version).toBe(2);
  });

  it("replaying with the pinned version is byte-identical after a new version appears", () => {
    const first = grossUp({ net: { salary_wage: 30_000 }, as_of: FY27 });
    if (first.state !== "verified") throw new Error("verified expected");
    const replay = grossUp(
      { net: { salary_wage: 30_000 }, as_of: "2027-02-01", pinned: first.table },
      tables,
    );
    expect(JSON.stringify({ ...replay, as_of: null })).toBe(
      JSON.stringify({ ...first, as_of: null }),
    );
  });
});

describe("T5: identical inputs give byte-identical output", () => {
  it("same hash twice", () => {
    const h = () =>
      createHash("sha256")
        .update(
          JSON.stringify(
            grossUp({ net: { salary_wage: 87_654.32, benefits: 1_200 }, as_of: FY27 }),
          ),
        )
        .digest("hex");
    expect(h()).toBe(h());
  });
});

describe("T6 (negative control): the wrong year's table is detected", () => {
  it("2025-26's table on the 2026-27 $135,000 answer differs by more than $1", () => {
    const net = 135_000 - 31_020 - 2_700;
    expect(Math.abs(gross(net, FY26) - 135_000)).toBeGreaterThan(1);
  });
});
