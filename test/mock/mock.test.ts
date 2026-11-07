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

let server: Server | undefined;
let base: string;
beforeAll(async () => {
  // MOCK_BASE_URL runs the same tests against the hosted mock.
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

  it("differs from the published 3.4 JSON only by the ruled fields (D12, D13, D19, D20)", async () => {
    const res = await get("/v1/app/assessments/asm_01");
    const body = (await res.json()) as {
      signals: Record<string, unknown>[];
      evidence_checks?: unknown;
    };
    delete body.evidence_checks;
    for (const signal of body.signals) {
      delete signal.evidence_quality;
      delete signal.rollup_class;
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
      // Overrides create a real version now; use asm_evidence so apl_01's chain is untouched.
      .replace("/v1/app/assessments/{id}/overrides", "/v1/app/assessments/asm_evidence/overrides")
      .replace("/v1/app/assessments/{id}", "/v1/app/assessments/asm_01")
      .replace("/v1/app/applicants/{id}", "/v1/app/applicants/apl_assessed")
      .replace("/members/{id}", "/members/mem_01")
      .replace("/notes/{id}", "/notes/note_01")
      .replace("/watches/{id}", "/watches/wch_01")
      .replace("{inviteId}", "inv_01")
      .replace("{signalId}", "LIA-01")
      .replace("{jobId}", "job_01");

  // Operations whose request body the mock validates get a valid one.
  const BODIES: Record<string, unknown> = {
    "patch /v1/app/billing/auto-topup": { enabled: false },
    "post /v1/app/workspace/logo": { content_type: "image/png", size_bytes: 1024 },
    "patch /v1/app/workspace": { name: "Harbour Mutual" },
    "post /v1/app/assessments/{id}/overrides": {
      kind: "exclude_one_off_expense",
      target: "txn_holiday",
      value: null,
      reason: "One-off holiday",
    },
    "put /v1/app/settings/policy/{product}": {
      buffer: 3,
      floor_rate: 5.5,
      income_shading: { salary: 1 },
      card_factor: 0.03,
      expense_method: "confirmed",
      ratio_thresholds: {},
    },
    "post /v1/app/benchmarks": readFileSync("test/fixtures/benchmark-valid.csv", "utf8"),
  };
  it.each(ops)("%s %s", async (method, template) => {
    const body = BODIES[`${method} ${template}`];
    const headers = {
      "content-type": typeof body === "string" ? "text/csv" : "application/json",
    };
    const res = await fetch(base + fill(template), {
      method: method.toUpperCase(),
      redirect: "manual",
      ...(body ? { body: typeof body === "string" ? body : JSON.stringify(body), headers } : {}),
    });
    expect(res.status).toBeLessThan(400);
    if (res.headers.get("content-type")?.startsWith("application/json")) {
      const check = validateAgainst(method, template, res.status, await res.json());
      expect(check.errors ?? null).toBeNull();
    }
  });
});

// Lovable build follow-ups (SIG-19 comment, 6 November 2026), under SIG-11.
describe("Lovable fixes", () => {
  it("serves apl_01, the applicant asm_01 points to", async () => {
    const asm = (await (await get("/v1/app/assessments/asm_01")).json()) as {
      applicant_id: string;
    };
    const res = await get(`/v1/app/applicants/${asm.applicant_id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; latest_assessment_id: string; status: string };
    // Since contract 1.5.0 an override creates a new version, so on the long-lived hosted mock the
    // latest may be a later asm_01 version.
    expect(body).toMatchObject({ id: "apl_01", status: "assessed" });
    expect(body.latest_assessment_id).toMatch(/^asm_01(_v\d+)?$/);
    expect(validateAgainst("get", T, res.status, body).errors ?? null).toBeNull();
  });

  it.each(["amber", "unverified"])(
    "filters the applicant list by rollup_state=%s",
    async (state) => {
      const res = await get(`/v1/app/applicants?rollup_state=${state}`);
      const body = (await res.json()) as { items: { rollup_state: string | null }[] };
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items.every((a) => a.rollup_state === state)).toBe(true);
      expect(
        validateAgainst("get", "/v1/app/applicants", res.status, body).errors ?? null,
      ).toBeNull();
    },
  );

  it("filters by status and rollup_state together", async () => {
    const res = await get("/v1/app/applicants?status=watching&rollup_state=amber");
    const body = (await res.json()) as { items: { status: string; rollup_state: string }[] };
    expect(body.items.map((a) => [a.status, a.rollup_state])).toEqual([["watching", "amber"]]);
  });

  it("negative control: an unknown rollup_state is a contract-shaped 400", async () => {
    const res = await get("/v1/app/applicants?rollup_state=red");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_parameter");
    expect(validateAgainst("get", "/v1/app/applicants", 400, body).errors ?? null).toBeNull();
  });
});

// Lovable gaps (SIG-19 comment, 7 November 2026), under SIG-11.
const send = (method: string, path: string, body: unknown) =>
  fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const expectError = async (
  res: Response,
  status: number,
  code: string,
  template: string,
  method: string,
) => {
  expect(res.status).toBe(status);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe(code);
  expect(validateAgainst(method, template, status, body).errors ?? null).toBeNull();
};

describe("auto top-up is readable and echoes what was saved", () => {
  const PATH = "/v1/app/billing/auto-topup";
  type Block = { enabled: boolean; pack_id: string | null; updated_at: string | null };
  const credits = async () =>
    ((await (await get("/v1/app/credits")).json()) as { auto_topup: Block }).auto_topup;

  it("GET /v1/app/credits returns the block", async () => {
    const res = await get("/v1/app/credits");
    const body = (await res.json()) as { auto_topup: Block };
    expect(validateAgainst("get", "/v1/app/credits", 200, body).errors ?? null).toBeNull();
    expect(Object.keys(body.auto_topup).sort()).toEqual(["enabled", "pack_id", "updated_at"]);
  });

  it("PATCH returns the saved block, and GET echoes it back", async () => {
    const on = await send("PATCH", PATH, { enabled: true, pack_id: "pack_100" });
    expect(on.status).toBe(200);
    const saved = (await on.json()) as Block;
    expect(validateAgainst("patch", PATH, 200, saved).errors ?? null).toBeNull();
    expect(saved).toMatchObject({ enabled: true, pack_id: "pack_100" });
    expect(Date.parse(saved.updated_at ?? "")).toBeGreaterThan(Date.now() - 60_000);
    expect(await credits()).toEqual(saved);

    const off = (await (await send("PATCH", PATH, { enabled: false })).json()) as Block;
    expect(off).toMatchObject({ enabled: false, pack_id: "pack_100" });
    expect(await credits()).toEqual(off);
  });

  it("rejects turning it on without a pack, or with an unknown pack", async () => {
    const bad = [{ enabled: true, pack_id: null }, { enabled: true, pack_id: "pack_nope" }, {}];
    for (const body of bad)
      await expectError(await send("PATCH", PATH, body), 400, "invalid_parameter", PATH, "patch");
  });
});

describe("the logo upload flow works end to end", () => {
  const LOGO = "/v1/app/workspace/logo";
  const WS = "/v1/app/workspace";
  type Upload = {
    upload_url: string;
    method: string;
    headers: Record<string, string>;
    expires_at: string;
    logo_key: string;
  };
  // A 1x1 PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const logoUrl = async () =>
    ((await (await get("/v1/app/me")).json()) as { workspace: { logo_url: string | null } })
      .workspace.logo_url;
  const start = async (content_type: string, size_bytes: number) => {
    const res = await send("POST", LOGO, { content_type, size_bytes });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Upload;
    expect(validateAgainst("post", LOGO, 200, body).errors ?? null).toBeNull();
    return body;
  };
  const put = (u: Upload, bytes: Uint8Array, contentType = u.headers["Content-Type"] ?? "") =>
    fetch(u.upload_url, {
      method: u.method,
      headers: { "Content-Type": contentType },
      body: new Uint8Array(bytes),
    });

  it("returns a presigned-style PUT, valid for 10 minutes, on a URL the mock accepts", async () => {
    const u = await start("image/png", png.length);
    expect(u.method).toBe("PUT");
    expect(u.headers).toEqual({ "Content-Type": "image/png" });
    const minutes = (Date.parse(u.expires_at) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(9);
    // A few seconds of tolerance for clock skew between the hosted mock and this machine.
    expect(minutes).toBeLessThanOrEqual(10.1);
    expect(new URL(u.upload_url).origin).toBe(new URL(base).origin);
    expect((await put(u, png)).status).toBe(200);
  });

  it("PUT, then PATCH /workspace { logo_key } sets the logo, which is then served", async () => {
    const u = await start("image/png", png.length);
    expect((await put(u, png)).status).toBe(200);
    const res = await send("PATCH", WS, { logo_key: u.logo_key });
    expect(res.status).toBe(200);
    const ws = (await res.json()) as { logo_url: string | null };
    expect(validateAgainst("patch", WS, 200, ws).errors ?? null).toBeNull();
    expect(ws.logo_url).not.toBeNull();
    expect(await logoUrl()).toBe(ws.logo_url);
    const served = await fetch(ws.logo_url ?? "");
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await served.arrayBuffer()).equals(png)).toBe(true);
  });

  it("rejects a type other than PNG, JPEG or SVG, and anything over 2 MB, with a 400", async () => {
    const bad = [
      { content_type: "image/gif", size_bytes: 100 },
      { content_type: "image/png", size_bytes: 2 * 1024 * 1024 + 1 },
      { content_type: "image/png", size_bytes: 0 },
      {},
    ];
    for (const body of bad)
      await expectError(await send("POST", LOGO, body), 400, "invalid_logo", LOGO, "post");
  });

  it("refuses a PUT whose type or size differs from what was signed, as S3 does", async () => {
    const u = await start("image/png", png.length);
    expect((await put(u, png, "image/jpeg")).status).toBe(403);
    expect((await put(u, new Uint8Array([...png, 0]))).status).toBe(403);
    const forged = { ...u, upload_url: u.upload_url.replace(/sig=[^&]+/, "sig=forged") };
    expect((await put(forged, png)).status).toBe(403);
  });

  it("negative control: a logo_key never uploaded is a 400, and the logo is unchanged", async () => {
    const before = await logoUrl();
    const u = await start("image/png", png.length);
    for (const logo_key of [u.logo_key, "wks_01/logo/made-up"])
      await expectError(
        await send("PATCH", WS, { logo_key }),
        400,
        "logo_not_uploaded",
        WS,
        "patch",
      );
    expect(await logoUrl()).toBe(before);
  });

  it("treats SVG as untrusted: it is served re-rendered as PNG, never as SVG", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const u = await start("image/svg+xml", svg.length);
    expect((await put(u, svg)).status).toBe(200);
    const res = await send("PATCH", WS, { logo_key: u.logo_key });
    const ws = (await res.json()) as { logo_url: string };
    const served = await fetch(ws.logo_url);
    expect(served.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await served.arrayBuffer());
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(bytes.toString("latin1")).not.toContain("<script");
  });
});
