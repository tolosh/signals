// SIG-42 T1 to T7: family 3 LIA (LIA-01 to LIA-06; Product Specification §7.2, Amendment 2 §4.2
// and LIA-R1). LIA-01 is built on SIG-18's detector at 1.0.0. Interpretations L-1 to L-8 are in
// docs/adr/0006-lia-family.md, for ruling.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LIA_VERSION } from "../../../src/engines/families/lia/index.js";
import { LIA_IDS, repeat, run, signal, stateOf, type Line, type Script } from "./script.js";

const loan = (provider: string, amount = 450, n = 6): Line[] =>
  repeat(n, 30, {
    description: `${provider} LOAN REPAYMENT`,
    amount: -amount,
    category: "loan_repayment",
  });
const sacc = (provider: string, n: number, first: number, every = 14): Line[] =>
  repeat(
    n,
    every,
    { description: `${provider} LOAN REPAYMENT`, amount: -95, category: "sacc_loan" },
    first,
  );
const bnpl = (provider: string, n = 6, amount = 60, first = 5): Line[] =>
  repeat(
    n,
    14,
    { description: `${provider} INSTALMENT`, amount: -amount, category: "bnpl" },
    first,
  );
const disbursement = (provider: string, ago: number, amount = 2000): Line => ({
  ago,
  description: `${provider} LOAN DISBURSEMENT`,
  amount,
});
const advance = (ago: number): Line[] => [
  { ago, description: "BEFOREPAY ADVANCE", amount: 150 },
  {
    ago: ago - 7 > 0 ? ago - 7 : 1,
    description: "BEFOREPAY REPAYMENT",
    amount: -150,
    category: "wage_advance",
  },
];
const privateLoan = (amount: number, n = 4, rising = false): Line[] =>
  Array.from({ length: n }, (_, i) => ({
    ago: 5 + i * 30,
    description: "TRANSFER TO J SMITH LOAN REPAYMENT",
    amount: -(rising ? amount * (1 + 0.15 * (n - 1 - i)) : amount),
    type: "TRANSFER_OUTGOING",
  }));

describe("T1: each LIA signal at each state it defines", () => {
  const cases: [string, string, Script, Parameters<typeof run>[1]?][] = [
    // LIA-01 Undisclosed liabilities (L-1)
    [
      "LIA-01",
      "green",
      { lines: loan("SOCIETYONE") },
      { declared_liabilities: [{ type: "personal_loan", provider: "SOCIETYONE" }] },
    ],
    ["LIA-01", "amber", { lines: loan("SOCIETYONE") }],
    [
      "LIA-01",
      "red",
      { lines: loan("SOCIETYONE") },
      { declared_liabilities: [], assessed_surplus_monthly: 300 },
    ],
    // LIA-02 Loan stacking (L-2)
    ["LIA-02", "green", { lines: [disbursement("PLENTI", 150)] }],
    ["LIA-02", "amber", { lines: [disbursement("PLENTI", 40)] }],
    ["LIA-02", "red", { lines: [disbursement("PLENTI", 40), disbursement("HARMONEY", 70)] }],
    // LIA-03 Payday and SACC (L-3)
    ["LIA-03", "amber", { lines: sacc("CASH CONVERTERS", 4, 120) }],
    ["LIA-03", "red", { lines: sacc("CASH CONVERTERS", 4, 10) }],
    // LIA-04 Wage advance (L-4)
    ["LIA-04", "amber", { lines: advance(60) }],
    ["LIA-04", "red", { lines: [10, 24, 38, 52, 66, 80].flatMap(advance) }],
    // LIA-05 BNPL (L-5)
    ["LIA-05", "green", { lines: bnpl("AFTERPAY") }],
    ["LIA-05", "amber", { lines: [...bnpl("AFTERPAY"), ...bnpl("ZIP PAY", 6, 60, 6)] }],
    [
      "LIA-05",
      "red",
      { lines: [...bnpl("AFTERPAY"), ...bnpl("ZIP PAY", 6, 60, 6), ...bnpl("KLARNA", 6, 60, 7)] },
    ],
    // LIA-06 Private loans (L-6)
    ["LIA-06", "amber", { lines: privateLoan(200) }],
    ["LIA-06", "red", { lines: privateLoan(800) }],
  ];
  it.each(cases.map((c, n) => [`${c[0]} ${c[1]} (#${n})`, ...c] as const))(
    "%s",
    (_label, id, state, script, application) => {
      expect(stateOf(run(script, application ?? { declared_liabilities: [] }), id)).toBe(state);
    },
  );

  it("LIA-03, LIA-04 and LIA-06 have no green above none_observed: nothing found is none_observed (EQ-R2)", () => {
    const r = run({});
    for (const id of ["LIA-03", "LIA-04", "LIA-06"]) expect(stateOf(r, id)).toBe("none_observed");
  });

  it("LIA-03 red when two SACC lenders' repayments overlap (concurrent), even if older than 90 days", () => {
    const r = run({ lines: [...sacc("CASH CONVERTERS", 4, 100), ...sacc("NIMBLE", 4, 110)] });
    expect(stateOf(r, "LIA-03")).toBe("red");
  });

  it("LIA-05 red when BNPL outflow is rising, with one provider", () => {
    const rising: Line[] = [...bnpl("AFTERPAY", 6, 40, 100), ...bnpl("AFTERPAY", 6, 120, 5)];
    expect(stateOf(run({ lines: rising }), "LIA-05")).toBe("red");
  });

  it("LIA-06 red when transfers to the individual are increasing", () => {
    expect(stateOf(run({ lines: privateLoan(200, 4, true) }), "LIA-06")).toBe("red");
  });
});

describe("T2: a disclosed car loan whose repayments are observed", () => {
  it("is not flagged by LIA-01", () => {
    const r = run(
      { lines: loan("MACQUARIE LEASING", 560) },
      { declared_liabilities: [{ type: "car_loan", provider: "MACQUARIE LEASING" }] },
    );
    expect(stateOf(r, "LIA-01")).toBe("green");
    expect(r.liabilities.find((l) => l.provider === "MACQUARIE LEASING")?.declared).toBe(true);
  });
});

describe("T3: two lender disbursements in 60 days", () => {
  it("make LIA-02 red", () => {
    const r = run({ lines: [disbursement("PLENTI", 10), disbursement("MONEY3", 55)] });
    expect(stateOf(r, "LIA-02")).toBe("red");
    expect(signal(r, "LIA-02").reason).toMatch(/2 lenders/);
  });
});

describe("T4: full coverage and no liabilities", () => {
  it("every LIA signal is none_observed", () => {
    const r = run({});
    for (const id of LIA_IDS) expect(stateOf(r, id), id).toBe("none_observed");
  });
});

describe("T5: an unshared account receiving regular transfers (EQ-02 fail)", () => {
  it("every LIA signal is unverified, not none_observed", () => {
    const transfers = repeat(5, 30, {
      description: "TRANSFER TO 062-000 99998888",
      amount: -800,
      type: "TRANSFER_OUTGOING",
    });
    const r = run({ lines: transfers });
    for (const id of LIA_IDS) expect(stateOf(r, id), id).toBe("unverified");
  });
});

describe("T6: deterministic", () => {
  it("identical inputs give a byte-identical output", () => {
    const s: Script = {
      lines: [...loan("SOCIETYONE"), ...bnpl("AFTERPAY"), disbursement("PLENTI", 40)],
    };
    const h = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
    expect(h(run(s))).toBe(h(run(s)));
  });
});

describe("T7 (negative control): the only credit is disclosed and on time", () => {
  it("yields no amber or red", () => {
    const r = run(
      { lines: loan("SOCIETYONE") },
      {
        declared_liabilities: [{ type: "personal_loan", provider: "SOCIETYONE" }],
        assessed_surplus_monthly: 2000,
      },
    );
    for (const id of LIA_IDS) expect(["amber", "red"], id).not.toContain(stateOf(r, id));
  });
});

describe("LIA-01 is built on SIG-18's detector, and says how far to trust it", () => {
  it("uses detector 1.0.0 at SIG-18's primary configuration, with its evidence", () => {
    const r = run({ lines: loan("SOCIETYONE") });
    expect(r.detector).toEqual({
      method_version: "1.0.0",
      min_occurrences: 3,
      amount_tolerance: 0.15,
    });
    expect(signal(r, "LIA-01").evidence_count).toBe(6);
  });

  it("states the template dependence and exact-name matching, at medium confidence", () => {
    const s = signal(run({ lines: loan("SOCIETYONE") }), "LIA-01");
    expect(s.confidence).toBe("medium");
    expect(s.reason).toMatch(/exact provider name/);
    expect(s.reason).toMatch(/synthetic/);
    expect(s.evidence_quality.review_required).toBe(true);
  });

  it("red needs the assessed surplus; without it, an undisclosed liability is amber", () => {
    expect(stateOf(run({ lines: loan("SOCIETYONE") }), "LIA-01")).toBe("amber");
    expect(
      stateOf(
        run(
          { lines: loan("SOCIETYONE") },
          { declared_liabilities: [], assessed_surplus_monthly: 2000 },
        ),
        "LIA-01",
      ),
    ).toBe("amber");
  });
});

describe("version", () => {
  it("is 1.1.0 (SIG-42 rulings)", () => expect(LIA_VERSION).toBe("1.1.0"));
});
