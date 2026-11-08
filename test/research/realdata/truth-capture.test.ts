// SIG-61 T4: the truth-capture record (research/schemas/truth-capture-v1.schema.json and
// src/research/realdata/truth-capture.ts). Structured fields only; unknown fields and free text are
// rejected; the JSON Schema and the validator agree; truths live in the truth_capture store only,
// so deletion removes them. The employer field is blocked by the T2 guard. Invented values only.
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { deleteConsumer } from "../../../src/research/realdata/deletion.js";
import { guardRunRecord } from "../../../src/research/realdata/guard.js";
import { MemoryStore, STORES } from "../../../src/research/realdata/stores.js";
import {
  captureTruth,
  validateTruthCapture,
} from "../../../src/research/realdata/truth-capture.js";

const schema = JSON.parse(
  readFileSync("research/schemas/truth-capture-v1.schema.json", "utf8"),
) as object;
const ajv = new Ajv2020({ strict: true, allErrors: true });
const schemaValid = ajv.compile(schema);

const REF = "cr_0000000000000000aaaa";
const valid = () => ({
  schema_version: "1.0.0",
  consumer_ref: REF,
  captured_on: "2026-11-09",
  gross_annual_pay: 95000,
  net_pay_per_pay: 2780.5,
  pay_cadence: "fortnightly",
  payslip_verified: true,
  employer: { normalised_name: "EXAMPLE CO PTY LTD" },
  liabilities: [
    {
      type: "credit_card",
      lender: { normalised_name: "EXAMPLE BANK" },
      repayment_amount: 150,
      repayment_cadence: "monthly",
      limit: 8000,
    },
    {
      type: "car_loan",
      lender: { normalised_name: "EXAMPLE FINANCE" },
      repayment_amount: 420,
      repayment_cadence: "fortnightly",
      balance: 18500,
    },
  ],
});

type Rec = ReturnType<typeof valid> & Record<string, unknown>;
const INVALID: [string, (r: Rec) => void][] = [
  ["missing consumer_ref", (r) => delete (r as Partial<Rec>).consumer_ref],
  ["consumer_ref not opaque", (r) => (r.consumer_ref = "jane.citizen")],
  ["wrong schema_version", (r) => (r.schema_version = "2.0.0")],
  ["captured_on with a time", (r) => (r.captured_on = "2026-11-09T10:00:00Z")],
  ["negative gross pay", (r) => (r.gross_annual_pay = -1)],
  ["gross pay as a string", (r) => ((r as Record<string, unknown>).gross_annual_pay = "95000")],
  ["net pay out of range", (r) => (r.net_pay_per_pay = 2_000_000)],
  ["unknown pay cadence", (r) => (r.pay_cadence = "daily")],
  ["payslip_verified not boolean", (r) => ((r as Record<string, unknown>).payslip_verified = 1)],
  ["employer as a bare string", (r) => ((r as Record<string, unknown>).employer = "ACME")],
  ["employer name lower case", (r) => (r.employer.normalised_name = "Example Co")],
  ["employer name too long", (r) => (r.employer.normalised_name = "A ".repeat(40).trim())],
  ["liability type unknown", (r) => (r.liabilities[0]!.type = "overdraft")],
  ["liability cadence unknown", (r) => (r.liabilities[0]!.repayment_cadence = "daily")],
  ["liability without lender", (r) => delete (r.liabilities[1] as Partial<Rec>).lender],
  ["negative repayment", (r) => (r.liabilities[0]!.repayment_amount = -5)],
  ["liabilities not an array", (r) => ((r as Record<string, unknown>).liabilities = {})],
];

const FREE_TEXT: [string, (r: Rec) => void][] = [
  ["a notes field", (r) => (r.notes = "also paid cash some weeks")],
  [
    "a comment on a liability",
    (r) => ((r.liabilities[0] as Record<string, unknown>).comment = "owe my brother"),
  ],
  ["a sentence as the employer", (r) => (r.employer.normalised_name = "i work for my uncle, cash")],
  [
    "a sentence in capitals as the lender",
    (r) => (r.liabilities[0]!.lender.normalised_name = "SOME GUY I KNOW FROM THE PUB"),
  ],
  [
    "an extra key on the employer",
    (r) => ((r.employer as Record<string, unknown>).abn_note = "see payslip"),
  ],
];

const build = (mutate: (r: Rec) => void): unknown => {
  const r = valid() as Rec;
  mutate(r);
  return r;
};

describe("SIG-61 T4: the truth-capture record", () => {
  it("a valid record passes the validator and the JSON Schema", () => {
    expect(validateTruthCapture(valid())).toEqual({ ok: true, value: valid() });
    expect(schemaValid(valid())).toBe(true);
    const minimal = { ...valid(), liabilities: [] };
    expect(validateTruthCapture(minimal).ok).toBe(true);
  });

  for (const [name, mutate] of INVALID)
    it(`rejects: ${name} (validator and schema agree)`, () => {
      const record = build(mutate);
      expect(validateTruthCapture(record).ok).toBe(false);
      expect(schemaValid(record)).toBe(false);
    });

  it("rejects an unknown field, naming its position and not its text", () => {
    const r = validateTruthCapture({ ...valid(), favourite_colour: "blue" });
    expect(r).toEqual({ ok: false, errors: [{ path: "${key 9}", rule: "unknown_field" }] });
    expect(JSON.stringify(r)).not.toContain("favourite");
  });

  for (const [name, mutate] of FREE_TEXT)
    it(`rejects free text: ${name}`, () => {
      const record = build(mutate);
      expect(validateTruthCapture(record).ok).toBe(false);
      expect(schemaValid(record)).toBe(false);
    });

  it("errors never echo a value", () => {
    const r = validateTruthCapture(build((x) => (x.employer.normalised_name = "Jane's cafe")));
    expect(JSON.stringify(r)).not.toContain("Jane");
  });

  it("the T2 guard blocks a truth record, and its employer field, from any run record", () => {
    expect(guardRunRecord(valid()).ok).toBe(false);
    const reasons = guardRunRecord({ employer: valid().employer }).violations.map((v) => v.reason);
    expect(reasons).toEqual(["identifier_key"]);
  });
});

describe("SIG-61 T4: truths live in the truth_capture store, so deletion removes them", () => {
  it("captureTruth validates, then stores in the truth_capture store only", async () => {
    const truths = new MemoryStore("truth_capture");
    await captureTruth(truths, valid(), "t1");
    expect(await truths.get(REF)).toEqual([valid()]);
    await expect(captureTruth(truths, { ...valid(), notes: "x" }, "t2")).rejects.toThrow(
      /unknown_field/,
    );
    await expect(captureTruth(new MemoryStore("run_inputs"), valid(), "t3")).rejects.toThrow(
      /truth_capture/,
    );
    expect(await truths.count(REF)).toBe(1);
  });

  it("deleteConsumer removes the person's truths with everything else", async () => {
    const stores = STORES.map((n) => new MemoryStore(n));
    const truths = stores.find((s) => s.name === "truth_capture")!;
    await captureTruth(truths, valid(), "t1");
    const receipt = await deleteConsumer(stores, REF, "2026-11-09T02:30:00Z");
    expect(receipt.stores.find((s) => s.store === "truth_capture")).toMatchObject({
      deleted: 1,
      remaining: 0,
    });
    expect(await truths.get(REF)).toEqual([]);
  });
});
