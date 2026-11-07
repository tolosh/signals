// Lovable M3 gaps (SIG-19 comment, 7 November 2026, 12:05), under SIG-11: the mock keeps state
// for policy saves, overrides and benchmark uploads; validates benchmark CSVs with row-level
// errors; and serves version-switching and revoked-grant fixtures. Runs against the local server,
// or the hosted mock with MOCK_BASE_URL.
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockServer } from "../../src/mock/server.js";
import { loadContract } from "../contract/helpers.js";

const doc = loadContract();
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(doc as object, "openapi");

let server: Server | undefined;
let base: string;
beforeAll(async () => {
  if (process.env.MOCK_BASE_URL) {
    base = process.env.MOCK_BASE_URL;
    return;
  }
  server = createMockServer();
  const local = server;
  await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(local.address() as AddressInfo).port}`;
});
afterAll(() => {
  server?.close();
  server?.closeAllConnections();
});

function valid(method: string, template: string, status: number, body: unknown) {
  const op = doc.paths[template]?.[method] as {
    responses: Record<string, { $ref?: string; content?: Record<string, unknown> }>;
  };
  const response = op.responses[String(status)] ?? op.responses.default;
  const ref = response?.$ref?.split("/").pop();
  const escaped = template.replaceAll("~", "~0").replaceAll("/", "~1");
  const pointer = ref
    ? `openapi#/components/responses/${ref}/content/application~1json/schema`
    : `openapi#/paths/${encodeURIComponent(escaped)}/${method}/responses/${status}/content/application~1json/schema`;
  const validate = ajv.compile({ $ref: pointer });
  return validate(body) ? null : validate.errors;
}
const get = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers });
const json = (method: string, path: string, body: unknown) =>
  fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const POLICY = "/v1/app/settings/policy/{product}";
const VERSIONS = "/v1/app/settings/policy/{product}/versions";
type Option = {
  key: string;
  label: string;
  description: string;
  requires: string[];
  available: boolean;
  unavailable_reason: string | null;
};
type Policy = { version: number; buffer: number; expense_method_options: Option[] };

describe("1. expense-method options on the policy (D26)", () => {
  it("lists every method with what it requires", async () => {
    const res = await get("/v1/app/settings/policy/home");
    const body = (await res.json()) as Policy;
    expect(valid("get", POLICY, 200, body)).toBeNull();
    expect(body.expense_method_options.map((o) => o.key)).toEqual([
      "highest_of_confirmed_benchmark_observed",
      "confirmed",
      "benchmark",
      "observed",
      "higher_of_confirmed_benchmark",
    ]);
    const byKey = Object.fromEntries(body.expense_method_options.map((o) => [o.key, o]));
    expect(byKey.observed?.requires).toEqual(["observed_expenses"]);
    expect(byKey.confirmed?.requires).toEqual(["confirmed_expenses"]);
  });

  it("marks methods needing observed expenses unavailable, with the reason, until SIG-17 and SIG-43", async () => {
    const body = (await (await get("/v1/app/settings/policy/home")).json()) as Policy;
    for (const o of body.expense_method_options) {
      const needsObserved = o.requires.includes("observed_expenses");
      expect(o.available).toBe(!needsObserved);
      if (needsObserved) expect(o.unavailable_reason).toMatch(/SIG-17.*SIG-43/);
      else expect(o.unavailable_reason).toBeNull();
    }
  });
});

describe("2 and 3. policy history, and a save that GET then returns", () => {
  it("a save creates the next version; GET returns it; history lists it with what changed", async () => {
    const before = (await (await get("/v1/app/settings/policy/home")).json()) as Policy & {
      [k: string]: unknown;
    };
    const { expense_method_options: _, product: __, version: ___, ...input } = before;
    const res = await json("PUT", "/v1/app/settings/policy/home", { ...input, buffer: 3.5 });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as Policy;
    expect(valid("put", POLICY, 200, saved)).toBeNull();
    expect(saved.version).toBe(before.version + 1);
    expect(saved.buffer).toBe(3.5);

    const after = (await (await get("/v1/app/settings/policy/home")).json()) as Policy;
    expect(after.version).toBe(saved.version);
    expect(after.buffer).toBe(3.5);

    const history = await get("/v1/app/settings/policy/home/versions");
    const page = (await history.json()) as {
      items: {
        version: number;
        author: string;
        created_at: string;
        summary: string;
        changes: unknown[];
      }[];
    };
    expect(valid("get", VERSIONS, 200, page)).toBeNull();
    const latest = page.items[0];
    expect(latest?.version).toBe(saved.version);
    expect(latest?.summary).toMatch(/buffer 3 → 3\.5/);
    expect(latest?.changes).toEqual([{ field: "buffer", from: 3, to: 3.5 }]);
    expect(page.items.at(-1)?.version).toBe(1);
  });

  it("negative control: another product's policy is unchanged", async () => {
    const car = (await (await get("/v1/app/settings/policy/car")).json()) as Policy;
    expect(car.version).toBe(1);
  });
});

describe("5. fixtures: asm_01 versions 1 and 2, and a revoked grant", () => {
  const ASM = "/v1/app/assessments/{id}";
  it("apl_01 lists asm_01 version 1 and version 2, and version 2 differs", async () => {
    const list = (await (await get("/v1/app/applicants/apl_01/assessments")).json()) as {
      items: { id: string; version: number }[];
    };
    expect(list.items.slice(0, 2).map((i) => [i.id, i.version])).toEqual([
      ["asm_01", 1],
      ["asm_01_v2", 2],
    ]);
    const v2 = (await (await get("/v1/app/assessments/asm_01_v2")).json()) as {
      version: number;
      applicant_id: string;
      affordability: { serviceability: { monthly_expenses_gle: number } };
    };
    expect(valid("get", ASM, 200, v2)).toBeNull();
    expect(v2).toMatchObject({ version: 2, applicant_id: "apl_01" });
    expect(v2.affordability.serviceability.monthly_expenses_gle).toBe(3500);
  });

  it("apl_03 has a revoked grant and an assessment", async () => {
    const apl = (await (await get("/v1/app/applicants/apl_03")).json()) as {
      grant_revoked: boolean;
      latest_assessment_id: string;
    };
    expect(apl.grant_revoked).toBe(true);
    const asm = await get(`/v1/app/assessments/${apl.latest_assessment_id}`);
    expect(asm.status).toBe(200);
    expect(((await asm.json()) as { applicant_id: string }).applicant_id).toBe("apl_03");
  });
});

describe("3. an override creates a new assessment version that GET returns", () => {
  it("POST overrides on asm_01 returns version 3; GET and the applicant's list show it", async () => {
    const res = await json("POST", "/v1/app/assessments/asm_01/overrides", {
      kind: "correct_stated_figure",
      target: "confirmed_monthly",
      value: 3600,
      reason: "Applicant confirmed higher living costs",
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; version: number };
    expect(valid("post", "/v1/app/assessments/{id}/overrides", 201, created)).toBeNull();
    expect(created.version).toBe(3);
    const asm = (await (await get(`/v1/app/assessments/${created.id}`)).json()) as {
      version: number;
      affordability: { serviceability: { monthly_expenses_gle: number } };
    };
    expect(asm.version).toBe(3);
    expect(asm.affordability.serviceability.monthly_expenses_gle).toBe(3600);
    const list = (await (await get("/v1/app/applicants/apl_01/assessments")).json()) as {
      items: { version: number }[];
    };
    expect(list.items.map((i) => i.version)).toEqual([1, 2, 3]);
  });

  it("an override without a reason is a 400", async () => {
    const res = await json("POST", "/v1/app/assessments/asm_01/overrides", {
      kind: "correct_stated_figure",
      target: "confirmed_monthly",
      value: 1,
    });
    expect(res.status).toBe(400);
  });
});

describe("3 and 4. benchmark uploads: validated, then listed", () => {
  const csv = (name: string) => readFileSync(`test/fixtures/${name}`, "utf8");
  const upload = (body: string) =>
    fetch(`${base}/v1/app/benchmarks`, {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body,
    });

  it("an invalid CSV is a 400 with row-level errors in the contract's shape", async () => {
    const res = await upload(csv("benchmark-invalid.csv"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: {
        code: string;
        details: { rows: { row: number | null; column: string | null; code: string }[] };
      };
    };
    expect(valid("post", "/v1/app/benchmarks", 400, body)).toBeNull();
    expect(body.error.code).toBe("invalid_benchmark");
    expect(
      body.error.details.rows.filter((r) => r.row !== null).map((r) => [r.row, r.column]),
    ).toEqual([
      [3, "monthly_amount"],
      [7, "household_type"],
      [8, "location"],
      [9, "dependants"],
    ]);
    expect(body.error.details.rows.some((r) => r.code === "incomplete_coverage")).toBe(true);
  });

  it("the invalid fixture is also served as a template variant, for the UI", async () => {
    const res = await get("/v1/app/benchmarks/template.csv", { prefer: "example=invalid" });
    expect(await res.text()).toBe(csv("benchmark-invalid.csv"));
  });

  it("a valid CSV creates the next version, which GET lists", async () => {
    const before = (await (await get("/v1/app/benchmarks")).json()) as {
      items: { version: number }[];
    };
    const res = await upload(csv("benchmark-valid.csv"));
    expect(res.status).toBe(201);
    const created = (await res.json()) as { version: number; source: string };
    expect(valid("post", "/v1/app/benchmarks", 201, created)).toBeNull();
    expect(created.source).toBe("lender_upload");
    const after = (await (await get("/v1/app/benchmarks")).json()) as {
      items: { version: number }[];
    };
    expect(after.items).toHaveLength(before.items.length + 1);
    expect(after.items.at(-1)?.version).toBe(created.version);
  });

  it("negative control: an invalid upload adds no version", async () => {
    const before = (await (await get("/v1/app/benchmarks")).json()) as { items: unknown[] };
    await upload(csv("benchmark-invalid.csv"));
    const after = (await (await get("/v1/app/benchmarks")).json()) as { items: unknown[] };
    expect(after.items).toHaveLength(before.items.length);
  });
});
