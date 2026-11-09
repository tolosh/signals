// SIG-61 T2: the run-record guard for real-data runs (ADR 0008). An allow-list: numbers, booleans
// and a few fixed string shapes pass; anything that could be real text or an identifier is
// rejected. Every value below is invented for the test; none is real consumer data.
import { describe, expect, it } from "vitest";
import {
  assertGuarded,
  CONSENT_BASES,
  classify,
  declaresRealSource,
  detect,
  guardRunRecord,
  isIdentifierKey,
  luhn,
  tfnChecksum,
  type GuardResult,
  type Reason,
} from "../../../src/research/realdata/guard.js";

/** Values that must be rejected, with the reason the guard gives. */
const REJECT: [string, Reason][] = [
  ["PAYMENT TO WOOLWORTHS METRO 1043 SYDNEY", "narrative"],
  ["salary from acme pty ltd", "narrative"],
  ["062-000", "bsb"],
  ["062000", "bsb"],
  ["TRANSFER TO 062-000", "bsb"],
  ["12345678", "account_number"],
  ["acct 1234567", "account_number"],
  ["xxxx1234", "masked_number"],
  ["**** **** **** 4321", "masked_number"],
  ["4111111111111111", "card_number"],
  ["4111 1111 1111 1111", "card_number"],
  ["jane.citizen@example.com", "email"],
  ["0412 345 678", "phone"],
  ["+61 2 9876 5432", "phone"],
  ["1300 123 456", "phone"],
  ["123 456 782", "tfn"],
  ["123456782", "tfn"],
  ["3f2504e0-4f89-11d3-9a0c-0305e82c3301", "cdr_token"],
  ["eyJhbGciOiJQUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln", "cdr_token"],
  ["Bearer abcdefgh12345678", "cdr_token"],
  ["9f86d081884c7d659a2feaa0c55ad015", "hex_token"],
  ["dGhpc0lzQVNlY3JldFRva2VuMTIzNDU2", "base64_token"],
  ["Jane Citizen", "person_name"],
  ["Transfer to Jane Citizen", "person_name"],
  ["anything_else", "not_in_vocabulary"],
];

/** Near misses: values that look a little like a pattern but are allowed shapes. */
const ALLOW: string[] = [
  "2026-11-09", // an ISO date, not a BSB or phone
  "1.2.10", // a version, not an account number
  "v2.1.0",
  "2.1.0-rc.1",
  "SIG-61", // a ticket key
  "LIA-05", // a signal ID
  "EQ-01",
  "in_appetite",
  "amber",
  "credit_card",
  "openfeed-production",
  "openfeed-onward-disclosure",
  "synthetic-v2.1",
  "6", // a small numeric string, not an account number
  "1234",
  "research/datasets/synthetic-v1.manifest.json",
];

const guarded = (value: unknown, key = "value"): GuardResult => guardRunRecord({ [key]: value });

describe("SIG-61 T2: each detector, positive and near miss", () => {
  const cases: [keyof typeof detect, string[], string[]][] = [
    ["narrative", ["PAYMENT TO WOOLWORTHS", "rent for march"], ["in_appetite", "salaried-base"]],
    ["bsb", ["062-000", "062000", "to 062-000 now"], ["2026-11", "12-345", "SIG-061", "0620001"]],
    ["account_number", ["12345678", "acct 123456"], ["12345", "1.2.10", "a1234567b"]],
    [
      "masked_number",
      ["xxxx1234", "****4321", "XXXX XXXX 9876"],
      ["x1234", "**bold** 15", "box12"],
    ],
    ["card_number", ["4111111111111111", "5500-0000-0000-0004"], ["4111111111111112", "123456"]],
    ["email", ["a.b@example.com.au"], ["user@host", "@types/node", "a@b"]],
    ["phone", ["0412345678", "02 9876 5432", "+61412345678", "1800 123 456"], ["0123", "04 12"]],
    ["tfn", ["123456782", "123 456 782"], ["123456789", "12345678"]],
    [
      "cdr_token",
      ["3F2504E0-4F89-11D3-9A0C-0305E82C3301", "eyJhbGci.eyJzdWIi.sig", "bearer zzzzzzzzzz"],
      ["3f2504e0-4f89-11d3", "eyJ", "bearer"],
    ],
    ["hex_token", ["0123456789abcdef0123456789abcdef"], ["abc123", "0123456789abcdef"]],
    [
      "base64_token",
      ["QWxhZGRpbjpvcGVuIHNlc2FtZTEyMzQ1"],
      ["covered_expenses_v1_lookback_months", "research/preregistrations/SIG-18.json"],
    ],
    ["person_name", ["Jane Citizen", "pay to John O'Brien"], ["jane citizen", "Jane", "SIG-61"]],
  ];
  for (const [name, positives, nearMisses] of cases) {
    it(`${name}: fires on ${positives.length} and not on ${nearMisses.length} near misses`, () => {
      expect(positives.filter((s) => !detect[name](s))).toEqual([]);
      expect(nearMisses.filter((s) => detect[name](s))).toEqual([]);
    });
  }

  it("Luhn and the TFN check digit", () => {
    expect(luhn("4111111111111111")).toBe(true);
    expect(luhn("4111111111111112")).toBe(false);
    expect(tfnChecksum("123456782")).toBe(true);
    expect(tfnChecksum("123456789")).toBe(false);
  });

  it("classify names the most specific reason", () => {
    expect(REJECT.filter(([s, r]) => r !== "not_in_vocabulary" && classify(s) !== r)).toEqual([]);
  });
});

describe("SIG-61 T2: the guard is an allow-list", () => {
  it("rejects every value that could be real text or an identifier, with its reason", () => {
    const wrong = REJECT.filter(([s, reason]) => {
      const r = guarded(s);
      return r.ok || r.violations[0]?.reason !== reason;
    });
    expect(wrong).toEqual([]);
  });

  it("allows numbers, booleans, null and the fixed shapes", () => {
    expect(ALLOW.filter((s) => !guarded(s).ok)).toEqual([]);
    expect(guardRunRecord({ count: 12, rate: 0.708, flag: true, none: null }).ok).toBe(true);
  });

  it("rejects strings that are only unlisted words", () => {
    for (const s of ["jane", "acme", "woolworths", "unverified_maybe", "Amber"])
      expect(guarded(s).ok).toBe(false);
  });

  it("commit SHAs and set digests only under their keys", () => {
    const sha = "0df17eba1734c524ded76534fa62a89da2a2593a";
    const digest = "8f5cf973ec46b33bbeccd97e87dcde10edea22919ed9af9bc9469149b2e17ea9";
    expect(guardRunRecord({ engine_commit: sha, set_sha256: digest }).ok).toBe(true);
    expect(guardRunRecord({ note_id: sha }).ok).toBe(false);
    expect(guardRunRecord({ value: digest }).ok).toBe(false);
  });

  it("source and consent-basis keys hold only known identifiers", () => {
    expect(guardRunRecord({ data_source: "openfeed-production" }).ok).toBe(true);
    expect(guardRunRecord({ consent_basis: "openfeed-onward-disclosure" }).ok).toBe(true);
    // N-1 ruled (9 November 2026): Moroku is not a sponsored affiliate, so the CDR bases are gone.
    expect(CONSENT_BASES).toEqual(["openfeed-onward-disclosure"]);
    expect(guardRunRecord({ consent_basis: "cdr-service" }).ok).toBe(false);
    expect(guardRunRecord({ data_source: "openfeed-sandbox-x" }).violations[0]?.reason).toBe(
      "unknown_source",
    );
    expect(guardRunRecord({ consent_basis: "amber" }).ok).toBe(false);
  });

  it("identifier and free-text keys hold no value at all, and the employer field is blocked", () => {
    for (const key of [
      "employer",
      "employer_name",
      "lender",
      "description",
      "account_number",
      "bsb",
      "consumer_ref",
      "notes",
      "payee",
    ]) {
      expect(isIdentifierKey(key)).toBe(true);
      expect(guardRunRecord({ [key]: "amber" }).violations[0]?.reason).toBe("identifier_key");
      expect(guardRunRecord({ [key]: 3 }).ok).toBe(false);
    }
    expect(guardRunRecord({ employer: { normalised_name: "ACME" } }).ok).toBe(false);
    for (const key of ["lender_count", "accounts", "liability_types", "employer_count"])
      expect(isIdentifierKey(key)).toBe(false);
    expect(guardRunRecord({ lender_count: 3, has_employer: true }).ok).toBe(true);
  });

  it("keys must be identifiers; a key that is data is rejected without echoing it", () => {
    const r = guardRunRecord({ by_group: { "WOOLWORTHS 1043": 2, "062-000": 1 } });
    expect(r.violations.map((v) => v.reason)).toEqual(["key_not_allowed", "key_not_allowed"]);
    expect(JSON.stringify(r)).not.toMatch(/WOOLWORTHS|062-000/);
    expect(guardRunRecord({ "LIA-05": { amber: 3 }, "2026-10-31": 4, "v1.2.0": 1 }).ok).toBe(true);
  });

  it("identifier-sized integers and non-finite numbers are rejected", () => {
    expect(guarded(4111111111111111).violations[0]?.reason).toBe("identifier_sized_number");
    expect(guarded(123456782).violations[0]?.reason).toBe("identifier_sized_number");
    expect(guarded(Number.NaN).violations[0]?.reason).toBe("non_finite_number");
    expect(guarded(9_999_999).ok).toBe(true);
  });

  it("dates carry no time", () => {
    expect(guarded("2026-11-09T10:15:00Z").ok).toBe(false);
    expect(guarded("2026-02-30").ok).toBe(false);
  });

  it("walks arrays and nested objects, and names paths", () => {
    const r = guardRunRecord({ metrics: { rows: [1, "Jane Citizen", { ok: true }] } });
    expect(r.violations).toEqual([{ path: "$.metrics.rows[1]", reason: "person_name" }]);
  });

  it("a run command is allowed only as npx tsx scripts/… with flags and allowed values", () => {
    expect(
      guardRunRecord({ command: "npx tsx scripts/real-run.ts --lookback 6 --as-of 2026-10-31" }).ok,
    ).toBe(true);
    expect(guardRunRecord({ command: "npx tsx scripts/real-run.ts --who Jane" }).ok).toBe(false);
    expect(guardRunRecord({ command: "curl https://example.com" }).ok).toBe(false);
  });

  it("extra vocabulary must be lower-case identifiers", () => {
    expect(guardRunRecord({ v: "income_regular" }, { vocabulary: ["income_regular"] }).ok).toBe(
      true,
    );
    expect(() => guardRunRecord({}, { vocabulary: ["Jane Citizen"] })).toThrow(/identifiers/);
  });

  it("assertGuarded throws with paths and reasons only, never the value", () => {
    expect(() => assertGuarded({ value: "jane.citizen@example.com" })).toThrow(/\$\.value email/);
    try {
      assertGuarded({ value: "jane.citizen@example.com" });
    } catch (e) {
      expect(String(e)).not.toContain("jane");
    }
  });

  it("declaresRealSource finds a real source anywhere in a record", () => {
    expect(declaresRealSource({ dataset: { data_source: "openfeed-production" } })).toBe(true);
    expect(declaresRealSource({ dataset: { set: "synthetic-v1" } })).toBe(false);
  });
});

/** Runs the rejection corpus against a guard; returns the values it let through. */
function corpusEscapes(guard: (record: unknown) => GuardResult): string[] {
  return REJECT.map(([s]) => s).filter((s) => guard({ value: s }).ok);
}

describe("SIG-61 T2: mutation check, the guard disabled fails the corpus", () => {
  it("the real guard lets nothing through", () => {
    expect(corpusEscapes(guardRunRecord)).toEqual([]);
  });
  it("a disabled guard lets the whole corpus through, so these tests would fail", () => {
    const disabled = (): GuardResult => ({ ok: true, violations: [] });
    expect(corpusEscapes(disabled)).toHaveLength(REJECT.length);
  });
  it("a guard that allows any string lets the corpus through", () => {
    const stringsAllowed = (r: unknown): GuardResult =>
      guardRunRecord(JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === "string" ? 0 : v))));
    expect(corpusEscapes(stringsAllowed).length).toBeGreaterThan(0);
  });
});
