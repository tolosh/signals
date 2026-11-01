// SIG-11 section 6 tests, run against the real HTTP server on an ephemeral port.
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

let server: Server;
let base: string;
beforeAll(async () => {
  server = createMockServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  server.closeAllConnections();
});

const readJson = (path: string) =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(base + path, { headers, redirect: "manual" });

function validateAgainst(method: string, template: string, status: number, body: unknown) {
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
  return { valid: validate(body), errors: validate.errors };
}

describe("T1 AF-T1 assessment", () => {
  it("GET /v1/app/assessments/asm_01 equals the fixture for the new Build Spec 3.4 version", async () => {
    const res = await get("/v1/app/assessments/asm_01");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual(readJson("test/fixtures/af-t1-assessment.json"));
  });

  it("differs from the published 3.4 JSON only by the ruled signal fields", async () => {
    const res = await get("/v1/app/assessments/asm_01");
    const body = (await res.json()) as { signals: Record<string, unknown>[] };
    for (const signal of body.signals) {
      delete signal.evidence_quality;
      signal.family = signal.family_code;
      delete signal.family_code;
    }
    expect(body).toStrictEqual(readJson("test/fixtures/af-t1-build-spec-original.json"));
  });
});

const T = "/v1/app/applicants/{id}";
const ASM = "/v1/app/assessments/{id}";
const EV = `${ASM}/signals/{signalId}/evidence`;

describe("T2 each listed fixture is returned and validates", () => {
  it.each(["invited", "connecting", "syncing", "assessed", "closed", "connected", "watching"])(
    "applicant at status %s",
    async (status) => {
      const res = await get(`/v1/app/applicants/apl_${status}`);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe(status);
      expect(validateAgainst("get", T, res.status, body).errors ?? null).toBeNull();
    },
  );

  it("roll-up unverified, salary account not shared", async () => {
    const res = await get("/v1/app/assessments/asm_unverified");
    const body = (await res.json()) as {
      rollup: { state: string };
      signals: { evidence_quality: { completeness: { primary_income_account_shared: boolean } } }[];
    };
    expect(body.rollup.state).toBe("unverified");
    expect(body.signals[0]?.evidence_quality.completeness.primary_income_account_shared).toBe(
      false,
    );
    expect(validateAgainst("get", ASM, res.status, body).errors ?? null).toBeNull();
  });

  it("assessment data_incomplete, with no ratios", async () => {
    const res = await get("/v1/app/assessments/asm_incomplete");
    const body = (await res.json()) as { status: string; affordability: unknown };
    expect(body.status).toBe("data_incomplete");
    expect(body.affordability).toBeNull();
    expect(validateAgainst("get", ASM, res.status, body).errors ?? null).toBeNull();
  });

  it("workspace on the seed benchmark", async () => {
    const res = await get("/v1/app/me", { Prefer: "example=seed_benchmark" });
    const body = (await res.json()) as {
      workspace: { on_seed_benchmark: boolean };
      banners: { code: string }[];
    };
    expect(body.workspace.on_seed_benchmark).toBe(true);
    expect(body.banners.map((b) => b.code)).toContain("seed_benchmark");
    expect(validateAgainst("get", "/v1/app/me", res.status, body).errors ?? null).toBeNull();
  });

  it("workspace with zero credits", async () => {
    const res = await get("/v1/app/me", { Prefer: "example=zero_credits" });
    const body = (await res.json()) as { credit_balance: number };
    expect(body.credit_balance).toBe(0);
    expect(validateAgainst("get", "/v1/app/me", res.status, body).errors ?? null).toBeNull();
  });

  it.each([
    ["LIQ-02", 0],
    ["LIA-01", 1],
    ["LIA-05", 50],
  ])("evidence list for %s has %i transactions", async (signal, count) => {
    const res = await get(`/v1/app/assessments/asm_evidence/signals/${signal}/evidence`);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(count);
    expect(validateAgainst("get", EV, res.status, body).errors ?? null).toBeNull();
  });
});

describe("T3 unknown ID", () => {
  it.each([
    ["GET", "/v1/app/assessments/nope", ASM],
    ["GET", "/v1/app/applicants/nope", T],
    ["GET", "/v1/portal/nope", "/v1/portal/{token}"],
    ["GET", "/v1/app/assessments/asm_01/signals/NOPE/evidence", EV],
  ])("%s %s returns a contract-shaped error", async (method, path, template) => {
    const res = await fetch(base + path, { method });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
    expect(
      validateAgainst(method.toLowerCase(), template, res.status, body).errors ?? null,
    ).toBeNull();
  });

  it("negative control: the error schema rejects a success body", async () => {
    const res = await get("/v1/app/assessments/asm_01");
    expect(validateAgainst("get", ASM, 404, await res.json()).valid).toBe(false);
  });
});

describe("every operation in the contract is served and validates", () => {
  const METHODS = ["get", "post", "put", "patch", "delete"];
  const ops = Object.entries(doc.paths).flatMap(([path, item]) =>
    METHODS.filter((m) => item[m]).map((m) => [m, path] as const),
  );
  const fill = (template: string) =>
    template
      .replace("/v1/portal/{token}", "/v1/portal/tok_01")
      .replace("/settings/policy/{product}", "/settings/policy/home")
      .replace("/v1/admin/workspaces/{id}", "/v1/admin/workspaces/wks_01")
      .replace("/v1/app/assessments/{id}", "/v1/app/assessments/asm_01")
      .replace("/v1/app/applicants/{id}", "/v1/app/applicants/apl_assessed")
      .replace("/members/{id}", "/members/mem_01")
      .replace("/notes/{id}", "/notes/note_01")
      .replace("/watches/{id}", "/watches/wch_01")
      .replace("{inviteId}", "inv_01")
      .replace("{signalId}", "LIA-01")
      .replace("{jobId}", "job_01");

  it.each(ops)("%s %s", async (method, template) => {
    const res = await fetch(base + fill(template), {
      method: method.toUpperCase(),
      redirect: "manual",
    });
    expect(res.status).toBeLessThan(400);
    if (res.headers.get("content-type")?.startsWith("application/json")) {
      const check = validateAgainst(method, template, res.status, await res.json());
      expect(check.errors ?? null).toBeNull();
    }
  });
});
