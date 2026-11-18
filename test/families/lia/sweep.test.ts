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

// The 16 November 2026 rulings (comment 40327, on review 10): exact-name pairing is the best
// overall fit. Mixed cases put two or three liabilities of one lender against one to three
// declarations, so declarations compete. The oracle is a brute force over every one-to-one
// pairing, written from the ruling's text: the most exact (name plus matching type) pairs; then
// the smallest total amount difference; then the documented tie-break (ADR 0006): liabilities in
// the detector's key order (family, then provider) each take the earliest declaration, in
// declaration order (type, name, amount, then the text as written), that keeps the pairing best.
const MIXED_TYPES = ["personal_loan", "car_loan", "loan", "mortgage", "credit_card"] as const;
type Mixed = {
  lender: string;
  found: { type: Type; monthly: number }[];
  declared: { type: Type; provider: string; repayment_monthly?: number }[];
};
function mixedCases(n: number, seed: number): Mixed[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const lender = LENDERS[Math.floor(r() * (LENDERS.length - 1))] as string; // not "AB"
    const pool: Type[] = [...MIXED_TYPES];
    const types: Type[] = [];
    const k = 2 + Math.floor(r() * 2);
    while (types.length < k) types.push(pool.splice(Math.floor(r() * pool.length), 1)[0] as Type);
    const found = types.map((type, i) => ({
      type,
      monthly: 100 + i * 7 + Math.round(r() * 60) * 10,
    }));
    const declared = Array.from({ length: 1 + Math.floor(r() * 3) }, () => {
      const near = found[Math.floor(r() * found.length)] as { monthly: number };
      const t = r() < 0.8 ? (MIXED_TYPES[Math.floor(r() * MIXED_TYPES.length)] as Type) : "loan";
      return {
        type: t,
        provider: r() < 0.75 ? lender : declaredName(r, lender),
        ...(r() < 0.9 ? { repayment_monthly: Math.round(near.monthly * (0.8 + r() * 0.4)) } : {}),
      };
    });
    return { lender, found, declared };
  });
}
/** The detector's grouping key, read from its documented provider form (A to Z, spaced). */
function keyOfFound(lender: string, type: Type): string {
  const provider = lender
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .replace(/ +/g, " ")
    .trim();
  const suffix: Partial<Record<Type, string>> = {
    personal_loan: " PERSONAL",
    car_loan: " CAR",
    mortgage: " HOME",
  };
  return type === "credit_card"
    ? `credit_card|${provider}`
    : `loan|${provider}${suffix[type] ?? ""}`;
}
const cents = (x: number) => Math.round(x * 100);
const MISSING = 1e9; // a missing amount: farther than any real one
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function oraclePairing(c: Mixed): boolean[] {
  const want = oracleName(c.lender);
  const nameKey = (p: string) => oracleName(p) ?? "￿";
  // Declaration order; duplicates (same type, name and amount) are one declaration.
  const seen = new Set<string>();
  const decl = [...c.declared]
    .sort(
      (a, b) =>
        cmp(a.type, b.type) ||
        cmp(nameKey(a.provider), nameKey(b.provider)) ||
        (a.repayment_monthly ?? Infinity) - (b.repayment_monthly ?? Infinity) ||
        cmp(a.provider, b.provider),
    )
    .filter((d) => {
      const k = `${d.type}|${oracleName(d.provider) ?? `#${d.provider}`}|${d.repayment_monthly ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const order = c.found
    .map((f, i) => ({ f, i, k: keyOfFound(c.lender, f.type) }))
    .sort((a, b) => cmp(a.k, b.k));
  const ok = (f: { type: Type }, d: (typeof decl)[number]) =>
    want !== null && oracleName(d.provider) === want && typeMatches(f.type, d.type);
  const diff = (f: { monthly: number }, d: (typeof decl)[number]) =>
    d.repayment_monthly === undefined
      ? MISSING
      : Math.abs(cents(f.monthly) - cents(d.repayment_monthly));
  // Every one-to-one pairing, as one choice per liability: a declaration's index, or none (last).
  const NONE = decl.length;
  let best: { n: number; cost: number; pick: number[] } | null = null;
  const pick: number[] = [];
  const beats = (n: number, cost: number, b: { n: number; cost: number; pick: number[] }) => {
    if (n !== b.n) return n > b.n;
    if (cost !== b.cost) return cost < b.cost;
    const j = pick.findIndex((p, i) => p !== b.pick[i]);
    return j >= 0 && (pick[j] as number) < (b.pick[j] as number);
  };
  const go = (j: number, used: Set<number>, n: number, cost: number) => {
    if (j === order.length) {
      if (best === null || beats(n, cost, best)) best = { n, cost, pick: [...pick] };
      return;
    }
    const f = (order[j] as (typeof order)[number]).f;
    decl.forEach((d, x) => {
      if (used.has(x) || !ok(f, d)) return;
      used.add(x);
      pick.push(x);
      go(j + 1, used, n + 1, cost + diff(f, d));
      pick.pop();
      used.delete(x);
    });
    pick.push(NONE);
    go(j + 1, used, n, cost);
    pick.pop();
  };
  go(0, new Set(), 0, 0);
  const chosen = (best as { pick: number[] } | null)?.pick ?? [];
  const declared = c.found.map(() => false);
  order.forEach(({ i }, j) => {
    declared[i] = chosen[j] !== NONE;
  });
  return declared;
}

const M = 3000;
describe(`the ${M}-case mixed sweep (seed 16): pairing is a maximum matching`, () => {
  const all = mixedCases(M, 16);
  const results = all.map((c) => {
    const lines = c.found.flatMap((f) => linesFor(f.type, c.lender, f.monthly));
    const r = run({ lines }, { declared_liabilities: c.declared });
    const byMonthly = new Map(r.liabilities.map((l) => [l.monthly, l.declared]));
    return {
      c,
      state: signal(r, "LIA-01").state,
      got: c.found.map((f) => byMonthly.get(f.monthly) ?? null),
      want: oraclePairing(c),
      found: r.liabilities.length,
    };
  });
  const show = (x: (typeof results)[number]) =>
    `${x.c.lender} ${JSON.stringify(x.c.found)} vs ${JSON.stringify(x.c.declared)}: got ${JSON.stringify(x.got)}, want ${JSON.stringify(x.want)}`;

  it("every liability is found, one per type", () => {
    expect(
      results
        .filter((x) => x.found !== x.c.found.length)
        .map(show)
        .slice(0, 5),
    ).toEqual([]);
  });
  it("each liability is declared exactly when the oracle's best pairing pairs it", () => {
    const wrong = results.filter((x) => JSON.stringify(x.got) !== JSON.stringify(x.want));
    expect(
      wrong.length,
      `${wrong.length} cases differ; first: ${wrong.slice(0, 3).map(show).join(" | ")}`,
    ).toBe(0);
  }, 600_000);
  it("LIA-01 is green exactly when every liability is paired, and never red", () => {
    const wrong = results.filter((x) => (x.state === "green") !== x.want.every(Boolean));
    expect(wrong.map(show).slice(0, 3)).toEqual([]);
    expect(results.filter((x) => x.state === "red").length).toBe(0);
  });
  it("isn't vacuous: declarations compete, and pairings are partial as well as full", () => {
    // a declaration the oracle could give to two or more of the liabilities
    const contested = all.filter((c) =>
      c.declared.some(
        (d) =>
          oracleName(d.provider) !== null &&
          oracleName(d.provider) === oracleName(c.lender) &&
          c.found.filter((f) => typeMatches(f.type, d.type)).length >= 2,
      ),
    );
    expect(contested.length).toBeGreaterThan(300);
    expect(results.filter((x) => x.want.every(Boolean)).length).toBeGreaterThan(100);
    expect(
      results.filter((x) => x.want.some((w) => !w) && x.want.some(Boolean)).length,
    ).toBeGreaterThan(300);
  });
});
