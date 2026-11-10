// SIG-42 review 9 (C1) and ruling of 9 November 2026 (20:29): the 7,500-case sweep. Review 9 found
// 257 green leaks, all through the exact-name path: an exact name with the wrong type (140), names
// differing only by digits or "Pty Ltd" (117, now one name under ruling 2), and collisions (ZÖP
// against Zíp; an empty name against "-"). This sweep is my own re-implementation, not the
// reviewer's harness: random cases from a fixed seed, and an oracle written from the ruling's text
// alone, independent of the engine's code. LIA-01 must be green exactly when the oracle finds a
// declaration of a matching type whose name is the same after ruling 2's normalisation and has at
// least 3 letters; otherwise amber. Never red.
// The 10 November 2026 ruling (06:39) refines "matching type": the exact type, or, for a loan the
// data doesn't type (this sweep's "loan", a "<NAME> LOAN" narrative), a declared personal_loan,
// car_loan or loan. Mortgages and cards never match a loan declaration, or each other.
// The 10 November ruling of 13:00 adds: a declared plain loan matches a loan the data types as a
// personal or car loan (a plain declaration doesn't conflict with a typed loan).
import { describe, expect, it } from "vitest";
import { repeat, run, signal, type Line } from "./script.js";

/** mulberry32: a small seeded generator, so the sweep is the same on every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES = [
  "credit_card",
  "personal_loan",
  "car_loan",
  "mortgage",
  "loan",
  "bnpl",
  "sacc",
  "wage_advance",
] as const;
type Type = (typeof TYPES)[number];
const LENDERS = [
  "MACQUARIE",
  "HARMONEY",
  "FIRSTMAC",
  "CITI",
  "PLENTI",
  "SOCIETYONE",
  "NIMBLE",
  "WESTPAC",
  "ZÖP",
  "ZÍP",
  "AB",
];

/** The found liability's feed lines, from its type, its lender as written, and its amount. */
function linesFor(type: Type, name: string, monthly: number): Line[] {
  const m = (description: string, category: string): Line[] =>
    repeat(6, 30, { description: `${description} 88123`, amount: -monthly, category });
  const f = (description: string, category: string): Line[] =>
    repeat(13, 14, { description, amount: -Math.round((monthly * 12 * 100) / 26) / 100, category });
  switch (type) {
    case "credit_card":
      return repeat(6, 30, {
        description: `BPAY ${name} CREDIT CARD 4417`,
        amount: -monthly,
        category: "transfer",
        billerName: `${name} CREDIT CARD`,
      });
    case "personal_loan":
      return m(`${name} PERSONAL LOAN`, "loan_repayment");
    case "car_loan":
      return m(`${name} CAR LOAN`, "loan_repayment");
    case "mortgage":
      return m(`${name} HOME LOAN`, "loan_repayment");
    case "loan":
      return m(`${name} LOAN`, "loan_repayment");
    case "bnpl":
      return f(`${name} INSTALMENT`, "bnpl");
    case "sacc":
      return f(`${name} LOAN`, "sacc_loan");
    case "wage_advance":
      return f(`${name} REPAYMENT`, "wage_advance");
  }
}

/** The 10 November ruling, read independently: missing type data isn't a conflict. */
const UNTYPED_MATCHES: readonly string[] = ["personal_loan", "car_loan", "loan"];
const PLAIN_MATCHES: readonly string[] = ["personal_loan", "car_loan"];
const typeMatches = (found: Type, declared: Type) =>
  found === declared ||
  (found === "loan" && UNTYPED_MATCHES.includes(declared)) ||
  (declared === "loan" && PLAIN_MATCHES.includes(found));

/** Ruling 2, read independently: NFC, case fold, digits and legal suffixes out, spacing tidied. */
function oracleName(name: string): string | null {
  const s = name
    .normalize("NFC")
    .toLowerCase()
    .replace(/[0-9]/g, " ")
    .replace(/[^\p{L}\p{M}]+/gu, " ")
    .replace(/(^| )(pty ltd|pty|ltd|limited)(?= |$)/g, " ")
    .replace(/ +/g, " ")
    .trim();
  return (s.match(/\p{L}/gu) ?? []).length >= 3 ? s : null;
}

/** A way an applicant might write the lender: the same name, or not. */
function declaredName(r: () => number, lender: string): string {
  const other = LENDERS[Math.floor(r() * LENDERS.length)] as string;
  const pick = Math.floor(r() * 10);
  const title = lender.charAt(0) + lender.slice(1).toLowerCase();
  return [
    lender,
    title,
    `${lender} ${Math.floor(r() * 90) + 10}`,
    `${title} Pty Ltd`,
    `${lender} LIMITED`,
    lender.normalize("NFD"),
    other,
    "",
    "-",
    `${title} Bank`,
  ][pick] as string;
}

type Case = {
  type: Type;
  lender: string;
  monthly: number;
  declared: { type: Type; provider: string; repayment_monthly?: number }[];
};
function cases(n: number, seed: number): Case[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const type = TYPES[Math.floor(r() * TYPES.length)] as Type;
    const lender = LENDERS[Math.floor(r() * LENDERS.length)] as string;
    const monthly = Math.round(50 + r() * 2450);
    const k = Math.floor(r() * 3);
    const declared = Array.from({ length: k }, () => {
      const t = r() < 0.5 ? type : (TYPES[Math.floor(r() * TYPES.length)] as Type);
      const ratio = 0.7 + r() * 0.6;
      return {
        type: t,
        provider: declaredName(r, lender),
        ...(r() < 0.85 ? { repayment_monthly: Math.round(monthly * ratio) } : {}),
      };
    });
    return { type, lender, monthly, declared };
  });
}

const N = 7500;
describe(`the ${N}-case sweep (seed 9): green exactly when the name and a matching type match`, () => {
  const all = cases(N, 9);
  const results = all.map((c) => {
    const s = signal(
      run({ lines: linesFor(c.type, c.lender, c.monthly) }, { declared_liabilities: c.declared }),
      "LIA-01",
    );
    const want = oracleName(c.lender);
    const exact =
      want !== null &&
      c.declared.some((d) => typeMatches(c.type, d.type) && oracleName(d.provider) === want);
    return { c, state: s.state, exact };
  });
  const show = (x: (typeof results)[number]) =>
    `${x.c.type} ${x.c.lender} $${x.c.monthly} vs ${JSON.stringify(x.c.declared)}: ${x.state}`;

  it("no green leak: never green unless the name and a matching type match", () => {
    const leaks = results.filter((x) => x.state === "green" && !x.exact).map(show);
    expect(
      leaks.length,
      `${leaks.length} green leaks; first: ${leaks.slice(0, 5).join(" | ")}`,
    ).toBe(0);
  }, 600_000);
  it("no over-flag: green whenever they do", () => {
    const missed = results.filter((x) => x.exact && x.state !== "green").map(show);
    expect(
      missed.length,
      `${missed.length} over-flags; first: ${missed.slice(0, 5).join(" | ")}`,
    ).toBe(0);
  });
  it("never red, and every liability is found (amber when not green)", () => {
    expect(results.filter((x) => x.state === "red").length).toBe(0);
    expect(
      results
        .filter((x) => !x.exact && x.state !== "amber")
        .map(show)
        .slice(0, 10),
    ).toEqual([]);
  });
  it("isn't vacuous: it covers each kind of review 9 leak", () => {
    const has = (f: (c: Case) => boolean) => all.filter(f).length;
    // exact name, a conflicting type
    expect(
      has((c) =>
        c.declared.some(
          (d) => !typeMatches(c.type, d.type) && oracleName(d.provider) === oracleName(c.lender),
        ),
      ),
    ).toBeGreaterThan(500);
    // exact name, an untyped loan declared as a personal or car loan (the 10 November ruling)
    expect(
      has((c) =>
        c.declared.some(
          (d) =>
            c.type === "loan" &&
            d.type !== "loan" &&
            typeMatches(c.type, d.type) &&
            oracleName(d.provider) === oracleName(c.lender),
        ),
      ),
    ).toBeGreaterThan(30);
    // exact name, a typed personal or car loan declared as a plain loan (the 13:00 ruling)
    expect(
      has((c) =>
        c.declared.some(
          (d) =>
            d.type === "loan" &&
            PLAIN_MATCHES.includes(c.type) &&
            oracleName(d.provider) === oracleName(c.lender),
        ),
      ),
    ).toBeGreaterThan(30);
    // names differing by digits or a legal suffix
    expect(
      has((c) => c.declared.some((d) => /\d|Pty Ltd|LIMITED/.test(d.provider))),
    ).toBeGreaterThan(500);
    // ZÖP against Zíp, and empty or punctuation-only names
    expect(
      has((c) => c.lender === "ZÖP" && c.declared.some((d) => /^Z[ÍíI]P$/i.test(d.provider))),
    ).toBeGreaterThan(5);
    expect(
      has((c) => c.declared.some((d) => d.provider === "" || d.provider === "-")),
    ).toBeGreaterThan(500);
    expect(results.filter((x) => x.exact).length).toBeGreaterThan(1000);
  });
});
