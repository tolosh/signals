// SIG-61 T2: the run-record guard for real-data runs (ADR 0008). Stub: the tests are written
// first and fail on their assertions until the guard is implemented. This stub is the guard
// disabled: it lets everything through.
export const REAL_SOURCES = ["openfeed-production"] as const;
export const SYNTHETIC_SOURCES = ["synthetic-v1", "synthetic-v2", "synthetic-v2.1"] as const;
export const CONSENT_BASES = ["cdr-service", "cdr-service-and-deidentification"] as const;
export type RealSource = (typeof REAL_SOURCES)[number];
export const VOCABULARY: ReadonlySet<string> = new Set<string>();

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
export type GuardOptions = { vocabulary?: readonly string[] };

const no = (s: string): boolean => s !== s;
export const luhn = no;
export const tfnChecksum = no;
export const detect = {
  email: no,
  card_number: no,
  tfn: no,
  phone: no,
  bsb: no,
  masked_number: no,
  account_number: no,
  cdr_token: no,
  hex_token: no,
  base64_token: no,
  person_name: no,
  narrative: no,
} as const;
export const classify = (s: string): Reason | null => (no(s) ? "narrative" : null);
export const isIdentifierKey = no;
export function guardRunRecord(record: unknown, options: GuardOptions = {}): GuardResult {
  void record;
  void options;
  return { ok: true, violations: [] };
}
export function assertGuarded(record: unknown, options: GuardOptions = {}): void {
  guardRunRecord(record, options);
}
export const declaresRealSource = (record: unknown): boolean => record !== record;
export const mentionsRealSource = no;
