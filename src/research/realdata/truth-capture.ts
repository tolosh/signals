// SIG-61 T4: the truth-capture record a team member fills in about their own finances, so a
// real-data run can be scored against what they declare (ADR 0008). Structured fields only: no
// free text, no unknown fields. The JSON Schema is research/schemas/truth-capture-v1.schema.json;
// this validator and the schema accept and reject the same records (the tests check both).
//
// Employer and lender names are normalised names held only in the secure environment's
// truth_capture store. They never enter the repository or a run record: the T2 guard rejects any
// record with an employer or lender field. Errors name the path and the rule, never the value.
import { assertConsumerRef, CONSUMER_REF, type ConsumerStore } from "./stores.js";

export const TRUTH_SCHEMA_VERSION = "1.0.0";
export const PAY_CADENCES = ["weekly", "fortnightly", "four_weekly", "monthly"] as const;
export const REPAYMENT_CADENCES = [
  "weekly",
  "fortnightly",
  "four_weekly",
  "monthly",
  "quarterly",
] as const;
export const LIABILITY_TYPES = [
  "credit_card",
  "personal_loan",
  "car_loan",
  "mortgage",
  "bnpl",
  "sacc",
  "wage_advance",
  "other_loan",
] as const;

/** A normalised organisation name: upper case, at most six words, no punctuation beyond & ' . - */
export const NORMALISED_NAME = /^[A-Z0-9&'.-]+(?: [A-Z0-9&'.-]+){0,5}$/;
export const NORMALISED_NAME_MAX = 60;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type NormalisedName = { normalised_name: string };
export type Liability = {
  type: (typeof LIABILITY_TYPES)[number];
  lender: NormalisedName;
  repayment_amount: number;
  repayment_cadence: (typeof REPAYMENT_CADENCES)[number];
  limit?: number;
  balance?: number;
};
export type TruthCapture = {
  schema_version: typeof TRUTH_SCHEMA_VERSION;
  consumer_ref: string;
  captured_on: string;
  gross_annual_pay: number;
  net_pay_per_pay: number;
  pay_cadence: (typeof PAY_CADENCES)[number];
  payslip_verified: boolean;
  employer: NormalisedName;
  liabilities: Liability[];
};

export type TruthError = { path: string; rule: string };
export type TruthResult = { ok: true; value: TruthCapture } | { ok: false; errors: TruthError[] };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function validateTruthCapture(input: unknown): TruthResult {
  const errors: TruthError[] = [];
  const err = (path: string, rule: string) => errors.push({ path, rule });

  const fields = (
    obj: Record<string, unknown>,
    path: string,
    required: readonly string[],
    optional: readonly string[] = [],
  ) => {
    for (const k of required) if (!(k in obj)) err(`${path}.${k}`, "required");
    Object.keys(obj).forEach((k, i) => {
      // An unknown key may itself be free text, so the path names its position only.
      if (!required.includes(k) && !optional.includes(k)) err(`${path}{key ${i}}`, "unknown_field");
    });
  };
  const amount = (v: unknown, path: string, max: number) => {
    if (v === undefined) return;
    if (typeof v !== "number" || !Number.isFinite(v)) err(path, "number");
    else if (v < 0 || v > max) err(path, "range");
  };
  const oneOf = (v: unknown, path: string, values: readonly string[]) => {
    if (v !== undefined && (typeof v !== "string" || !values.includes(v))) err(path, "enum");
  };
  const name = (v: unknown, path: string) => {
    if (v === undefined) return;
    if (!isObject(v)) return err(path, "object");
    fields(v, path, ["normalised_name"]);
    const n = v.normalised_name;
    if (n === undefined) return;
    if (typeof n !== "string" || n.length > NORMALISED_NAME_MAX || !NORMALISED_NAME.test(n))
      err(`${path}.normalised_name`, "normalised_name");
  };

  if (!isObject(input)) return { ok: false, errors: [{ path: "$", rule: "object" }] };
  fields(input, "$", [
    "schema_version",
    "consumer_ref",
    "captured_on",
    "gross_annual_pay",
    "net_pay_per_pay",
    "pay_cadence",
    "payslip_verified",
    "employer",
    "liabilities",
  ]);
  if (input.schema_version !== undefined && input.schema_version !== TRUTH_SCHEMA_VERSION)
    err("$.schema_version", "const");
  if (
    input.consumer_ref !== undefined &&
    (typeof input.consumer_ref !== "string" || !CONSUMER_REF.test(input.consumer_ref))
  )
    err("$.consumer_ref", "consumer_ref");
  if (
    input.captured_on !== undefined &&
    (typeof input.captured_on !== "string" || !ISO_DATE.test(input.captured_on))
  )
    err("$.captured_on", "date");
  amount(input.gross_annual_pay, "$.gross_annual_pay", 10_000_000);
  amount(input.net_pay_per_pay, "$.net_pay_per_pay", 1_000_000);
  oneOf(input.pay_cadence, "$.pay_cadence", PAY_CADENCES);
  if (input.payslip_verified !== undefined && typeof input.payslip_verified !== "boolean")
    err("$.payslip_verified", "boolean");
  name(input.employer, "$.employer");
  if (input.liabilities !== undefined) {
    if (!Array.isArray(input.liabilities)) err("$.liabilities", "array");
    else if (input.liabilities.length > 30) err("$.liabilities", "max_items");
    else
      input.liabilities.forEach((l: unknown, i: number) => {
        const p = `$.liabilities[${i}]`;
        if (!isObject(l)) return err(p, "object");
        fields(
          l,
          p,
          ["type", "lender", "repayment_amount", "repayment_cadence"],
          ["limit", "balance"],
        );
        oneOf(l.type, `${p}.type`, LIABILITY_TYPES);
        name(l.lender, `${p}.lender`);
        amount(l.repayment_amount, `${p}.repayment_amount`, 1_000_000);
        oneOf(l.repayment_cadence, `${p}.repayment_cadence`, REPAYMENT_CADENCES);
        amount(l.limit, `${p}.limit`, 100_000_000);
        amount(l.balance, `${p}.balance`, 100_000_000);
      });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: input as TruthCapture };
}

/**
 * Validates a truth-capture record and stores it in the truth_capture store of the secure
 * environment, the only place it is kept, so the deletion procedure covers it.
 */
export async function captureTruth(
  store: ConsumerStore,
  input: unknown,
  recordId: string,
): Promise<TruthCapture> {
  if (store.name !== "truth_capture") throw new Error("Truths are kept in the truth_capture store");
  const result = validateTruthCapture(input);
  if (!result.ok)
    throw new Error(
      `Truth-capture record rejected: ${result.errors.map((e) => `${e.path} ${e.rule}`).join("; ")}`,
    );
  assertConsumerRef(result.value.consumer_ref);
  await store.put(result.value.consumer_ref, recordId, result.value);
  return result.value;
}
