// SIG-61 T4: the truth-capture record a team member fills in about their own finances, so a
// real-data run can be scored against what they declare (ADR 0008). Structured fields only: no
// free text, no unknown fields. The JSON Schema is research/schemas/truth-capture-v2.schema.json;
// this validator and the schema accept and reject the same records (the tests check both), except
// the payslip consistency rule, which only the validator checks. Schema 2.0.0 (10:50 on
// 9 November 2026) adds the figures from one payslip, whether each liability's account is in the
// grant, and the person's statement that the list (BNPL included) is complete.
//
// Employer and lender names are normalised names held only in the secure environment's
// truth_capture store. They never enter the repository or a run record: the T2 guard rejects any
// record with an employer or lender field. Errors name the path and the rule, never the value.
import { assertConsumerRef, CONSUMER_REF, type ConsumerStore } from "./stores.js";

export const TRUTH_SCHEMA_VERSION = "2.0.0";
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
  account_in_grant?: boolean;
};
/** The figures from one payslip: the truth SIG-16 scores against (net) and SIG-46 grosses up. */
export type Payslip = {
  pay_date: string;
  gross_per_pay: number;
  net_per_pay: number;
  tax_withheld: number;
};
export type TruthCapture = {
  schema_version: typeof TRUTH_SCHEMA_VERSION;
  consumer_ref: string;
  captured_on: string;
  gross_annual_pay: number;
  pay_cadence: (typeof PAY_CADENCES)[number];
  payslip: Payslip;
  payslip_verified: boolean;
  employer: NormalisedName;
  liabilities: Liability[];
  liabilities_complete: boolean;
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
    "pay_cadence",
    "payslip",
    "payslip_verified",
    "employer",
    "liabilities",
    "liabilities_complete",
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
  oneOf(input.pay_cadence, "$.pay_cadence", PAY_CADENCES);
  if (input.payslip !== undefined) {
    const ps = input.payslip;
    if (!isObject(ps)) err("$.payslip", "object");
    else {
      fields(ps, "$.payslip", ["pay_date", "gross_per_pay", "net_per_pay", "tax_withheld"]);
      if (
        ps.pay_date !== undefined &&
        (typeof ps.pay_date !== "string" || !ISO_DATE.test(ps.pay_date))
      )
        err("$.payslip.pay_date", "date");
      const before = errors.length;
      amount(ps.gross_per_pay, "$.payslip.gross_per_pay", 1_000_000);
      amount(ps.net_per_pay, "$.payslip.net_per_pay", 1_000_000);
      amount(ps.tax_withheld, "$.payslip.tax_withheld", 1_000_000);
      const [g, n, t] = [ps.gross_per_pay, ps.net_per_pay, ps.tax_withheld];
      // Net pay is gross less tax and any other deductions, so it is at most gross less tax.
      if (
        errors.length === before &&
        typeof g === "number" &&
        typeof n === "number" &&
        typeof t === "number" &&
        n > g - t + 0.005
      )
        err("$.payslip", "payslip_inconsistent");
    }
  }
  for (const k of ["payslip_verified", "liabilities_complete"] as const)
    if (input[k] !== undefined && typeof input[k] !== "boolean") err(`$.${k}`, "boolean");
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
          ["limit", "balance", "account_in_grant"],
        );
        oneOf(l.type, `${p}.type`, LIABILITY_TYPES);
        name(l.lender, `${p}.lender`);
        amount(l.repayment_amount, `${p}.repayment_amount`, 1_000_000);
        oneOf(l.repayment_cadence, `${p}.repayment_cadence`, REPAYMENT_CADENCES);
        amount(l.limit, `${p}.limit`, 100_000_000);
        amount(l.balance, `${p}.balance`, 100_000_000);
        if (l.account_in_grant !== undefined && typeof l.account_in_grant !== "boolean")
          err(`${p}.account_in_grant`, "boolean");
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
