// SIG-42: Colin's rulings of 10 November 2026 (06:39) on PR #47's three questions, LIA 1.3.2.
// Written before the change it tests:
//   1. A loan the data doesn't type is green against a declared `personal_loan`, `car_loan` or
//      `loan` with the exact name: missing type data isn't a conflict. Amber "possibly declared"
//      stays for a real conflict (the data shows one type, the declaration another). Mortgages and
//      cards never match a loan declaration, or each other.
//   2. A short, versioned list of known multi-word Australian lender names is matched before the
//      first-word rule ("CASH" for Cash Converters is not acceptable). The list is names only: it
//      never extends the text echoed from the bank's description.
import { describe, expect, it } from "vitest";
import {
  LENDER_NAMES,
  LENDER_NAMES_VERSION,
  lenderOf,
} from "../../../src/engines/families/lia/lenders.js";
import { LIA_VERSION } from "../../../src/engines/families/lia/index.js";
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

describe("ruling 1: a loan the data doesn't type is green when nothing conflicts", () => {
  it.each(["personal_loan", "car_loan", "loan"])(
    "an untyped loan with the exact name matches a declared %s as green",
    (type) => {
      const s = lia01(loan("HARMONEY LOAN REPAYMENT", 450), [
        { type, provider: "Harmoney", repayment_monthly: 450 },
      ]);
      expect(s.state).toBe("green");
      expect(s.value).toBe("1 found, all declared");
    },
  );
  it("the untyped match is by name: another name at the same amount is not green", () => {
    const s = lia01(loan("HARMONEY LOAN REPAYMENT", 450), [
      { type: "personal_loan", provider: "Plenti", repayment_monthly: 450 },
    ]);
    expect(s.state).toBe("amber");
  });
  it("a real conflict stays amber: the data shows a personal loan, a car loan is declared", () => {
    const s = lia01(loan("HARMONEY PERSONAL LOAN", 450), [
      { type: "car_loan", provider: "Harmoney", repayment_monthly: 450 },
    ]);
    expect(s.state).toBe("amber");
    expect(s.reason).toContain(
      "Possibly the declared Harmoney ($450 a month): confirm with the applicant",
    );
  });
  it("a mortgage never matches a loan declaration, and an untyped loan never a mortgage", () => {
    for (const type of ["personal_loan", "car_loan", "loan"])
      expect(
        lia01(loan("CBA HOME LOAN", 2100), [{ type, provider: "CBA", repayment_monthly: 2100 }])
          .state,
        type,
      ).toBe("amber");
    expect(
      lia01(loan("CBA LOAN", 2100), [
        { type: "mortgage", provider: "CBA", repayment_monthly: 2100 },
      ]).state,
    ).toBe("amber");
  });
  it("a card never matches a loan or a mortgage declaration, nor a loan a card", () => {
    for (const type of ["personal_loan", "car_loan", "loan", "mortgage"])
      expect(
        lia01(card("CITI", 180), [{ type, provider: "Citi", repayment_monthly: 180 }]).state,
        type,
      ).toBe("amber");
    expect(
      lia01(loan("CITI LOAN", 180), [
        { type: "credit_card", provider: "Citi", repayment_monthly: 180 },
      ]).state,
    ).toBe("amber");
  });
  it("the liabilities list marks the untyped match declared", () => {
    const r = lia(loan("HARMONEY LOAN REPAYMENT", 450), [
      { type: "personal_loan", provider: "Harmoney", repayment_monthly: 450 },
    ]);
    expect(r.liabilities.map((l) => l.declared)).toEqual([true]);
  });
});

describe("ruling 2: known multi-word lender names before the first-word rule", () => {
  it("is a short, versioned list", () => {
    expect(LENDER_NAMES_VERSION).toBe("1.0.0");
    expect(LENDER_NAMES.length).toBeGreaterThan(5);
    expect(LENDER_NAMES.length).toBeLessThan(40);
    // names only, in the detector's provider form (upper case letters, single spaces)
    for (const n of LENDER_NAMES) expect(n).toMatch(/^[A-Z]+( [A-Z]+)+$/);
  });
  it.each([
    ["CASH CONVERTERS", "CASH CONVERTERS"],
    ["CASH CONVERTERS IVF CLINIC", "CASH CONVERTERS"],
    ["WALLET WIZARD", "WALLET WIZARD"],
    ["BANK OF QUEENSLAND", "BANK OF QUEENSLAND"],
    ["BENDIGO BANK HOME", "BENDIGO BANK"],
    ["GREAT SOUTHERN BANK", "GREAT SOUTHERN BANK"],
    ["MACQUARIE BANK", "MACQUARIE BANK"],
    ["MACQUARIE LEASING", "MACQUARIE"],
    ["CASH ADVANCE CO", "CASH"],
    ["NIMBLE ONCOLOGY", "NIMBLE"],
    ["PLENTI", "PLENTI"],
  ])("%s is named %s", (provider, name) => {
    expect(lenderOf(provider)).toBe(name);
  });
  it("matches whole words only, never part of one", () => {
    expect(lenderOf("CASH CONVERTERSX")).toBe("CASH");
    expect(lenderOf("BANK OF QUEENSLANDER")).toBe("BANK");
  });
  it("never echoes more than the list's name from the description", () => {
    for (const n of LENDER_NAMES) expect(lenderOf(`${n} SMILE DENTAL REF`)).toBe(n);
  });
  it("names Cash Converters in LIA-03 and in the liabilities list, not CASH", () => {
    const r = lia(sacc("CASH CONVERTERS LOAN", 60));
    const s = signal(r, "LIA-03");
    expect(s.reason).toContain("CASH CONVERTERS");
    expect(s.reason).not.toMatch(/CASH(?! CONVERTERS)/);
    expect(r.liabilities.map((l) => l.provider)).toEqual(["CASH CONVERTERS"]);
  });
  it("names a listed lender in LIA-01's reason, and only the lender", () => {
    const s = lia01(loan("BANK OF QUEENSLAND PERSONAL LOAN IVF", 300), []);
    expect(s.reason).toContain("BANK OF QUEENSLAND (personal loan");
    expect(s.reason).not.toContain("IVF");
  });
  it("LIA records the list's version, and is 1.3.2", () => {
    const r = lia([]);
    expect(r.lender_names_version).toBe(LENDER_NAMES_VERSION);
    expect(LIA_VERSION).toBe("1.3.2");
  });
});
