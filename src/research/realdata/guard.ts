// SIG-61 T2: the guard every run record from a real-data run is written through. Real consented
// data never enters the repository, fixtures or run records; only counts and rates do (CLAUDE.md,
// ADR 0008). The guard is an ALLOW-list: a record may hold numbers, booleans, nulls, and strings of
// a few fixed shapes (a fixed vocabulary of enum terms, ISO dates without times, version strings,
// ticket keys and signal IDs, commit SHAs under commit keys, the source and consent-basis
// identifiers). Everything else is rejected. The detectors below only name WHY a value was
// rejected; they are not what lets a value through.
//
// A violation names the JSON path and the reason, never the value, so a rejection can be logged.

/** Sources that are real consented CDR data. A record naming one is a real-data record. */
export const REAL_SOURCES = ["openfeed-production"] as const;
/** The synthetic sets (research/datasets/*.manifest.json). */
export const SYNTHETIC_SOURCES = [
  "synthetic-v1",
  "synthetic-v2",
  "synthetic-v2.1",
  "synthetic-v2.2",
] as const;
/**
 * The consent bases a real-data run may name. openfeed-onward-disclosure is the one openfeed's flow
 * gives (SIG-61 comment 40194): a disclosure consent to the app, under the Privacy Act, with no
 * de-identification consent. It is the only one: ruling N-1 (9 November 2026) found Moroku is not
 * a sponsored affiliate, so the two CDR bases recorded earlier are removed.
 */
export const CONSENT_BASES = ["openfeed-onward-disclosure"] as const;

export type RealSource = (typeof REAL_SOURCES)[number];

/** The fixed vocabulary of enum terms a real-data run record may hold as string values. */
export const VOCABULARY: ReadonlySet<string> = new Set([
  ...REAL_SOURCES,
  ...SYNTHETIC_SOURCES,
  ...CONSENT_BASES,
  // record kinds and run states
  "run_record",
  "deletion_receipt",
  "clean",
  "dirty (--allow-dirty)",
  "complete",
  "failed",
  "verified",
  "not_verified",
  "pass",
  "fail",
  "exploratory",
  "confirmatory",
  "engineering-reported",
  // signal and roll-up states, decisioning queues (GR-1 queue names only)
  "green",
  "amber",
  "red",
  "grey",
  "unverified",
  "none_observed",
  "in_appetite",
  "review",
  "outside_appetite",
  // the secure environment's stores (ADR 0008, T3)
  "raw_grant_data",
  "derived_features",
  "truth_capture",
  "run_inputs",
  "openfeed_grants",
  // ingestion, revocation and retention (SIG-61, 10:50)
  "ingest_summary",
  "revocation_poll",
  "revoked",
  "purge_after_comparison",
  "privacy-act",
  // truth-capture labels (T4)
  "credit_card",
  "personal_loan",
  "car_loan",
  "mortgage",
  "bnpl",
  "sacc",
  "wage_advance",
  "other_loan",
  "weekly",
  "fortnightly",
  "four_weekly",
  "monthly",
  "quarterly",
  "annually",
  "irregular",
]);

export type Reason =
  | "email"
  | "card_number"
  | "tfn"
  | "phone"
  | "bsb"
  | "masked_number"
  | "account_number"
  | "cdr_token"
  | "hex_token"
  | "base64_token"
  | "person_name"
  | "narrative"
  | "not_in_vocabulary"
  | "identifier_key"
  | "key_not_allowed"
  | "identifier_sized_number"
  | "non_finite_number"
  | "unknown_source"
  | "unsupported_type";

export type Violation = { path: string; reason: Reason };
export type GuardResult = { ok: boolean; violations: Violation[] };

// ---- detectors: name the reason a string is rejected ---------------------------------------

const digitsOf = (s: string): string => s.replace(/[\s-]/g, "");

/** Luhn check over a digit string. */
export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length > 0 && sum % 10 === 0;
}

/** The ATO TFN check digit algorithm (weights 1,4,3,7,5,8,6,9,10; sum divisible by 11). */
export function tfnChecksum(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  const w = [1, 4, 3, 7, 5, 8, 6, 9, 10];
  return [...digits].reduce((sum, d, i) => sum + Number(d) * (w[i] ?? 0), 0) % 11 === 0;
}

export const detect = {
  email: (s: string): boolean => /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(s),
  card_number: (s: string): boolean =>
    [...s.matchAll(/(?<![\dA-Za-z])\d(?:[\s-]?\d){12,18}(?![\dA-Za-z])/g)].some((m) =>
      luhn(digitsOf(m[0])),
    ),
  tfn: (s: string): boolean =>
    [...s.matchAll(/(?<![\dA-Za-z])\d{3}[\s-]?\d{3}[\s-]?\d{3}(?![\dA-Za-z])/g)].some((m) =>
      tfnChecksum(digitsOf(m[0])),
    ),
  phone: (s: string): boolean =>
    /(?<![\dA-Za-z])(?:\+?61[\s-]?|0)[2-478](?:[\s-]?\d){8}(?![\dA-Za-z])/.test(s) ||
    /(?<![\dA-Za-z])1[38]00(?:[\s-]?\d){6}(?![\dA-Za-z])/.test(s),
  bsb: (s: string): boolean =>
    /(?<![\dA-Za-z-])\d{3}-\d{3}(?![\dA-Za-z-])/.test(s) || /^\d{6}$/.test(s.trim()),
  masked_number: (s: string): boolean =>
    /(?<![A-Za-z])(?:[x*•#]{3,}[\s-]?)+\d{3,4}(?![\dA-Za-z])/i.test(s),
  account_number: (s: string): boolean => /(?<![\dA-Za-z.])\d{6,10}(?![\dA-Za-z.])/.test(s),
  cdr_token: (s: string): boolean =>
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s) ||
    /eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*/.test(s) ||
    /\bbearer\s+\S{8,}/i.test(s),
  hex_token: (s: string): boolean => /(?<![0-9a-z])[0-9a-f]{24,}(?![0-9a-z])/i.test(s),
  base64_token: (s: string): boolean =>
    [...s.matchAll(/[A-Za-z0-9+_-]{24,}={0,2}/g)].some(
      (m) => /[A-Z]/.test(m[0]) && /[a-z]/.test(m[0]) && /\d/.test(m[0]),
    ),
  person_name: (s: string): boolean => /\b[A-Z][a-z]+(?:[\s]+[A-Z][a-z'-]+)+\b/.test(s),
  narrative: (s: string): boolean => /\S\s+\S/.test(s),
} as const;

/** The detectors in the order a rejection is classified, most specific first. */
const ORDER: (keyof typeof detect)[] = [
  "email",
  "card_number",
  "tfn",
  "phone",
  "bsb",
  "masked_number",
  "account_number",
  "cdr_token",
  "hex_token",
  "base64_token",
  "person_name",
  "narrative",
];

/** Why a string would be rejected, if it looks like data; null when no detector fires. */
export function classify(s: string): Reason | null {
  return ORDER.find((name) => detect[name](s)) ?? null;
}

// ---- allowed shapes ------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const isIsoDate = (s: string): boolean => {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
};
const VERSION = /^v?\d{1,4}\.\d{1,4}(?:\.\d{1,4})?(?:-[0-9a-z]+(?:\.[0-9a-z]+)*)?$/;
const TICKET_OR_SIGNAL = /^[A-Z]{2,4}-[A-Z]?\d{1,3}$/;
const SMALL_NUMBER = /^-?\d{1,4}(?:\.\d+)?$/;
const REPO_PATH = /^(?:research|realdata|scripts|definitions)\/[a-z0-9_./-]+$/;
const LONG_DIGITS = /\d{5,}/;
const SHA = /^[0-9a-f]{7,40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** Keys whose value is a commit SHA. */
const COMMIT_KEYS = new Set(["engine_commit", "commit", "git_commit", "code_commit"]);
/** Keys whose value is a SHA-256 of an input file or set (never of a single value). */
const DIGEST_KEYS = new Set(["set_sha256", "input_sha256", "manifest_sha256"]);
/** Keys whose value must be a known source identifier. */
const SOURCE_KEYS = new Set(["data_source", "source_set"]);
const CONSENT_KEYS = new Set(["consent_basis"]);

/** Last key segments that carry an identifier or free text; such a key holds no data at all. */
const IDENTIFIER_SEGMENTS = new Set([
  "bsb",
  "acct",
  "tfn",
  "phone",
  "mobile",
  "email",
  "name",
  "names",
  "description",
  "descriptions",
  "narrative",
  "narratives",
  "reference",
  "references",
  "ref",
  "refs",
  "token",
  "tokens",
  "employer",
  "employers",
  "lender",
  "lenders",
  "payee",
  "payees",
  "payer",
  "payers",
  "merchant",
  "merchants",
  "address",
  "iban",
  "card",
  "cards",
  "note",
  "notes",
  "comment",
  "comments",
]);
const IDENTIFIER_KEYS =
  /account_?(?:number|no|id)|card_?number|arrangement_?id|customer_?id|consumer_?ref/;

const KEY = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;

/** True when the key names an identifier or free text, so its value may not be recorded. */
export function isIdentifierKey(key: string): boolean {
  const lower = key.toLowerCase();
  const segments = lower.split(/[_-]/);
  return (
    IDENTIFIER_KEYS.test(lower) || IDENTIFIER_SEGMENTS.has(segments[segments.length - 1] ?? "")
  );
}

const allowedKey = (key: string): boolean =>
  ((KEY.test(key) && key.length <= 64 && !LONG_DIGITS.test(key)) ||
    TICKET_OR_SIGNAL.test(key) ||
    isIsoDate(key) ||
    VERSION.test(key)) &&
  classify(key) === null;

const allowedScalarString = (s: string, vocabulary: ReadonlySet<string>): boolean =>
  vocabulary.has(s) ||
  isIsoDate(s) ||
  VERSION.test(s) ||
  TICKET_OR_SIGNAL.test(s) ||
  SMALL_NUMBER.test(s) ||
  (REPO_PATH.test(s) && !LONG_DIGITS.test(s) && classify(s) === null);

/** A run command: npx tsx scripts/<name>.ts followed by flags and allowed scalar values. */
const allowedCommand = (s: string, vocabulary: ReadonlySet<string>): boolean => {
  const [npx, tsx, script, ...rest] = s.split(" ");
  return (
    npx === "npx" &&
    tsx === "tsx" &&
    /^scripts\/[a-z0-9-]+\.ts$/.test(script ?? "") &&
    rest.every((t) => /^--[a-z][a-z0-9-]*$/.test(t) || allowedScalarString(t, vocabulary))
  );
};

export type GuardOptions = {
  /** Extra enum terms for one kind of run; each must be a lower-case identifier. */
  vocabulary?: readonly string[];
};

const EXTRA_TERM = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;

function stringViolation(
  key: string | null,
  s: string,
  vocabulary: ReadonlySet<string>,
): Reason | null {
  if (key !== null && SOURCE_KEYS.has(key))
    return (REAL_SOURCES as readonly string[]).includes(s) ||
      (SYNTHETIC_SOURCES as readonly string[]).includes(s)
      ? null
      : "unknown_source";
  if (key !== null && CONSENT_KEYS.has(key))
    return (CONSENT_BASES as readonly string[]).includes(s) ? null : "not_in_vocabulary";
  if (key !== null && COMMIT_KEYS.has(key) && SHA.test(s)) return null;
  if (key !== null && DIGEST_KEYS.has(key) && SHA256.test(s)) return null;
  if (key === "command" && allowedCommand(s, vocabulary)) return null;
  if (allowedScalarString(s, vocabulary)) return null;
  return classify(s) ?? "not_in_vocabulary";
}

/**
 * Checks a record against the allow-list. Returns every violation, each with its JSON path and
 * reason and never the offending value.
 */
export function guardRunRecord(record: unknown, options: GuardOptions = {}): GuardResult {
  const extra = options.vocabulary ?? [];
  const bad = extra.filter((t) => !EXTRA_TERM.test(t) || classify(t) !== null);
  if (bad.length)
    throw new Error(`Vocabulary terms must be lower-case identifiers (${bad.length})`);
  const vocabulary = extra.length ? new Set([...VOCABULARY, ...extra]) : VOCABULARY;
  const violations: Violation[] = [];

  const walk = (value: unknown, path: string, key: string | null): void => {
    if (value === null || typeof value === "boolean") return;
    if (key !== null && isIdentifierKey(key)) {
      violations.push({ path, reason: "identifier_key" });
      return;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) violations.push({ path, reason: "non_finite_number" });
      else if (Number.isInteger(value) && Math.abs(value) >= 1e8)
        violations.push({ path, reason: "identifier_sized_number" });
      return;
    }
    if (typeof value === "string") {
      const reason = stringViolation(key, value, vocabulary);
      if (reason) violations.push({ path, reason });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`, key));
      return;
    }
    if (typeof value === "object") {
      Object.entries(value as Record<string, unknown>).forEach(([k, v], i) => {
        if (!allowedKey(k)) {
          // The key itself may be data, so the path names its position, not its text.
          violations.push({ path: `${path}{key ${i}}`, reason: "key_not_allowed" });
          return;
        }
        walk(v, `${path}.${k}`, k);
      });
      return;
    }
    violations.push({ path, reason: "unsupported_type" });
  };

  walk(record, "$", null);
  return { ok: violations.length === 0, violations };
}

/** Throws when the record fails the guard. The message names paths and reasons only. */
export function assertGuarded(record: unknown, options: GuardOptions = {}): void {
  const { ok, violations } = guardRunRecord(record, options);
  if (!ok)
    throw new Error(
      `T2 guard rejected the record (${violations.length} value(s)): ` +
        violations
          .slice(0, 20)
          .map((v) => `${v.path} ${v.reason}`)
          .join("; "),
    );
}

/** True when the value, anywhere inside, names a real source. */
export function declaresRealSource(record: unknown): boolean {
  if (typeof record === "string") return (REAL_SOURCES as readonly string[]).includes(record);
  if (Array.isArray(record)) return record.some(declaresRealSource);
  if (record !== null && typeof record === "object")
    return Object.values(record as Record<string, unknown>).some(declaresRealSource);
  return false;
}

/** True when text (a file's contents) mentions a real source identifier anywhere. */
export const mentionsRealSource = (text: string): boolean =>
  REAL_SOURCES.some((s) => text.includes(s));
