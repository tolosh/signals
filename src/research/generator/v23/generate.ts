// SIG-63 set v2.3: set v2.2's label-blind generation (SIG-60), with review 11's channels removed
// and the pre-registered changes of research/preregistrations/SIG-63.json:
//   - biller codes: one length distribution and HMAC digits for every biller, bill or lender, seen
//     or unseen; one registered name a code, shown in full or cut to 20 characters by HMAC of the
//     line (D-L4-1);
//   - reserved unseen lenders are invented (catalog.ts);
//   - drift: the pool excludes applicants who couldn't show a drift line, and the truth labels
//     both descriptors of the pair (T3, L5);
//   - declarations: a larger alias generator with a repeat cap, descriptor and product words drawn
//     independently of the class, and approximate, rounded amounts (D-L4-2, D-L4-3);
//   - realism: value dates, weekend purchases, reconciling balances, interest on loans, wage
//     advances not every cycle, channel mix by type, varied creation dates, no doubled product
//     names.
// From set v2.2: Every applicant is built by one process from shared
// distributions; truth labels are then applied to entities drawn at random from their unlabelled
// twins, and the label changes only what it must:
//   - undisclosed: a liability generated like any other, then left off the application;
//   - natural declarations: one alias generator for everyone; the group raises only the chance
//     of a genuinely different name;
//   - payer drift: a later rendering of otherwise normal pay, from the same descriptor list;
//   - dishonour: a normal direct debit that bounces (its return, and the bank's scheduled fee).
// No group has its own code path for any feed field. IDs are HMAC-SHA256(seed, counter) in a
// shuffled order. Deterministic: no clock, and every draw comes from a named seeded stream.
import { createHmac } from "node:crypto";
import { stream, type Rng } from "../rng.js";
import { netFromGross, taxTable } from "../tax.js";
import {
  AS_OF_DATE,
  type Cadence,
  type FeedAccount,
  type GeneratedApplicant,
  type GroundTruth,
  type Transaction,
} from "../types.js";
import {
  BANKS,
  BENEFIT_PAYER,
  BILLS,
  DINING_V23,
  EMPLOYERS_V23,
  FUEL_V23,
  GAMBLING_V23,
  GIG_PAYERS_V23,
  GROCERY_V23,
  LENDERS,
  LOAN_WORDS,
  PAY_TEMPLATES,
  PRODUCT_WORDS,
  PEOPLE,
  SUBSCRIPTIONS_V23,
  SUBURBS_V23,
  UNSEEN_PROVIDERS_V23,
  type Bank,
  type LiabilityTypeV23,
} from "./catalog.js";

export const SET_V23_SEED = 623;
export const SET_V23_SIZE = 780;
export const GENERATOR_VERSION_V23 = "2.3.0";
export const GROUND_TRUTH_SCHEMA_VERSION_V23 = "2.3.0";
const TAX_YEAR = "2026-27";

/** The share of each type's holders whose liability is left off the application. */
export const UNDISCLOSED_SHARE = 0.25;
/** Holders per liability type: one random draw of applicants per type, independent of the rest. */
export const HOLDERS: Record<LiabilityTypeV23, number> = {
  credit_card: 320,
  personal_loan: 120,
  car_loan: 140,
  mortgage: 48,
  bnpl: 160,
  sacc: 84,
  wage_advance: 84,
};
/** Labelled groups drawn from their twin pools. */
export const GROUP_SIZE = {
  natural: 24,
  drift_over_time: 24,
  drift_across_banks: 24,
  dishonour: 24,
};

// --- calendar: whole UTC days; posting happens on banking days --------------------------------
const DAY = 86_400_000;
const toDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY;
const toIso = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
const HOLIDAYS = new Set(
  [
    "2025-12-25",
    "2025-12-26",
    "2026-01-01",
    "2026-01-26",
    "2026-04-03",
    "2026-04-06",
    "2026-04-25",
  ].map(toDay),
);
const weekday = (day: number) => ((day % 7) + 7 + 4) % 7;
const banking = (day: number) => weekday(day) !== 0 && weekday(day) !== 6 && !HOLIDAYS.has(day);
const onOrAfter = (day: number) => {
  let d = day;
  while (!banking(d)) d++;
  return d;
};
const onOrBefore = (day: number) => {
  let d = day;
  while (!banking(d)) d--;
  return d;
};
const addBanking = (day: number, n: number) => {
  let d = day;
  for (let k = 0; k < n; k++) d = onOrAfter(d + 1);
  return d;
};
const ymd = (day: number) => {
  const d = new Date(day * DAY);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
};
const END = toDay(AS_OF_DATE);
const LAST = onOrBefore(END);
function windowOf(months: number) {
  const { y, m, d } = ymd(END);
  return { start: Date.UTC(y, m - months, d) / DAY + 1, end: END };
}

const MONTHLY: Record<Cadence, number> = {
  weekly: 52 / 12,
  fortnightly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
};
const PAYS = { weekly: 52, fortnightly: 26, monthly: 12 } as const;
const round2 = (n: number) => Math.round(n * 100) / 100;
const cents = (dollars: number) => Math.round(dollars * 100);
const money = (c: number) => {
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
};
const logUniform = (rng: Rng, lo: number, hi: number) =>
  Math.exp(Math.log(lo) + rng.next() * (Math.log(hi) - Math.log(lo)));
const pick = <T>(rng: Rng, items: readonly T[]): T => rng.pick(items);
const digits = (rng: Rng, n: number) =>
  Array.from({ length: n }, (_, i) => (i === 0 ? rng.int(1, 9) : rng.int(0, 9))).join("");
const shuffled = <T>(rng: Rng, items: readonly T[]): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
};

// --- HMAC draws: named by (seed, text), independent of every stream ---------------------------------
const hmacBytes = (seed: number, text: string) =>
  createHmac("sha256", String(seed)).update(text).digest();
/** A uniform draw in [0, 1) from HMAC-SHA256(seed, text). */
const hu = (seed: number, text: string) => hmacBytes(seed, text).readUInt32BE(0) / 4294967296;
/** A standard normal draw from two HMAC uniforms (Box-Muller). */
const hnormal = (seed: number, text: string) => {
  const u = Math.max(hu(seed, `${text}|u`), 1e-12);
  const v = hu(seed, `${text}|v`);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// --- biller codes (SIG-63 generation_parameters.biller_codes) -------------------------------------
/** Code lengths and their shares: one distribution for every biller. */
export const CODE_LENGTHS: readonly [number, number][] = [
  [3, 0.02],
  [4, 0.28],
  [5, 0.3],
  [6, 0.3],
  [7, 0.05],
  [8, 0.02],
  [9, 0.02],
  [10, 0.01],
];
type Biller = { code: string; name: string; cue: boolean };
/**
 * Every biller's code and registered name. A code's length is drawn from CODE_LENGTHS and its
 * digits from HMAC-SHA256(seed, biller ID), no leading zero; a collision redraws. Billers are
 * coded in ID order, so the codes don't depend on the order anything is generated in.
 */
function billerRegistry(seed: number): Map<string, Biller> {
  const entries: [string, { name: () => string; cue: boolean }][] = [];
  // A card issuer registers its biller with a card word (a cue) or under its legal name. By quota,
  // as populations are set: 35% of issuers (rounded) have no cue, the lowest by HMAC rank
  // (amendment A2; independent draws gave 1 of 9).
  const issuers = Object.keys(LENDERS.credit_card)
    .map((key) => `lender:credit_card:${key}`)
    .sort((a, b) => hu(seed, `${a}|cue`) - hu(seed, `${b}|cue`));
  const noCue = new Set(issuers.slice(0, Math.round(0.35 * issuers.length)));
  for (const bill of BILLS)
    for (const p of bill.payees) {
      const id = `bill:${bill.kind}:${p.short}`;
      entries.push([
        id,
        { name: () => (hu(seed, `${id}|name`) < 0.5 ? p.short : p.legal), cue: false },
      ]);
    }
  for (const type of Object.keys(LENDERS) as LiabilityTypeV23[])
    for (const [key, lender] of Object.entries(LENDERS[type])) {
      const id = `lender:${type}:${key}`;
      const cue = type === "credit_card" && !noCue.has(id);
      const brand = productBrand(lender.feed[0] ?? key);
      entries.push([
        id,
        {
          name: () =>
            type === "credit_card" && cue
              ? `${brand} ${hu(seed, `${id}|card-word`) < 0.5 ? "CREDIT CARDS" : "CARDS"}`
              : lender.legal,
          cue,
        },
      ]);
    }
  entries.sort(([a], [b]) => (a < b ? -1 : 1));
  const used = new Set<string>();
  const out = new Map<string, Biller>();
  for (const [id, e] of entries) {
    let code = "";
    for (let attempt = 0; !code || used.has(code); attempt++) {
      const bytes = hmacBytes(seed, `biller|${id}|${attempt}`);
      const u = bytes.readUInt32BE(0) / 4294967296;
      let acc = 0;
      let length = 10;
      for (const [n, p] of CODE_LENGTHS) {
        acc += p;
        if (u < acc) {
          length = n;
          break;
        }
      }
      code = Array.from({ length }, (_, i) =>
        i === 0 ? 1 + ((bytes[4 + i] ?? 0) % 9) : (bytes[4 + i] ?? 0) % 10,
      ).join("");
    }
    used.add(code);
    out.set(id, { code, name: e.name(), cue: e.cue });
  }
  return out;
}
/** A lender's brand for product and biller names: its feed form without loan-type words. */
function productBrand(feedForm: string): string {
  const drop = new Set([
    "HOME",
    "LOAN",
    "LOANS",
    "PERSONAL",
    "HL",
    "PL",
    "CREDIT",
    "CARD",
    "LENDING",
  ]);
  const kept = feedForm.split(" ").filter((w) => !drop.has(w.toUpperCase()));
  return (kept.length > 0 ? kept : feedForm.split(" ")).join(" ");
}

/** Days an item with this cadence falls on, inside [start, end], before banking-day posting. */
function schedule(rng: Rng, cadence: Cadence, start: number, end: number): number[] {
  const days: number[] = [];
  if (cadence === "weekly" || cadence === "fortnightly") {
    const step = cadence === "weekly" ? 7 : 14;
    for (let d = start + rng.int(0, step - 1); d <= end; d += step) days.push(d);
    return days;
  }
  const dom = rng.int(1, 28);
  const every = cadence === "monthly" ? 1 : cadence === "quarterly" ? 3 : 12;
  const anchor = rng.int(0, every - 1);
  const first = ymd(start);
  for (let i = -1; i <= 13; i++) {
    const mi = first.y * 12 + first.m + i;
    if (((mi % every) + every) % every !== anchor) continue;
    const d = Date.UTC(Math.floor(mi / 12), mi % 12, dom) / DAY;
    if (d >= start && d <= end) days.push(d);
  }
  return days;
}

// --- shared processes -----------------------------------------------------------------------------
/** Every amount, of any kind: whole dollars with this chance, else cents. */
const ROUND_DOLLARS = 0.3;
const shapeAmount = (dollars: number, round: boolean) =>
  round ? Math.max(1, Math.round(dollars)) * 100 : Math.max(1, cents(dollars));
/** How a recurring obligation is paid: the mix depends on what it is (review 11, realism). */
type Channel = "DIRECT_DEBIT" | "BPAY" | "PAYMENT";
/** Shares of direct debit and BPAY; the rest is a transfer. A stated choice, not measured. */
const CHANNEL_MIX: Record<LiabilityTypeV23 | "bill", [number, number]> = {
  bill: [0.5, 0.4],
  credit_card: [0.15, 0.55],
  personal_loan: [0.8, 0.1],
  car_loan: [0.8, 0.1],
  mortgage: [0.7, 0.05],
  bnpl: [0.92, 0],
  sacc: [0.88, 0.02],
  wage_advance: [0.95, 0],
};
const channelOf = (rng: Rng, kind: LiabilityTypeV23 | "bill"): Channel => {
  const [dd, bpay] = CHANNEL_MIX[kind];
  const u = rng.next();
  return u < dd ? "DIRECT_DEBIT" : u < dd + bpay ? "BPAY" : "PAYMENT";
};
/** References on incoming credits from third parties: one generator for pay and everything else. */
function creditRef(rng: Rng): (day: number) => string {
  const u = rng.next();
  const fixed = digits(rng, rng.int(6, 8));
  const hex = Array.from({ length: 8 }, () => "0123456789ABCDEF"[rng.int(0, 15)]).join("");
  const word = pick(rng, ["PAY", "SAL", "WAGES", "TFR", "PMT", "INV"]);
  if (u < 0.4) return () => "";
  if (u < 0.55) return () => `REF ${fixed}`;
  if (u < 0.7) return (d) => `${word} ${toIso(d).slice(8, 10)}${toIso(d).slice(5, 7)}`;
  if (u < 0.85) return (d) => toIso(d);
  return () => hex;
}
/** References on outgoing obligations (mandate or customer references). */
function debitRef(rng: Rng): string {
  const u = rng.next();
  if (u < 0.5) return "";
  if (u < 0.75) return digits(rng, rng.int(6, 9));
  return `${pick(rng, ["REF", "INV", "ACC", "CUST"])}${digits(rng, rng.int(5, 8))}`;
}

// --- the alias generator (one for every declaration) ----------------------------------------------
const SUFFIX_WORDS = new Set(
  "PTY LTD LIMITED GROUP CORPORATION CORP CO INC CREDIT CARD CARDS PERSONAL CAR HOME LOAN LOANS MORTGAGE".split(
    " ",
  ),
);
const compact = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !SUFFIX_WORDS.has(w))
    .join("");
/** The validity check's rule (SIG-60 V2): not reducible to the feed's name. */
export const differs = (a: string, b: string) => {
  const x = compact(a);
  const y = compact(b);
  return Boolean(x && y) && !(x.includes(y) || y.includes(x));
};
const TYPE_SUFFIX: Record<LiabilityTypeV23, string> = {
  credit_card: " credit card",
  personal_loan: " personal loan",
  car_loan: " car loan",
  mortgage: " home loan",
  bnpl: "",
  sacc: " loan",
  wage_advance: "",
};
/** The alias part of a (lender, alias) pair, as V9 counts it: suffix and type words don't count. */
const aliasKey = (s2: string) =>
  s2
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !SUFFIX_WORDS.has(w))
    .join(" ");
/** V9's cap: no (lender, alias) pair is used by more than this many natural-form declarations. */
export const ALIAS_CAP = 4;
/**
 * The generator's own cap, inside V9's (amendment A5): a pair is drawn at most this many times,
 * counted the strict way (suffix and type words don't make a new alias), so natural forms spread
 * over the pool instead of repeating its plainest names.
 */
export const GENERATOR_ALIAS_CAP = 3;
const DESCRIPTORS = ["Australia", "Finance", "Financial", "Services", "Group"];
/**
 * Natural forms of a legal name: its first word or two, and its abbreviations written out or
 * contracted ("AUST AND NZ BANKING GROUP": "Aust", "Aust and NZ", "Australia and New Zealand
 * Banking", "Aust & NZ Banking"). The class of each is decided by the validity rule as for any name.
 */
function legalForms(legal: string): string[] {
  const words = legal
    .replace(/\b(PTY|LTD|LIMITED)\b\.?/gi, "")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>([words.join(" ")]);
  if ((words[0] ?? "").length >= 4) out.add(words[0] ?? "");
  if (words.length > 2) out.add(words.slice(0, 2).join(" "));
  const expand: Record<string, string> = {
    AUST: "Australia",
    AUS: "Australia",
    NZ: "New Zealand",
    AND: "&",
    "&": "and",
    CORP: "Corporation",
    FIN: "Finance",
    HL: "Home Loans",
  };
  const written = words.map((w) => expand[w.toUpperCase()] ?? w).join(" ");
  if (written !== words.join(" ")) out.add(written);
  return [...out].filter((n) => n.length >= 2);
}
/** A misspelling of one word of four or more letters: a dropped, doubled or swapped letter. */
function misspell(name: string, u: (k: string) => number): string {
  const words = name.split(" ");
  const long = words.map((w, i) => [w, i] as const).filter(([w]) => /^[A-Za-z]{4,}$/.test(w));
  if (long.length === 0) return name;
  const [w, i] = long[Math.floor(u("word") * long.length)] ?? ["", 0];
  const at = 1 + Math.floor(u("at") * (w.length - 2));
  const op = u("op");
  const out =
    op < 1 / 3
      ? w.slice(0, at) + w.slice(at + 1)
      : op < 2 / 3
        ? w.slice(0, at) + (w[at] ?? "") + w.slice(at)
        : w.slice(0, at) + (w[at + 1] ?? "") + (w[at] ?? "") + w.slice(at + 2);
  words[i] = out;
  return words.join(" ");
}
/**
 * A declared name of the class drawn for it (`different`: genuinely different from the feed's form,
 * by the validity rule; else reducible to it). One generator for everyone: the base is drawn from
 * the class's pool, then a misspelling, a product word, a descriptor word, the case, a legal suffix
 * and a type suffix are each drawn independently of the class (V10). A candidate whose class by
 * the rule isn't the drawn one, or (different class) whose (lender, alias) pair has reached the
 * cap, is redrawn (V9). All draws by HMAC of the seed and the declaration's ID.
 */
function declaredName(
  seed: number,
  declId: string,
  type: LiabilityTypeV23,
  lenderKey: string,
  feedForm: string,
  different: boolean,
  pairs: Map<string, number>,
): { name: string; descriptor: boolean } {
  const lender = LENDERS[type][lenderKey];
  if (!lender) throw new Error(`no lender ${lenderKey}`);
  const strip = (n: string) =>
    n
      .replace(/\b(PTY|LTD|LIMITED)\b\.?/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  const pool = [
    ...new Set(
      [...lender.feed, ...lender.same, ...lender.different, ...legalForms(lender.legal)].map(strip),
    ),
  ];
  const diff = pool.filter((n) => differs(n, feedForm));
  const same = pool.filter((n) => !differs(n, feedForm) && compact(n) !== "");
  if (diff.length === 0)
    throw new Error(`${lenderKey}: no genuinely different name for ${feedForm}`);
  const classPool = different ? diff : same.length > 0 ? same : [feedForm];
  let fallback: { name: string; descriptor: boolean } | null = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const u = (k: string) => hu(seed, `decl|${declId}|${attempt}|${k}`);
    const at = <T>(k: string, xs: readonly T[]): T => xs[Math.floor(u(k) * xs.length)] as T;
    let base = at("base", classPool);
    if (u("misspell") < 0.2) base = misspell(base, (k) => u(`misspell:${k}`));
    // A product name, sometimes of two words ("Low Rate Visa"), on either class of name.
    if (u("product") < 0.4) {
      const first = at("product-word", PRODUCT_WORDS[type]);
      const rest = PRODUCT_WORDS[type].filter((w) => w !== first);
      base += ` ${first}${u("product-two") < 0.3 ? ` ${at("product-word-2", rest)}` : ""}`;
    }
    const descriptor = u("descriptor") < 0.25;
    if (descriptor) base += ` ${at("descriptor-word", DESCRIPTORS)}`;
    const c = u("case");
    let name =
      c < 0.3
        ? base.toUpperCase()
        : c < 0.45
          ? base.toLowerCase()
          : c < 0.75
            ? base
                .toLowerCase()
                .replace(
                  /(^|[\s&/-])([a-z])/g,
                  (_m, sp: string, ch: string) => sp + ch.toUpperCase(),
                )
            : base;
    if (u("legal") < 0.25 && !/\b(pty|ltd|limited)\b/i.test(name))
      name += u("legal-form") < 0.5 ? " Pty Ltd" : " Ltd";
    if (u("type-suffix") < 0.3) name += TYPE_SUFFIX[type];
    if (differs(name, feedForm) !== different) continue;
    fallback ??= { name, descriptor };
    if (!different) return { name, descriptor };
    const key = `${type}:${lenderKey}|${aliasKey(name)}`;
    if ((pairs.get(key) ?? 0) >= GENERATOR_ALIAS_CAP) continue;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
    return { name, descriptor };
  }
  // Every draw was saturated or of the wrong class: V9 or V10 then fails, as it should.
  if (!fallback) throw new Error(`${declId}: no declared name of the drawn class`);
  return fallback;
}

/** The declared monthly repayment: the truth's, with an error, rounded the way applicants round. */
function declaredAmount(seed: number, declId: string, truthMonthly: number): number {
  const u = (k: string) => hu(seed, `amount|${declId}|${k}`);
  const e =
    u("exact") < 0.5
      ? 0
      : Math.max(-0.25, Math.min(0.25, 0.08 * hnormal(seed, `amount|${declId}|e`)));
  const x = truthMonthly * (1 + e);
  const r = u("unit");
  const units = [100, 50, 10, 1];
  let k = r < 0.35 ? 3 : r < 0.7 ? 2 : r < 0.9 ? 1 : 0;
  let out = Math.round(x / (units[k] ?? 1)) * (units[k] ?? 1);
  // Amendment A1: a rounding that would give $0 falls back to the next finer unit.
  while (out === 0 && k < units.length - 1) {
    k++;
    out = Math.round(x / (units[k] ?? 1)) * (units[k] ?? 1);
  }
  return Math.max(1, out);
}

// --- specs: drawn per applicant from shared processes --------------------------------------------
type Archetype = "salaried" | "variable" | "gig" | "benefits";
type LiabilitySpec = {
  id: string;
  type: LiabilityTypeV23;
  lenderKey: string;
  feedForm: string;
  unseen: boolean;
  cadence: Cadence;
  amount: number;
  round: boolean;
  variable: boolean;
  channel: Channel;
  fromSecond: boolean;
  paidFromUnshared: boolean;
  accountShared: boolean;
  narrativeRef: string | null;
  cue: boolean;
  word: string | null;
  balance: number;
  limit: number | null;
  mortgage: {
    purpose: "owner_occupier" | "investor";
    feature: "offset" | "redraw" | "none";
  } | null;
  declared: boolean;
  /** Share of pay cycles a wage advance is drawn in (1 for every other liability). */
  use: number;
};
type Spec = {
  index: number;
  archetype: Archetype;
  history: 1 | 3 | 6 | 12;
  request: 3 | 6 | 12;
  feed: "cdr" | "uploaded_statement";
  bank: Bank;
  second: Bank | null;
  splitShare: number;
  salaryUnshared: boolean;
  externalAccounts: number;
  cadence: "weekly" | "fortnightly" | "monthly";
  payer: string;
  gross: number;
  variability: number;
  basePerPay: number;
  template: number;
  overtime: { share: number; amount: number } | null;
  bonus: number | null;
  change: { afterDays: number; gross: number; payer: string | null; template: number } | null;
  liabilities: LiabilitySpec[];
  profile: "lean" | "typical" | "high";
  savingsMonthly: number;
  gamblingWeekly: number;
  friends: boolean;
  natural: boolean;
  drift: { mode: "over_time" | "across_banks"; template: number } | null;
};

const LIABILITY_RANGES: Record<
  LiabilityTypeV23,
  { cadences: Cadence[]; monthly: [number, number] }
> = {
  credit_card: { cadences: ["monthly"], monthly: [60, 1500] },
  personal_loan: { cadences: ["monthly", "fortnightly"], monthly: [250, 950] },
  car_loan: { cadences: ["monthly", "fortnightly"], monthly: [220, 900] },
  mortgage: { cadences: ["monthly", "fortnightly"], monthly: [1500, 5500] },
  bnpl: { cadences: ["fortnightly"], monthly: [40, 320] },
  sacc: { cadences: ["fortnightly", "monthly"], monthly: [100, 420] },
  wage_advance: { cadences: ["fortnightly"], monthly: [200, 800] },
};

function liabilitySpec(
  seed: number,
  index: number,
  k: number,
  type: LiabilityTypeV23,
  payCadence: Spec["cadence"],
  reg: Map<string, Biller>,
): LiabilitySpec {
  const r = stream(seed, `v23:liability:${index}:${type}`);
  const unseenNames = UNSEEN_PROVIDERS_V23[type];
  const seen = Object.keys(LENDERS[type]).filter((n) => !unseenNames.includes(n));
  const unseen = r.chance(0.12);
  const lenderKey = pick(r, unseen ? unseenNames : seen);
  const lender = LENDERS[type][lenderKey];
  if (!lender) throw new Error(lenderKey);
  const range = LIABILITY_RANGES[type];
  const cadence: Cadence = type === "wage_advance" ? payCadence : pick(r, range.cadences);
  const monthly = logUniform(r, range.monthly[0], range.monthly[1]);
  const shareable = ["credit_card", "personal_loan", "car_loan", "mortgage"].includes(type);
  const isCard = type === "credit_card";
  const channel = channelOf(r, type);
  const mortgage =
    type === "mortgage"
      ? {
          purpose: r.chance(0.6) ? ("owner_occupier" as const) : ("investor" as const),
          feature: pick(r, ["offset", "redraw", "none"] as const),
        }
      : null;
  return {
    id: `liab-${k + 1}`,
    type,
    lenderKey,
    feedForm: pick(r, lender.feed),
    unseen,
    cadence,
    amount: monthly / MONTHLY[cadence],
    round: r.chance(ROUND_DOLLARS),
    variable: isCard || r.chance(0.3),
    channel,
    fromSecond: r.chance(0.3),
    paidFromUnshared: r.chance(0.04),
    accountShared: shareable && r.chance(0.5),
    narrativeRef: r.chance(0.25) ? digits(r, r.int(6, 10)) : null,
    // A card's cue: by BPAY, the issuer's registered biller name; otherwise the narrative's words.
    cue: isCard
      ? channel === "BPAY"
        ? (reg.get(`lender:${type}:${lenderKey}`)?.cue ?? false)
        : !r.chance(0.35)
      : true,
    word: isCard
      ? pick(r, LOAN_WORDS.credit_card)
      : r.chance(0.7)
        ? pick(r, LOAN_WORDS[type])
        : null,
    balance: Math.round(monthly * r.int(4, 60)),
    limit: isCard ? r.int(2, 25) * 1000 : type === "bnpl" ? r.int(5, 30) * 100 : null,
    mortgage,
    declared: true,
    use: 1,
  };
}

function baseSpecs(seed: number, reg: Map<string, Biller>): Spec[] {
  const N = SET_V23_SIZE;
  const alloc = stream(seed, "v23:allocation");
  // Base traits by shuffled quotas, each independent of the others.
  const archetypes = shuffled(alloc, [
    ...Array<Archetype>(624).fill("salaried"),
    ...Array<Archetype>(66).fill("variable"),
    ...Array<Archetype>(66).fill("gig"),
    ...Array<Archetype>(24).fill("benefits"),
  ]);
  const histories = shuffled(alloc, [
    ...Array<1>(25).fill(1),
    ...Array.from({ length: N - 25 }, (_, i) => ([3, 6, 12] as const)[i % 3] ?? 6),
  ]);
  const statement = new Set(shuffled(alloc, [...Array(N).keys()]).slice(0, 45));
  const holders = Object.fromEntries(
    (Object.keys(HOLDERS) as LiabilityTypeV23[]).map((t) => [
      t,
      new Set(
        shuffled(stream(seed, `v23:holders:${t}`), [...Array(N).keys()]).slice(0, HOLDERS[t]),
      ),
    ]),
  ) as Record<LiabilityTypeV23, Set<number>>;
  const specs: Spec[] = [];
  for (let i = 0; i < N; i++) {
    const r = stream(seed, `v23:applicant:${i}`);
    const archetype = archetypes[i] ?? "salaried";
    const cadence =
      archetype === "gig"
        ? "weekly"
        : archetype === "benefits"
          ? "fortnightly"
          : pick(r, ["weekly", "fortnightly", "fortnightly", "fortnightly", "monthly"] as const);
    const bank = pick(r, BANKS);
    const second = r.chance(0.45)
      ? pick(
          r,
          BANKS.filter((b) => b.key !== bank.key),
        )
      : null;
    const gross = archetype === "salaried" ? r.int(55_000, 200_000) : 0;
    const netAnnual = gross > 0 ? netFromGross(gross, taxTable(TAX_YEAR)).net_annual : 0;
    const basePerPay =
      archetype === "salaried"
        ? round2(netAnnual / PAYS[cadence])
        : archetype === "variable"
          ? round2(logUniform(r, 500, 1600))
          : archetype === "gig"
            ? round2(logUniform(r, 300, 900))
            : round2(logUniform(r, 700, 1100));
    const payer =
      archetype === "gig"
        ? pick(r, GIG_PAYERS_V23)
        : archetype === "benefits"
          ? BENEFIT_PAYER
          : pick(r, EMPLOYERS_V23);
    const salaried = archetype === "salaried";
    const ev = stream(seed, `v23:pay-events:${i}`);
    const overtime =
      salaried && ev.chance(0.15)
        ? { share: ev.int(3, 7) / 10, amount: logUniform(ev, 120, 600) }
        : null;
    const bonus = salaried && ev.chance(0.15) ? logUniform(ev, 800, 8000) : null;
    const changeKind = salaried ? ev.next() : 1;
    const change =
      changeKind < 0.1
        ? {
            afterDays: ev.int(30, 300),
            gross: Math.round(gross * (1 + ev.int(5, 15) / 100)),
            payer: null,
            template: 0,
          }
        : changeKind < 0.18
          ? {
              afterDays: ev.int(30, 300),
              gross: ev.int(55_000, 200_000),
              payer: pick(
                ev,
                EMPLOYERS_V23.filter((e) => e !== payer),
              ),
              template: ev.int(0, PAY_TEMPLATES.length - 1),
            }
          : null;
    const types = (Object.keys(HOLDERS) as LiabilityTypeV23[]).filter((t) => holders[t].has(i));
    specs.push({
      index: i,
      archetype,
      history: histories[i] ?? 6,
      // The lender's request: its own stream, never derived from the history (SIG-39 ruling).
      request: stream(seed, `v23:request:${i}`).pick([3, 6, 6, 6, 12] as const),
      feed: statement.has(i) ? "uploaded_statement" : "cdr",
      bank,
      second,
      splitShare: second && archetype !== "benefits" && r.chance(0.5) ? r.int(20, 50) / 100 : 0,
      salaryUnshared: r.chance(0.03),
      externalAccounts: r.chance(0.03) ? r.int(1, 2) : 0,
      cadence,
      payer,
      gross,
      variability: archetype === "variable" ? 0.2 : archetype === "gig" ? 0.35 : 0,
      basePerPay,
      template: r.int(0, PAY_TEMPLATES.length - 1),
      overtime,
      bonus,
      change,
      liabilities: types.map((t, k) => liabilitySpec(seed, i, k, t, cadence, reg)),
      profile: pick(r, ["lean", "typical", "high"] as const),
      savingsMonthly: r.chance(0.45) ? logUniform(r, 100, 1000) : 0,
      gamblingWeekly: r.chance(0.05) ? r.int(20, 250) : 0,
      friends: r.chance(0.5),
      natural: false,
      drift: null,
    });
  }
  return specs;
}

/** True when the employer changes inside the applicant's window. */
const changesEmployer = (s: Spec) => {
  if (!s.change?.payer) return false;
  const { start, end } = windowOf(s.history);
  return start + s.change.afterDays <= end;
};

/** Posting day for a line dated `day`: the next banking day inside the window, else the last. */
const postDay = (day: number, start: number) => {
  const d = day > LAST ? onOrBefore(LAST) : onOrAfter(Math.max(day, start));
  return d > LAST ? onOrBefore(LAST) : d;
};
/**
 * An applicant's pay days, drift day, drift side and split start: from the same named streams
 * build() draws them from, so the drift pool can be restricted to applicants who will show a
 * drift line (V7), without a label changing any draw.
 */
function payPlan(seed: number, s: Spec) {
  const r = (k: string) => stream(seed, `v23:${s.index}:${k}`);
  const { start, end } = windowOf(s.history);
  const payDays = schedule(r("pay"), s.cadence, start, end).map((d) => postDay(d, start));
  const driftDay = start + Math.floor((end - start) * (0.4 + r("drift-day").next() * 0.2));
  const driftBefore = r("drift-side").chance(0.5);
  const splitFrom = r("split-from").int(1, 3);
  return { payDays, driftDay, driftBefore, splitFrom };
}

/** Applies the labels: each to entities drawn at random from their unlabelled twins. */
function applyLabels(seed: number, specs: Spec[]): void {
  // Undisclosed: the same share of every type's holders, at random.
  for (const type of Object.keys(HOLDERS) as LiabilityTypeV23[]) {
    const held = specs.flatMap((s) => s.liabilities.filter((l) => l.type === type));
    const order = shuffled(stream(seed, `v23:undisclosed:${type}`), held);
    order
      .slice(0, Math.round(UNDISCLOSED_SHARE * held.length))
      .forEach((l) => (l.declared = false));
  }
  // Natural declarations: drawn from applicants with two or more declared liabilities.
  const naturalPool = specs.filter((s) => s.liabilities.filter((l) => l.declared).length >= 2);
  for (const s of shuffled(stream(seed, "v23:natural"), naturalPool).slice(0, GROUP_SIZE.natural))
    s.natural = true;
  // Payer drift: across banks from salaried split pay; over time from the other salaried.
  // The pool excludes applicants who couldn't show a drift line (review 11 T3): salary paid to an
  // unshared account, a 1-month history, or no pay on both sides of the drift.
  const salaried = specs.filter(
    (s) => s.archetype === "salaried" && !changesEmployer(s) && !s.salaryUnshared && s.history >= 3,
  );
  const plan = new Map(salaried.map((s) => [s.index, payPlan(seed, s)]));
  const splitShows = (s: Spec) => {
    const p = plan.get(s.index);
    return p !== undefined && p.payDays.length > p.splitFrom;
  };
  const bothSides = (s: Spec) => {
    const p = plan.get(s.index);
    if (!p) return false;
    const drifted = p.payDays.filter((d) => d >= p.driftDay !== p.driftBefore).length;
    return drifted > 0 && drifted < p.payDays.length;
  };
  const driftRng = stream(seed, "v23:drift");
  const another = (t: number) =>
    (t + driftRng.int(1, PAY_TEMPLATES.length - 1)) % PAY_TEMPLATES.length;
  const ab = shuffled(
    driftRng,
    salaried.filter((s) => s.splitShare > 0 && s.second !== null && splitShows(s)),
  ).slice(0, GROUP_SIZE.drift_across_banks);
  for (const s of ab) s.drift = { mode: "across_banks", template: another(s.template) };
  const ot = shuffled(
    driftRng,
    salaried.filter((s) => !s.drift && bothSides(s)),
  ).slice(0, GROUP_SIZE.drift_over_time);
  for (const s of ot) s.drift = { mode: "over_time", template: another(s.template) };
}

// --- lines ------------------------------------------------------------------------------------------
type Entry = {
  account: string;
  day: number;
  cents: number;
  type: Transaction["type"];
  description: string;
  reference: string;
  merchant?: { name: string; mcc: string };
  biller?: { name: string; code: string; crn: string };
  /** Internal: what produced the line, for the truth. Never in the feed. */
  tag: string;
  /** Internal: a random order within the day. */
  key: number;
  /** The value day (a card purchase's own day); the posting day when absent. */
  value?: number;
};
type Account = {
  key: string;
  shared: boolean;
  category: string;
  product: string;
  display: string;
  bsb: string;
  limit?: number;
  closing: number;
};
type Built = {
  spec: Spec;
  entries: Entry[];
  accounts: Account[];
  start: number;
  end: number;
  truthParts: TruthParts;
};
type TruthParts = {
  items: GroundTruth["expenses"]["items"];
  commitments: (GroundTruth["commitments"][number] & { accountKey: string })[];
  bpay: {
    tag: string;
    kind: "bill" | "card_repayment" | "loan_repayment";
    item: string | null;
    name: string;
    code: string;
  }[];
  payEvents: { kind: "overtime" | "bonus" | "change"; tag: string; amount: number }[];
  payers: Map<string, { aliases: string[]; from: number; to: number }>;
  receivedCents: number;
  currentPerPay: number;
  currentPayer: string;
  incomeAccount: string;
  transfersToUnshared: number;
  /** The two descriptors of the applicant's drift pair (empty without drift). */
  driftDescriptors: string[];
};

function build(seed: number, s: Spec, reg: Map<string, Biller>): Built {
  const r = (k: string) => stream(seed, `v23:${s.index}:${k}`);
  const { start, end } = windowOf(s.history);
  const entries: Entry[] = [];
  const keyRng = r("order");
  const post = (day: number) => postDay(day, start);
  const add = (e: Omit<Entry, "key" | "day"> & { day: number }) => {
    const day = post(e.day);
    entries.push({
      ...e,
      day,
      ...(e.value !== undefined ? { value: Math.min(e.value, day) } : {}),
      key: keyRng.next(),
    });
  };
  /** A card purchase: its value day is any day; it posts 0 to 2 banking days later. */
  const purchaseDays = (g: Rng, raw: number) => {
    const value = Math.max(start, Math.min(raw, LAST));
    const u = g.next();
    const lag = u < 0.35 ? 0 : u < 0.8 ? 1 : 2;
    const posting = Math.min(lag === 0 ? onOrAfter(value) : addBanking(value, lag), LAST);
    return { day: posting, value: Math.min(value, posting) };
  };
  const accounts: Account[] = [
    {
      key: "evd",
      shared: true,
      category: "TRANS_AND_SAVINGS_ACCOUNTS",
      product: s.bank.everyday,
      display: s.bank.everyday,
      bsb: s.bank.bsb,
      closing: 0,
    },
  ];
  if (s.second)
    accounts.push({
      key: "evd2",
      shared: true,
      category: "TRANS_AND_SAVINGS_ACCOUNTS",
      product: s.second.everyday,
      display: s.second.everyday,
      bsb: s.second.bsb,
      closing: 0,
    });
  const bankOf = (acct: string) => (acct === "evd2" && s.second ? s.second : s.bank);
  const parts: TruthParts = {
    items: [],
    commitments: [],
    bpay: [],
    payEvents: [],
    payers: new Map(),
    receivedCents: 0,
    currentPerPay: s.basePerPay,
    currentPayer: s.payer,
    incomeAccount: s.salaryUnshared ? "sal" : "evd",
    transfersToUnshared: 0,
    driftDescriptors: [],
  };
  if (s.salaryUnshared)
    accounts.push({
      key: "sal",
      shared: false,
      category: "TRANS_AND_SAVINGS_ACCOUNTS",
      product: "Salary Account",
      display: "Salary",
      bsb: "062000",
      closing: 0,
    });

  // Income.
  const { payDays, driftDay, driftBefore, splitFrom } = payPlan(seed, s);
  const changeDay = s.change ? start + s.change.afterDays : Infinity;
  // The rewrite takes the pay before or after the change at random: which side is "the other
  // descriptor" is arbitrary, so the drifted lines aren't the recent ones by construction.
  const refs = new Map<string, (d: number) => string>();
  const refFor = (source: string) => {
    let f = refs.get(source);
    if (!f) refs.set(source, (f = creditRef(r(`ref:${source}`))));
    return f;
  };
  const render = (template: number, payer: string, acct: string) => {
    const t = PAY_TEMPLATES[template] ?? PAY_TEMPLATES[0];
    const base =
      s.archetype === "benefits"
        ? pick(r(`benefit:${acct}`), [
            "SERVICES AUSTRALIA CENTRELINK",
            "CENTRELINK",
            "DHS CENTRELINK PAYMENT",
          ])
        : s.archetype === "gig"
          ? `${payer} PAYOUT`
          : (t ?? ((e: string) => e))(payer);
    return `${bankOf(acct).credit_prefix}${base}`;
  };
  const otRng = r("overtime");
  const bonusAt =
    s.bonus !== null && payDays.length > 0 ? r("bonus").int(0, payDays.length - 1) : -1;
  const sweepNumber = digits(r("sweep"), 6);
  if (s.drift)
    parts.driftDescriptors = [
      render(s.template, s.payer, "evd"),
      render(s.drift.template, s.payer, s.drift.mode === "across_banks" ? "evd2" : "evd"),
    ];
  let changeLogged = false;
  let overtimeSeen = false;
  const jitter = r("pay-amount");
  for (const [k, day] of payDays.entries()) {
    const changed = day >= changeDay && s.change !== null;
    const payer = changed && s.change?.payer ? s.change.payer : s.payer;
    const template = changed && s.change?.payer ? s.change.template : s.template;
    const perPay =
      changed && s.change
        ? round2(netFromGross(s.change.gross, taxTable(TAX_YEAR)).net_annual / PAYS[s.cadence])
        : s.basePerPay;
    let c = cents(s.variability > 0 ? jitter.jitter(perPay, s.variability) : perPay);
    const events: { kind: "overtime" | "bonus" | "change"; amount: number }[] = [];
    if (
      s.overtime &&
      (otRng.chance(s.overtime.share) || (!overtimeSeen && k === payDays.length - 1))
    ) {
      const ot = cents(otRng.jitter(s.overtime.amount, 0.3));
      c += ot;
      overtimeSeen = true;
      events.push({ kind: "overtime", amount: ot / 100 });
    }
    if (k === bonusAt && s.bonus !== null) {
      c += cents(s.bonus);
      events.push({ kind: "bonus", amount: round2(s.bonus) });
    }
    if (changed && !changeLogged) {
      changeLogged = true;
      events.push({ kind: "change", amount: perPay });
      parts.currentPerPay = perPay;
      parts.currentPayer = payer;
    }
    const mainTemplate =
      s.drift?.mode === "over_time" && day >= driftDay !== driftBefore
        ? s.drift.template
        : template;
    const pieces: [string, number, number][] = [];
    // A pay split starts a few pays in (set up later), so the main account always holds more pay.
    if (s.splitShare > 0 && s.second && !s.salaryUnshared && k >= splitFrom) {
      const part = Math.round(c * s.splitShare);
      pieces.push(
        ["evd", c - part, mainTemplate],
        ["evd2", part, s.drift?.mode === "across_banks" ? s.drift.template : mainTemplate],
      );
    } else pieces.push([parts.incomeAccount, c, mainTemplate]);
    for (const [acct, amount, tpl] of pieces) {
      const description = render(tpl, payer, acct);
      const tag = `pay:${k}:${acct}${tpl !== template ? ":drift" : ""}`;
      add({
        account: acct,
        day,
        cents: amount,
        type: "TRANSFER_INCOMING",
        description,
        reference: refFor(`pay:${payer}`)(day),
        tag,
      });
      const seen = parts.payers.get(payer) ?? { aliases: [], from: day, to: day };
      if (!seen.aliases.includes(description)) seen.aliases.push(description);
      seen.to = day;
      parts.payers.set(payer, seen);
      if (acct === pieces[0]?.[0]) for (const e of events) parts.payEvents.push({ ...e, tag });
    }
    parts.receivedCents += c;
    if (s.salaryUnshared) {
      const moved = Math.round(c * 0.9);
      add({
        account: "evd",
        day: day + 1,
        cents: moved,
        type: "TRANSFER_INCOMING",
        description: `TRANSFER FROM 062-000 ${sweepNumber}`,
        reference: refFor("sweep")(day + 1),
        tag: "sweep",
      });
    }
  }
  if (s.friends) {
    const f = r("friends");
    const people = shuffled(f, PEOPLE).slice(0, f.int(1, 3));
    for (const day of schedule(f, "weekly", start, end)) {
      if (!f.chance(0.45)) continue;
      const who = pick(f, people);
      const style = pick(r(`friend-style:${who}`), ["TRANSFER FROM ", "OSKO ", ""]);
      // Transfers in from family, partners and flatmates: pay-sized, to either bank.
      const acct = s.second && f.chance(0.3) ? "evd2" : "evd";
      add({
        account: acct,
        day: day + f.int(0, 6),
        cents: shapeAmount(logUniform(f, 60, 4000), f.chance(0.02)),
        type: "TRANSFER_INCOMING",
        description: `${bankOf(acct).credit_prefix}${style}${who}`,
        reference: refFor(`friend:${who}`)(day),
        tag: "friend",
      });
    }
  }

  // Spending at merchants.
  const scale = { lean: 0.75, typical: 1, high: 1.4 }[s.profile];
  const [suburb, state] = pick(r("suburb"), SUBURBS_V23);
  const card = s.liabilities.find(
    (l) => l.type === "credit_card" && l.accountShared && !l.paidFromUnshared,
  );
  const shop = (
    name: string,
    group: "basic" | "discretionary",
    cadence: Cadence,
    mean: number,
    list: readonly { name: string; descriptor: string; mcc: string }[],
    acct = "evd",
  ) => {
    parts.items.push({ name, group, cadence, monthly_equivalent: round2(mean * MONTHLY[cadence]) });
    const g = r(`spend:${name}`);
    for (const raw of schedule(g, cadence, start, end)) {
      const m = pick(g, list);
      add({
        account: acct,
        ...purchaseDays(g, raw + g.int(0, 6)),
        cents: -cents(g.jitter(mean, 0.25)),
        type: "PAYMENT",
        description: `${m.descriptor} ${g.int(1000, 9999)} ${suburb} ${state} AUS`,
        reference: "",
        merchant: { name: m.name, mcc: m.mcc },
        tag: `pos:${name}`,
      });
    }
  };
  shop("groceries", "basic", "weekly", 170 * scale, GROCERY_V23);
  shop(
    "fuel",
    "basic",
    "fortnightly",
    75 * scale,
    FUEL_V23,
    s.second && r("fuel-acct").chance(0.5) ? "evd2" : "evd",
  );
  shop(
    "dining",
    "discretionary",
    "weekly",
    45 * scale,
    DINING_V23,
    card && r("dining-acct").chance(0.6) ? `card:${card.id}` : "evd",
  );
  for (const sub of SUBSCRIPTIONS_V23.filter((_, k) => r(`sub:${k}`).chance(0.5))) {
    parts.items.push({
      name: `subscription:${sub.name}`,
      group: "discretionary",
      cadence: "monthly",
      monthly_equivalent: sub.price,
    });
    for (const raw of schedule(r(`sub-days:${sub.name}`), "monthly", start, end))
      add({
        account: "evd",
        ...purchaseDays(r(`sub-post:${sub.name}:${raw}`), raw),
        cents: -cents(sub.price),
        type: "PAYMENT",
        description: `${sub.descriptor} SYDNEY AUS`,
        reference: "",
        merchant: { name: sub.name, mcc: sub.mcc },
        tag: `pos:${sub.name}`,
      });
  }
  if (s.gamblingWeekly > 0) {
    parts.items.push({
      name: "gambling",
      group: "discretionary",
      cadence: "weekly",
      monthly_equivalent: round2(s.gamblingWeekly * MONTHLY.weekly),
    });
    const g = r("gambling");
    for (const raw of schedule(g, "weekly", start, end)) {
      const m = pick(g, GAMBLING_V23);
      add({
        account: "evd",
        ...purchaseDays(g, raw + g.int(0, 6)),
        cents: -cents(g.jitter(s.gamblingWeekly, 0.5)),
        type: "PAYMENT",
        description: `${m.descriptor} MELBOURNE AUS`,
        reference: "",
        merchant: { name: m.name, mcc: m.mcc },
        tag: "pos:gambling",
      });
    }
  }

  // Recurring obligations: bills, rent and liabilities, all by one process.
  type Obligation = {
    tag: string;
    acct: string;
    channel: Channel;
    cadence: Cadence;
    amount: number;
    round: boolean;
    variable: boolean;
    /** The registered biller (code and name) it pays by BPAY. */
    biller: string;
    narrativeRef: string | null;
    ref: string;
    kind: "bill" | "card_repayment" | "loan_repayment";
    item: string | null;
    payment: string;
  };
  const emit = (o: Obligation, days: number[], rng: Rng): string[] => {
    const tags: string[] = [];
    const bank = bankOf(o.acct);
    const registered = reg.get(o.biller);
    if (!registered) throw new Error(`no biller ${o.biller}`);
    days.forEach((day, k) => {
      const dollars = o.variable
        ? rng.jitter(o.amount, o.kind === "card_repayment" ? 0.4 : 0.1)
        : o.amount;
      const c = -shapeAmount(dollars, o.round);
      const tag = `${o.tag}:${k}`;
      const narrativeName = o.narrativeRef ? `${o.payment} ${o.narrativeRef}` : o.payment;
      if (o.channel === "BPAY") {
        // One registered name a code; the bank shows it in full or cut to 20 characters, by HMAC
        // of the line, independent of every label.
        const full = registered.name;
        const name =
          hu(seed, `biller-render|${s.index}|${tag}`) < 0.5 ? full : full.slice(0, 20).trimEnd();
        const code = registered.code;
        add({
          account: o.acct,
          day,
          cents: c,
          type: "PAYMENT",
          description: `BPAY ${name}${o.narrativeRef ? ` ${o.narrativeRef}` : ""}`,
          reference: o.ref,
          biller: { name, code, crn: o.ref },
          tag,
        });
        parts.bpay.push({ tag, kind: o.kind, item: o.item, name, code });
      } else if (o.channel === "DIRECT_DEBIT")
        add({
          account: o.acct,
          day,
          cents: c,
          type: "DIRECT_DEBIT",
          description: `${bank.dd_prefix}${narrativeName}`,
          reference: o.ref,
          tag,
        });
      else
        add({
          account: o.acct,
          day,
          cents: c,
          type: "PAYMENT",
          description: `${pick(r(`pay-style:${o.tag}`), ["TRANSFER TO ", "PAYMENT TO ", "OSKO "])}${narrativeName}`,
          reference: o.ref,
          tag,
        });
      tags.push(tag);
    });
    return tags;
  };
  const owner = s.liabilities.some((l) => l.mortgage?.purpose === "owner_occupier");
  for (const bill of BILLS) {
    const g = r(`bill:${bill.kind}`);
    const has = bill.kind === "rent" ? !owner && g.chance(0.55) : g.chance(bill.p);
    if (!has) continue;
    const payee = pick(g, bill.payees);
    const cadence = pick(g, bill.cadences);
    const monthly = logUniform(g, bill.monthly[0], bill.monthly[1]);
    const o: Obligation = {
      tag: `bill:${bill.kind}`,
      acct: s.second && g.chance(0.3) ? "evd2" : "evd",
      channel: channelOf(g, "bill"),
      cadence,
      amount: monthly / MONTHLY[cadence],
      round: g.chance(ROUND_DOLLARS),
      variable: g.chance(0.3),
      biller: `bill:${bill.kind}:${payee.short}`,
      narrativeRef: g.chance(0.25) ? digits(g, g.int(6, 10)) : null,
      ref: "",
      kind: "bill",
      item: `commitment:${bill.kind}`,
      payment: g.chance(0.5) ? payee.short : payee.legal,
    };
    o.ref = o.channel === "BPAY" ? digits(g, g.int(6, 12)) : debitRef(g);
    const days = schedule(g, cadence, start, end);
    emit(o, days, g);
    parts.items.push({
      name: `commitment:${bill.kind}`,
      group: bill.group,
      cadence,
      monthly_equivalent: round2(monthly),
    });
    parts.commitments.push({
      kind: bill.kind,
      cadence,
      amount: round2(o.amount),
      monthly_equivalent: round2(monthly),
      occurrences_in_window: days.length,
      account_id: o.acct,
      accountKey: o.acct,
    });
  }
  const liabilityTags = new Map<string, string[]>();
  for (const l of s.liabilities) {
    const g = r(`liability:${l.id}`);
    const lender = LENDERS[l.type][l.lenderKey];
    if (!lender) throw new Error(l.lenderKey);
    const acct = l.paidFromUnshared ? `unsh:${l.id}` : l.fromSecond && s.second ? "evd2" : "evd";
    if (l.paidFromUnshared)
      accounts.push({
        key: acct,
        shared: false,
        category: "TRANS_AND_SAVINGS_ACCOUNTS",
        product: "Other Bank Account",
        display: "Other",
        bsb: "732000",
        closing: 0,
      });
    const payment =
      l.type === "credit_card"
        ? l.cue
          ? `${l.feedForm} ${l.word ?? "CREDIT CARD"}`
          : lender.legal
        : `${l.feedForm}${l.word ? ` ${l.word}` : ""}`;
    const kind =
      l.type === "credit_card" ? ("card_repayment" as const) : ("loan_repayment" as const);
    const o: Obligation = {
      tag: `liab:${l.id}`,
      acct,
      channel: l.channel,
      cadence: l.cadence,
      amount: l.amount,
      round: l.round,
      variable: l.variable,
      biller: `lender:${l.type}:${l.lenderKey}`,
      narrativeRef: l.narrativeRef,
      ref: "",
      kind,
      item: null,
      payment,
    };
    o.ref = o.channel === "BPAY" ? digits(g, g.int(6, 12)) : debitRef(g);
    // A wage advance is drawn in some pay cycles, not every one (review 11, realism).
    const useRng = r(`advance-use:${l.id}`);
    const used = l.type === "wage_advance" ? payDays.filter(() => useRng.chance(0.55)) : [];
    const advanceDays = used.length >= 2 ? used : payDays.slice(0, 2);
    const days = l.type === "wage_advance" ? advanceDays : schedule(g, l.cadence, start, end);
    if (l.type === "wage_advance") l.use = payDays.length > 0 ? days.length / payDays.length : 1;
    const tags = emit(o, days, g);
    liabilityTags.set(l.id, l.paidFromUnshared ? [] : tags);
    if (l.type === "wage_advance")
      for (const day of days)
        add({
          account: "evd",
          day: day - 3,
          cents: shapeAmount(l.amount / 1.05, l.round),
          type: "TRANSFER_INCOMING",
          description: `${s.bank.credit_prefix}${l.feedForm} ADVANCE`,
          reference: refFor(`advance:${l.id}`)(day),
          tag: `advance:${l.id}`,
        });
    if (l.type === "sacc")
      add({
        account: "evd",
        day: start + g.int(0, 10),
        cents: shapeAmount(l.amount * g.int(6, 12), l.round),
        type: "TRANSFER_INCOMING",
        description: `${s.bank.credit_prefix}${l.feedForm} LOAN ADVANCE`,
        reference: refFor(`advance:${l.id}`)(start),
        tag: `advance:${l.id}`,
      });
    if (l.accountShared) {
      const isCard = l.type === "credit_card";
      const key = isCard ? `card:${l.id}` : `loan:${l.id}`;
      accounts.push({
        key,
        shared: true,
        category: isCard
          ? "CRED_AND_CHRG_CARDS"
          : l.type === "mortgage"
            ? "RESIDENTIAL_MORTGAGES"
            : "PERS_LOANS",
        product: isCard
          ? `${productBrand(l.feedForm)} Credit Card`
          : `${productBrand(l.feedForm)} ${l.type === "mortgage" ? "Home Loan" : l.type === "car_loan" ? "Car Loan" : "Personal Loan"}`,
        display: isCard ? "Credit Card" : l.type === "mortgage" ? "Home Loan" : "Loan",
        bsb: s.bank.bsb,
        ...(l.limit ? { limit: l.limit } : {}),
        closing: -cents(l.balance),
      });
      for (const tag of tags) {
        const paid = entries.find((e) => e.tag === tag);
        if (paid)
          add({
            account: key,
            day: paid.day,
            cents: -paid.cents,
            type: "TRANSFER_INCOMING",
            description: isCard ? "PAYMENT RECEIVED THANK YOU" : "REPAYMENT RECEIVED",
            reference: "",
            tag: `received:${l.id}`,
          });
      }
      // Interest on a loan, monthly, so its balance declines by repayments less interest.
      if (!isCard) {
        const ig = r(`interest:${l.id}`);
        const rate = { mortgage: 0.062, car_loan: 0.085 }[l.type as string] ?? 0.115;
        const monthlyInterest = (l.balance * rate * (0.9 + ig.next() * 0.2)) / 12;
        for (const day of schedule(ig, "monthly", start, end))
          add({
            account: key,
            day,
            cents: -cents(monthlyInterest),
            type: "INTEREST_CHARGED" as Transaction["type"],
            description: "INTEREST CHARGED",
            reference: "",
            tag: `interest:${l.id}`,
          });
      }
    }
    if (l.mortgage?.feature === "offset")
      accounts.push({
        key: `off:${l.id}`,
        shared: true,
        category: "TRANS_AND_SAVINGS_ACCOUNTS",
        product: "Mortgage Offset",
        display: "Offset",
        bsb: s.bank.bsb,
        closing: cents(logUniform(g, 2000, 80000)),
      });
  }

  // Other savings and goal accounts in the grant, unrelated to anything else the applicant holds.
  for (let x = 0; x < 2; x++) {
    const g = r(`goal:${x}`);
    if (!g.chance(0.3)) continue;
    const bank = s.second && g.chance(0.4) ? s.second : s.bank;
    const key = `goal${x}`;
    accounts.push({
      key,
      shared: true,
      category: "TRANS_AND_SAVINGS_ACCOUNTS",
      product: pick(g, ["Goal Saver", "Bonus Saver", "Holiday Account", "Kids Saver"]),
      display: pick(g, ["Goal Saver", "Bonus Saver", "Holiday", "Savings"]),
      bsb: bank.bsb,
      closing: 0,
    });
    const from = bank === s.bank ? "evd" : "evd2";
    for (const day of schedule(g, "monthly", start, end)) {
      if (!g.chance(0.5)) continue;
      const c = shapeAmount(logUniform(g, 20, 600), g.chance(ROUND_DOLLARS));
      add({
        account: from,
        day,
        cents: -c,
        type: "TRANSFER_OUTGOING",
        description: "TRANSFER TO OWN ACCOUNT",
        reference: "",
        tag: "own",
      });
      add({
        account: key,
        day,
        cents: c,
        type: "TRANSFER_INCOMING",
        description: "TRANSFER FROM OWN ACCOUNT",
        reference: "",
        tag: "own",
      });
    }
  }

  // Savings, transfers between the applicant's own banks, and transfers to unshared accounts.
  if (s.savingsMonthly > 0) {
    accounts.push({
      key: "sav",
      shared: true,
      category: "TRANS_AND_SAVINGS_ACCOUNTS",
      product: s.bank.savings,
      display: s.bank.savings,
      bsb: s.bank.bsb,
      closing: 0,
    });
    const g = r("savings");
    for (const day of schedule(g, "monthly", start, end)) {
      const c = shapeAmount(s.savingsMonthly, g.chance(ROUND_DOLLARS));
      add({
        account: "evd",
        day,
        cents: -c,
        type: "TRANSFER_OUTGOING",
        description: "INTERNET TRANSFER SAVINGS",
        reference: "",
        tag: "own",
      });
      add({
        account: "sav",
        day,
        cents: c,
        type: "TRANSFER_INCOMING",
        description: "INTERNET TRANSFER FROM EVERYDAY",
        reference: "",
        tag: "own",
      });
    }
  }
  if (s.second) {
    const g = r("between-banks");
    for (const day of schedule(g, "monthly", start, end)) {
      if (!g.chance(0.4)) continue;
      const c = shapeAmount(logUniform(g, 50, 800), g.chance(ROUND_DOLLARS));
      const [from, to] = g.chance(0.5) ? ["evd", "evd2"] : ["evd2", "evd"];
      add({
        account: from ?? "evd",
        day,
        cents: -c,
        type: "TRANSFER_OUTGOING",
        description: `TRANSFER TO OWN ACCOUNT`,
        reference: "",
        tag: "own",
      });
      add({
        account: to ?? "evd2",
        day,
        cents: c,
        type: "TRANSFER_INCOMING",
        description: `TRANSFER FROM OWN ACCOUNT`,
        reference: "",
        tag: "own",
      });
    }
  }
  for (let x = 0; x < s.externalAccounts; x++) {
    accounts.push({
      key: `ext${x}`,
      shared: false,
      category: "TRANS_AND_SAVINGS_ACCOUNTS",
      product: "Other Bank Account",
      display: `External ${x + 1}`,
      bsb: "732000",
      closing: 0,
    });
    const g = r(`external:${x}`);
    const number = digits(g, 6);
    for (const day of schedule(g, "monthly", start, end)) {
      add({
        account: "evd",
        day,
        cents: -shapeAmount(logUniform(g, 150, 700), g.chance(ROUND_DOLLARS)),
        type: "TRANSFER_OUTGOING",
        description: `TRANSFER TO 732-000 ${number}`,
        reference: "",
        tag: "external",
      });
      parts.transfersToUnshared++;
    }
  }
  return { spec: s, entries, accounts, start, end, truthParts: parts };
}

// --- fees and dishonours (after every applicant's lines exist) ------------------------------------
type Dishonour = { debitTag: string; returnTag: string; feeTag: string | null; day: number };
/**
 * The bank's event fee follows the debit that caused it by one process for both kinds: the
 * debit, 1 to 3 banking days, then the fee the next banking day. An overdrawn fee follows a debit
 * that took the account below zero (any debit), half within 90 days and half earlier, as
 * dishonours fall; a dishonour fee follows its bounced debit's return.
 */
const feeDayAfter = (rng: Rng, debitDay: number) =>
  addBanking(addBanking(debitDay, rng.int(1, 3)), 1);
function overdrawnFees(seed: number, b: Built): void {
  const g = stream(seed, `v23:${b.spec.index}:overdrawn`);
  const bank = b.spec.bank;
  if (bank.event_fee <= 0 || !g.chance(0.35)) return;
  const n = g.int(1, 4);
  const debits = b.entries.filter((e) => e.account === "evd" && e.cents < 0);
  for (let k = 0; k < n; k++) {
    const recent = g.chance(0.5);
    const near = debits.filter((e) => b.end - e.day <= 90 === recent);
    const trigger = near.length > 0 ? pick(g, near) : debits.length > 0 ? pick(g, debits) : null;
    if (!trigger) return;
    const day = feeDayAfter(g, trigger.day);
    if (day > LAST) continue;
    b.entries.push({
      account: "evd",
      day,
      cents: -cents(bank.event_fee),
      type: "FEE",
      description: bank.overdrawn_narrative,
      reference: "",
      tag: "fee:overdrawn",
      key: g.next(),
    });
  }
}
function bounce(seed: number, b: Built, tag: string, k: number): Dishonour | null {
  const debit = b.entries.find((e) => e.tag === tag);
  if (!debit) return null;
  const g = stream(seed, `v23:${b.spec.index}:bounce:${k}`);
  const bank = debit.account === "evd2" && b.spec.second ? b.spec.second : b.spec.bank;
  const returned = addBanking(debit.day, g.int(1, 3));
  if (returned > LAST) return null;
  const payee = debit.description
    .replace(/^(DD |DIRECT DEBIT )/, "")
    .split(" ")
    .slice(0, 3)
    .join(" ");
  const returnTag = `return:${k}`;
  b.entries.push({
    account: debit.account,
    day: returned,
    cents: -debit.cents,
    type: "TRANSFER_INCOMING",
    description: `${bank.return_narrative} ${payee}`,
    reference: debit.reference,
    tag: returnTag,
    key: g.next(),
  });
  let feeTag: string | null = null;
  if (bank.event_fee > 0) {
    const feeDay = addBanking(returned, 1);
    if (feeDay <= LAST) {
      feeTag = `fee:dishonour:${k}`;
      b.entries.push({
        account: debit.account,
        day: feeDay,
        cents: -cents(bank.event_fee),
        type: "FEE",
        description: bank.dishonour_narrative,
        reference: "",
        tag: feeTag,
        key: g.next(),
      });
    }
  }
  return { debitTag: tag, returnTag, feeTag, day: debit.day };
}
function dishonours(seed: number, built: Built[]): Map<number, Dishonour[]> {
  const out = new Map<number, Dishonour[]>();
  const dds = (b: Built, recent: boolean) =>
    b.entries.filter(
      (e) =>
        e.type === "DIRECT_DEBIT" &&
        e.cents < 0 &&
        (e.account === "evd" || e.account === "evd2") &&
        b.end - e.day <= 90 === recent &&
        addBanking(e.day, 3) <= LAST,
    );
  const pool = built.filter((b) => b.entries.some((e) => e.type === "DIRECT_DEBIT" && e.cents < 0));
  const g = stream(seed, "v23:dishonours");
  const chosen = shuffled(g, pool).slice(0, 3 * GROUP_SIZE.dishonour);
  const oldCapable = chosen.filter((b) => dds(b, false).length > 0);
  const oldOnly = new Set(
    shuffled(g, oldCapable)
      .slice(0, GROUP_SIZE.dishonour)
      .map((b) => b.spec.index),
  );
  let twoPlus = 0;
  for (const b of chosen) {
    const r = stream(seed, `v23:${b.spec.index}:dishonour-plan`);
    const recent = shuffled(r, dds(b, true));
    const old = shuffled(r, dds(b, false));
    let picks: Entry[];
    if (oldOnly.has(b.spec.index)) picks = old.slice(0, r.int(1, 3));
    else if (twoPlus < GROUP_SIZE.dishonour && recent.length >= 2) {
      twoPlus++;
      picks = [...recent.slice(0, r.int(2, 4)), ...old.slice(0, r.int(0, 2))];
    } else picks = [...recent.slice(0, 1), ...old.slice(0, r.int(0, 2))];
    const list = picks.flatMap((e, k) => bounce(seed, b, e.tag, k) ?? []);
    if (list.length > 0) out.set(b.spec.index, list);
  }
  return out;
}
/** Monthly account fees: charged in every month but those whose credits reach the waiver. */
function accountFees(seed: number, b: Built): void {
  for (const acct of ["evd", "evd2"] as const) {
    const bank = acct === "evd2" ? b.spec.second : b.spec.bank;
    if (!bank || bank.monthly_fee <= 0 || !b.accounts.some((a) => a.key === acct)) continue;
    const months = new Map<string, { last: number; credits: number }>();
    for (let d = b.start; d <= LAST; d++) {
      const m = toIso(d).slice(0, 7);
      const cur = months.get(m) ?? { last: d, credits: 0 };
      if (banking(d)) cur.last = d;
      months.set(m, cur);
    }
    for (const e of b.entries)
      if (e.account === acct && e.cents > 0) {
        const m = months.get(toIso(e.day).slice(0, 7));
        if (m) m.credits += e.cents;
      }
    // Waived in a month whose credits reach the bank's threshold, or whose balance condition is
    // met (not modelled: a month drawn with chance 0.15, the same for every applicant).
    const w = stream(seed, `v23:${b.spec.index}:waiver:${acct}`);
    const charged = [...months.values()].filter(
      (m) => !w.chance(0.15) && m.credits < cents(bank.waive_at) && m.last >= b.start,
    );
    // A fee shown in too few months to be a monthly series isn't charged at all, so a monthly fee
    // is always a series (a waived month is a gap in it).
    if (charged.length < Math.max(3, Math.ceil(months.size / 2))) continue;
    const g = stream(seed, `v23:${b.spec.index}:fee:${acct}`);
    for (const m of charged)
      b.entries.push({
        account: acct,
        day: m.last,
        cents: -cents(bank.monthly_fee),
        type: "FEE",
        description: bank.monthly_fee_narrative,
        reference: "",
        tag: "fee:monthly",
        key: g.next(),
      });
  }
}

// --- assembly ---------------------------------------------------------------------------------------
const hmacHex = (seed: number, text: string) =>
  createHmac("sha256", String(seed)).update(text).digest("hex");
const letters = (seed: number, text: string) =>
  [...createHmac("sha256", String(seed)).update(text).digest()]
    .slice(0, 14)
    .map((x) => String.fromCharCode(97 + (x % 26)))
    .join("");
const BASE = "https://openfeed.invalid/v1/banking/accounts";

export function generateSetV23(seed: number = SET_V23_SEED): GeneratedApplicant[] {
  const reg = billerRegistry(seed);
  const specs = baseSpecs(seed, reg);
  applyLabels(seed, specs);
  const built = specs.map((s) => build(seed, s, reg));
  for (const b of built) overdrawnFees(seed, b);
  const bounced = dishonours(seed, built);
  for (const b of built) accountFees(seed, b);
  // Output order: a seeded shuffle; applicant k's ID is HMAC(seed, "applicant|k").
  const order = shuffled(stream(seed, "v23:output-order"), built);
  // (lender, alias) pair counts for V9's cap, shared across applicants in output order.
  const pairs = new Map<string, number>();
  return order.map((b, k) => assemble(seed, b, k, bounced.get(b.spec.index) ?? [], pairs));
}

function assemble(
  seed: number,
  b: Built,
  k: number,
  dish: Dishonour[],
  pairs: Map<string, number>,
): GeneratedApplicant {
  const s = b.spec;
  const id = `syn-v23-${hmacHex(seed, `applicant|${k}`).slice(0, 16)}`;
  const accOrder = shuffled(stream(seed, `v23:${s.index}:account-order`), b.accounts);
  const accountId = new Map(accOrder.map((a, j) => [a.key, letters(seed, `account|${k}|${j}`)]));
  const shared = accOrder.filter((a) => a.shared);
  const feedEntries = b.entries
    .filter((e) => shared.some((a) => a.key === e.account))
    .sort((x, y) => x.day - y.day || x.key - y.key);
  const txId = new Map<Entry, string>();
  feedEntries.forEach((e, n) => txId.set(e, letters(seed, `txn|${k}|${n}`)));
  const idsOfTag = (pred: (tag: string) => boolean) =>
    feedEntries.filter((e) => pred(e.tag)).map((e) => txId.get(e) ?? "");
  const idOfTag = (tag: string) => {
    const e = feedEntries.find((x) => x.tag === tag);
    return e ? (txId.get(e) ?? null) : null;
  };
  const cdr = s.feed === "cdr";
  const balRng = stream(seed, `v23:${s.index}:balances`);
  const accounts: FeedAccount[] = shared.map((acc) => {
    const aid = accountId.get(acc.key) ?? "";
    const own = feedEntries.filter((e) => e.account === acc.key);
    const transactions: Transaction[] = own.map((e) =>
      toTransaction(e, aid, txId.get(e) ?? "", cdr),
    );
    // A transaction account's closing balance reconciles with its lines: an opening balance that
    // keeps it at or above a cushion throughout, plus every line. Loans and cards close at the
    // liability's balance (the lines imply its opening).
    let closing = acc.closing;
    if (acc.category === "TRANS_AND_SAVINGS_ACCOUNTS" && own.length > 0) {
      let run = 0;
      let low = 0;
      for (const e of own) {
        run += e.cents;
        low = Math.min(low, run);
      }
      closing = cents(logUniform(balRng, 50, 15000)) - low + run;
    } else if (acc.category === "TRANS_AND_SAVINGS_ACCOUNTS" && acc.closing === 0)
      closing = cents(logUniform(balRng, 50, 15000));
    const firstDay = Math.min(b.start, ...own.map((e) => e.value ?? e.day));
    const ageDays =
      acc.category === "RESIDENTIAL_MORTGAGES"
        ? balRng.int(180, 365 * 20)
        : acc.category === "PERS_LOANS"
          ? balRng.int(30, 365 * 5)
          : balRng.int(30, 365 * 15);
    const account = {
      accountId: aid,
      creationDate: toIso(firstDay - ageDays),
      displayName: acc.display,
      openStatus: "OPEN",
      isOwned: true,
      accountOwnership: "ONE_PARTY",
      maskedNumber: `xxxx xxxx xxxx ${balRng.int(1000, 9999)}`,
      productCategory: acc.category,
      productName: acc.product,
    };
    const balance = {
      accountId: aid,
      currentBalance: money(closing),
      availableBalance: money(acc.limit ? cents(acc.limit) + closing : Math.max(closing, 0)),
      ...(acc.limit ? { creditLimit: money(cents(acc.limit)) } : {}),
      currency: "AUD",
    };
    return {
      account,
      detail: {
        data: { ...account, bsb: acc.bsb, accountNumber: `1${balRng.int(1000000, 9999999)}` },
        links: { self: `${BASE}/${aid}` },
        meta: {},
      },
      balance: { data: balance, links: { self: `${BASE}/${aid}/balance` }, meta: {} },
      transactions,
      transactionList: {
        data: { transactions },
        links: { self: `${BASE}/${aid}/transactions` },
        meta: { totalRecords: transactions.length, totalPages: 1 },
      },
    };
  });

  // Truth.
  const p = b.truthParts;
  const windowMonths = (b.end - b.start + 1) / (365.25 / 12);
  const streamMonthly = round2(p.currentPerPay * MONTHLY[s.cadence]);
  const items = p.items;
  const group = (gname: "committed" | "basic" | "discretionary") =>
    round2(items.filter((i) => i.group === gname).reduce((x, i) => x + i.monthly_equivalent, 0));
  const committed = group("committed");
  const basic = group("basic");
  const discretionary = group("discretionary");
  const total = round2(committed + basic + discretionary);
  const liabilityItems = s.liabilities.map((l) => ({
    id: l.id,
    type: l.type,
    provider: l.feedForm,
    declared: l.declared,
    account_shared: l.accountShared,
    limit: l.limit,
    balance: l.balance,
    repayment: round2(l.amount),
    cadence: l.cadence,
    monthly_commitment: round2(l.amount * MONTHLY[l.cadence] * l.use),
  }));
  const repayments = round2(liabilityItems.reduce((x, l) => x + l.monthly_commitment, 0));
  const declRng = stream(seed, `v23:${s.index}:declarations`);
  const declared = shuffled(
    declRng,
    s.liabilities.filter((l) => l.declared),
  ).map((l) => {
    const different = declRng.chance(s.natural ? 0.9 : 0.3);
    const declId = `${s.index}:${l.id}`;
    const d = declaredName(seed, declId, l.type, l.lenderKey, l.feedForm, different, pairs);
    return {
      l,
      name: d.name,
      declaration: { different: differs(d.name, l.feedForm), descriptor: d.descriptor },
      amount: declaredAmount(seed, declId, round2(l.amount * MONTHLY[l.cadence] * l.use)),
    };
  });
  const declaredAs = new Map(declared.map((d) => [d.l.id, d.name]));
  const declarationOf = new Map(declared.map((d) => [d.l.id, d.declaration]));
  const dishonourEvents = dish.map((d) => {
    const daysAgo = b.end - d.day;
    return {
      date: toIso(d.day),
      days_ago: daysAgo,
      recent: daysAgo <= 90,
      transaction_id: idOfTag(d.feeTag ?? d.returnTag) ?? "",
    };
  });
  const changed = s.change !== null && b.start + s.change.afterDays <= b.end;
  const tax = s.gross > 0 ? netFromGross(s.gross, taxTable(TAX_YEAR)) : null;
  const payIds = idsOfTag((t) => t.startsWith("pay:"));
  const driftIds = idsOfTag((t) => t.startsWith("pay:") && t.endsWith(":drift"));
  // Both descriptors of the pair: every credit under either (review 11 L5).
  // As the feed shows them: a statement upper-cases and cuts narratives to 40 characters.
  const shown = (d: string) => (cdr ? d : d.toUpperCase().slice(0, 40));
  const descriptors = p.driftDescriptors.map(shown);
  const pairIds = feedEntries
    .filter((e) => e.cents > 0 && descriptors.includes(shown(e.description)))
    .map((e) => txId.get(e) ?? "");
  const tags = tagsOf(s, b, dish, changed, p);
  const truth: GroundTruth = {
    schema_version: GROUND_TRUTH_SCHEMA_VERSION_V23,
    generator_version: GENERATOR_VERSION_V23,
    applicant_id: id,
    seed,
    tags,
    archetype: s.archetype,
    feed_type: s.feed,
    history: { months: s.history, start_date: toIso(b.start), end_date: toIso(b.end) },
    coverage: {
      salary_account_shared: !s.salaryUnshared,
      unshared_transfer_accounts: s.externalAccounts,
      transfers_to_unshared_count: p.transfersToUnshared,
      shared_account_ids: accOrder.filter((a) => a.shared).map((a) => accountId.get(a.key) ?? ""),
      unshared_account_ids: accOrder
        .filter((a) => !a.shared)
        .map((a) => accountId.get(a.key) ?? ""),
    },
    income: {
      net_monthly: streamMonthly,
      gross_annual: s.gross,
      streams: [
        {
          type: (
            { salaried: "salary", variable: "variable", gig: "gig", benefits: "benefit" } as const
          )[s.archetype],
          payer: p.currentPayer,
          cadence: s.cadence,
          net_per_pay: p.currentPerPay,
          variability: s.variability,
          net_monthly: streamMonthly,
          account_id: accountId.get(p.incomeAccount) ?? "",
          account_shared: !s.salaryUnshared,
        },
      ],
    },
    expenses: {
      committed_monthly: committed,
      basic_monthly: basic,
      discretionary_monthly: discretionary,
      total_monthly: total,
      items,
    },
    commitments: p.commitments.map(({ accountKey, ...c }) => ({
      ...c,
      account_id: accountId.get(accountKey) ?? "",
    })),
    liabilities: { repayments_monthly: repayments, items: liabilityItems },
    behaviours: {
      gambling_monthly: s.gamblingWeekly > 0 ? round2(s.gamblingWeekly * MONTHLY.weekly) : null,
      dishonours: dish.length,
      positive: {
        rent_on_time: items.some((i) => i.name === "commitment:rent"),
        cards_cleared_in_full: false,
        savings_growing: s.savingsMonthly > 0,
        savings_monthly: round2(s.savingsMonthly),
        no_dishonours: dish.length === 0,
      },
    },
    surplus_monthly: round2(streamMonthly - total - repayments),
  };
  const v2 = {
    request: { lookback_months: s.request },
    tax: tax && changed && s.change ? { ...tax, gross_annual_after_change: s.change.gross } : tax,
    payers: [...p.payers.entries()].map(([payer, x]) => ({
      payer,
      aliases: x.aliases,
      from: toIso(x.from),
      to: toIso(x.to),
    })),
    pay_events: p.payEvents.map((e) => {
      const entry = feedEntries.find((x) => x.tag === e.tag);
      const tagDay = entry?.day ?? b.entries.find((x) => x.tag === e.tag)?.day ?? b.start;
      return {
        kind: e.kind,
        date: toIso(tagDay),
        transaction_id: entry ? (txId.get(entry) ?? null) : null,
        amount: round2(e.amount),
      };
    }),
    received_net_monthly: round2(p.receivedCents / 100 / windowMonths),
    dishonour_events: dishonourEvents,
    bpay: p.bpay.map((x) => ({
      transaction_id: idOfTag(x.tag),
      biller_name: x.name,
      biller_code: x.code,
      kind: x.kind,
      item: x.item,
      true_group: x.kind === "bill" ? ("committed" as const) : null,
      true_category:
        x.kind === "card_repayment"
          ? "transfer"
          : x.kind === "loan_repayment"
            ? "loan_repayment"
            : null,
    })),
    liabilities: s.liabilities.map((l) => ({
      id: l.id,
      lender: l.feedForm,
      lender_id: `${l.type}:${l.lenderKey}`,
      declared_as: declaredAs.get(l.id) ?? null,
      declaration: declarationOf.get(l.id) ?? null,
      unseen_lender: l.unseen,
      paid_from_account_id:
        accountId.get(
          l.paidFromUnshared ? `unsh:${l.id}` : l.fromSecond && s.second ? "evd2" : "evd",
        ) ?? "",
      paid_from_shared: !l.paidFromUnshared,
      repayment_transaction_ids: l.paidFromUnshared
        ? []
        : idsOfTag((t) => t.startsWith(`liab:${l.id}:`)),
      narrative_ref: l.narrativeRef,
      biller_cue: l.cue,
      mortgage: l.mortgage,
      account_id: l.accountShared
        ? (accountId.get(l.type === "credit_card" ? `card:${l.id}` : `loan:${l.id}`) ?? null)
        : null,
      repayment_channel: l.channel,
    })),
    pay_transaction_ids: payIds,
    drift: s.drift
      ? {
          mode: s.drift.mode,
          alias: driftAlias(s),
          transaction_ids: driftIds,
          descriptors,
          pair_transaction_ids: pairIds,
        }
      : null,
    dishonour_lines: dish.map((d) => ({
      debit: idOfTag(d.debitTag) ?? "",
      returned: idOfTag(d.returnTag) ?? "",
      fee: d.feeTag ? idOfTag(d.feeTag) : null,
    })),
    declared_link: declared.map((d) => d.l.id),
  };
  (truth as unknown as { v2: unknown }).v2 = v2;
  return {
    truth,
    application: {
      stated_gross_annual: s.gross,
      declared_liabilities: declared.map((d) => ({
        type: d.l.type,
        provider: d.name,
        repayment_monthly: d.amount,
      })),
    },
    feed: {
      accountList: {
        data: { accounts: accounts.map((a) => a.account) },
        links: { self: BASE },
        meta: { totalRecords: accounts.length, totalPages: 1 },
      },
      accounts,
    },
  };
}

const driftAlias = (s: Spec) => {
  if (!s.drift) return "";
  const bank = s.drift.mode === "across_banks" && s.second ? s.second : s.bank;
  return `${bank.credit_prefix}${(PAY_TEMPLATES[s.drift.template] ?? ((e: string) => e))(s.payer)}`;
};

function tagsOf(s: Spec, b: Built, dish: Dishonour[], changed: boolean, p: TruthParts): string[] {
  const tags: string[] = [];
  const add = (t: string, on: boolean) => on && tags.push(t);
  const kinds = new Set(p.payEvents.map((e) => e.kind));
  const newEmployer = changed && s.change?.payer !== null;
  const irregular = kinds.has("overtime") || kinds.has("bonus") || changed;
  add("salaried", s.archetype === "salaried");
  add("variable-income", s.archetype === "variable");
  add("gig", s.archetype === "gig");
  add("benefits", s.archetype === "benefits");
  if (s.archetype === "salaried") {
    add("overtime", kinds.has("overtime"));
    add("bonus", kinds.has("bonus"));
    add("pay-rise", changed && !newEmployer);
    add("new-employer", newEmployer);
    add("salaried-irregular", irregular);
    add("salaried-payer-drift", s.drift !== null);
    add("drift-over-time", s.drift?.mode === "over_time");
    add("drift-across-banks", s.drift?.mode === "across_banks");
    add("salaried-fixed", !irregular && s.drift === null);
  }
  add("statement-feed", s.feed === "uploaded_statement");
  add("history-1-month", s.history === 1);
  add("coverage-gap", s.salaryUnshared || s.externalAccounts > 0);
  add("gambling", s.gamblingWeekly > 0);
  const recent = dish.filter((d) => b.end - d.day <= 90).length;
  add("dishonour-one-recent", recent === 1);
  add("dishonour-two-plus-recent", recent >= 2);
  add("dishonour-old-only", dish.length > 0 && recent === 0);
  add("dishonour-clean", dish.length === 0);
  const visible = (l: LiabilitySpec) => !l.paidFromUnshared;
  const und = (type: string) => s.liabilities.filter((l) => l.type === type && !l.declared);
  add(
    "mortgage",
    s.liabilities.some((l) => l.type === "mortgage"),
  );
  add("mortgage-undisclosed", und("mortgage").length > 0);
  add("undisclosed-card", und("credit_card").length > 0);
  add(
    "bnpl",
    s.liabilities.some((l) => l.type === "bnpl"),
  );
  add(
    "sacc",
    s.liabilities.some((l) => l.type === "sacc"),
  );
  add(
    "wage-advance",
    s.liabilities.some((l) => l.type === "wage_advance"),
  );
  add("undisclosed-personal-loan", und("personal_loan").length > 0);
  add("undisclosed-car-loan", und("car_loan").length > 0);
  const loans = [...und("personal_loan"), ...und("car_loan")];
  add(
    "account-in-grant",
    loans.some((l) => l.accountShared),
  );
  add(
    "account-not-in-grant",
    loans.some((l) => !l.accountShared),
  );
  add(
    "repaid-from-unshared",
    s.liabilities.some((l) => l.paidFromUnshared),
  );
  add("natural-declarations", s.natural);
  add(
    "unseen-lenders",
    s.liabilities.some((l) => l.unseen),
  );
  add(
    "reference-noise",
    s.liabilities.some((l) => !l.declared && visible(l) && l.narrativeRef !== null),
  );
  add(
    "no-card-biller-cue",
    s.liabilities.some((l) => l.type === "credit_card" && !l.declared && visible(l) && !l.cue),
  );
  return tags;
}

function toTransaction(
  e: Entry,
  accountId: string,
  transactionId: string,
  cdr: boolean,
): Transaction {
  const date = `${toIso(e.day)}T00:00:00Z`;
  const valueDate = `${toIso(e.value ?? e.day)}T00:00:00Z`;
  const base: Transaction = {
    accountId,
    transactionId,
    isDetailAvailable: false,
    type: e.type,
    status: "POSTED",
    description: cdr
      ? e.description
      : `${e.merchant ? "EFTPOS " : ""}${e.description}`.toUpperCase().slice(0, 40),
    postingDateTime: date,
    valueDateTime: valueDate,
    amount: money(e.cents),
    currency: "AUD",
    reference: e.reference,
  };
  if (!cdr) return base;
  return {
    ...base,
    ...(e.merchant ? { merchantName: e.merchant.name, merchantCategoryCode: e.merchant.mcc } : {}),
    ...(e.biller
      ? { billerCode: e.biller.code, billerName: e.biller.name, crn: e.biller.crn }
      : {}),
  } as Transaction;
}
