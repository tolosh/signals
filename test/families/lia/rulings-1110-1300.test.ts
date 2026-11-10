// SIG-42: Colin's rulings of 10 November 2026, 13:00 (comment 40215), LIA 1.3.3. Written before
// the change it tests:
//   2. With an exact name, a declared plain `loan` is green against a loan the data types as a
//      personal or car loan: a plain declaration doesn't conflict with a typed loan. Mortgages and
//      cards still never match a loan declaration.
//   3. The lender-name list is matched before digits are stripped, so Money3 shows as "MONEY3".
import { describe, expect, it } from "vitest";
import { LIA_VERSION } from "../../../src/engines/families/lia/index.js";
import {
  LENDER_NAMES,
  LENDER_NAMES_VERSION,
  lenderOf,
} from "../../../src/engines/families/lia/lenders.js";
import { repeat, run, signal, type Line } from "./script.js";

type Declared = { type: string; provider: string; repayment_monthly?: number };
const monthly = (description: string, amount: number, extra: Partial<Line> = {}): Line[] =>
  repeat(6, 30, { description, amount: -amount, ...extra });
const card = (issuer: string, amount: number): Line[] =>
  monthly(`BPAY ${issuer} CREDIT CARD 4417`, amount, {
    category: "transfer",
    billerName: `${issuer} CREDIT CARD`,
  });
const loan = (narrative: string, amount: number): Line[] =>
  monthly(`${narrative} 88123`, amount, { category: "loan_repayment" });
const sacc = (narrative: string, amount: number): Line[] =>
  repeat(13, 14, { description: narrative, amount: -amount, category: "sacc_loan" }, 3);
const lia = (lines: Line[], declared: Declared[] = []) =>
  run({ lines }, { declared_liabilities: declared });
const lia01 = (lines: Line[], declared: Declared[]) => signal(lia(lines, declared), "LIA-01");
const plain = (provider: string, amount: number): Declared[] => [
  { type: "loan", provider, repayment_monthly: amount },
];

describe("ruling 2: a declared plain loan is green against a typed personal or car loan", () => {
  it.each(["HARMONEY PERSONAL LOAN", "HARMONEY CAR LOAN", "HARMONEY AUTO LOAN"])(
    "%s, declared as a plain loan with the exact name, is green",
    (narrative) => {
      const s = lia01(loan(narrative, 450), plain("Harmoney", 450));
      expect(s.state).toBe("green");
      expect(s.value).toBe("1 found, all declared");
    },
  );
  it("the liabilities list marks it declared", () => {
    const r = lia(loan("HARMONEY PERSONAL LOAN", 450), plain("Harmoney", 450));
    expect(r.liabilities.map((l) => l.declared)).toEqual([true]);
  });
  it("needs the exact name: another name at the same amount is not green", () => {
    expect(lia01(loan("HARMONEY PERSONAL LOAN", 450), plain("Plenti", 450)).state).toBe("amber");
  });
  it("a mortgage still never matches a plain loan declaration", () => {
    for (const narrative of ["CBA HOME LOAN", "CBA MORTGAGE"])
      expect(lia01(loan(narrative, 2100), plain("CBA", 2100)).state, narrative).toBe("amber");
  });
  it("a card still never matches a plain loan declaration", () => {
    expect(lia01(card("CITI", 180), plain("Citi", 180)).state).toBe("amber");
  });
  it("a typed declaration still conflicts with the other type", () => {
    const s = lia01(loan("HARMONEY PERSONAL LOAN", 450), [
      { type: "car_loan", provider: "Harmoney", repayment_monthly: 450 },
    ]);
    expect(s.state).toBe("amber");
  });
});

describe("ruling 3: the lender list is matched before digits are stripped", () => {
  it("Money3 is on the list, in the list's form (letters and digits, single spaces)", () => {
    expect(LENDER_NAMES).toContain("MONEY3");
    for (const n of LENDER_NAMES) expect(n).toMatch(/^[A-Z0-9]+( [A-Z0-9]+)*$/);
  });
  it("names Money3 from the bank's description, not the digit-stripped provider", () => {
    expect(lenderOf("MONEY", "MONEY3 LOAN REPAYMENT 88123")).toBe("MONEY3");
    expect(lenderOf("MONEY", "MONEY 3 LOAN")).toBe("MONEY");
    expect(lenderOf("MONEY", "MONEY3X LOAN")).toBe("MONEY");
  });
  it("a reference number is not part of a name", () => {
    expect(lenderOf("CASH CONVERTERS", "CASH CONVERTERS 7781 LOAN")).toBe("CASH CONVERTERS");
  });
  it("names Money3 in LIA-03 and in the liabilities list", () => {
    const r = lia(sacc("MONEY3 LOAN 7781", 60));
    expect(signal(r, "LIA-03").reason).toContain("MONEY3");
    expect(r.liabilities.map((l) => l.provider)).toEqual(["MONEY3"]);
  });
  it("names Money3 in LIA-01's reason", () => {
    expect(lia01(loan("MONEY3 PERSONAL LOAN", 300), []).reason).toContain("MONEY3 (personal loan");
  });
  it("the list is 1.1.0 and LIA is 1.3.3", () => {
    expect(LENDER_NAMES_VERSION).toBe("1.1.0");
    expect(lia([]).lender_names_version).toBe("1.1.0");
    expect(LIA_VERSION).toBe("1.3.3");
  });
});
