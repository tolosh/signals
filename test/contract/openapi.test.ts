// SIG-10 section 6 tests.
import { readFileSync } from "node:fs";
import { Validator } from "@seriousme/openapi-schema-validator";
import { describe, expect, it } from "vitest";
import { loadContract, schemaValidator } from "./helpers.js";

const doc = loadContract();
const schema = schemaValidator(doc);
const afT1 = () =>
  JSON.parse(readFileSync("test/fixtures/af-t1-assessment.json", "utf8")) as {
    signals: Record<string, unknown>[];
    [key: string]: unknown;
  };

const expand = (prefix: string, rows: string[]) =>
  rows.flatMap((row) => {
    const [methods = "", path = ""] = row.split(" ");
    return methods.split(",").map((m) => `${m} ${prefix}${path}`);
  });

// Build Specification 3.2.
const APP = expand("/v1/app", [
  "get /me",
  "post /workspaces",
  "get /packs",
  "post /checkout",
  "post /billing/portal",
  "get /credits",
  "patch /billing/auto-topup",
  "patch /workspace",
  "post /workspace/logo",
  "get,post /members",
  "patch,delete /members/{id}",
  "get,post /applicants",
  "get,patch,delete /applicants/{id}",
  "post /applicants/{id}/invites",
  "delete /applicants/{id}/invites/{inviteId}",
  "post /applicants/{id}/request-accounts",
  "get,post /applicants/{id}/assessments",
  "get /assessments/{id}",
  "get /assessments/{id}/signals/{signalId}/evidence",
  "get /assessments/{id}/affordability/trace",
  "post /assessments/{id}/notes",
  "patch /notes/{id}",
  "post /assessments/{id}/overrides",
  "get /assessments/{id}/report.pdf",
  "get,put /settings/policy/{product}",
  "get,post /benchmarks",
  "get /benchmarks/template.csv",
  "get /audit",
]);
// Build Specification 3.3.
const PORTAL = [
  ...expand("/v1/portal", [
    "get /{token}",
    "post /{token}/connect",
    "get,put /{token}/financial-position",
    "post /{token}/withdraw",
  ]),
  "get /v1/openfeed/callback",
];
// Build Specification 3.3a.
const ADMIN = expand("/v1/admin", [
  "get /workspaces",
  "get,patch /workspaces/{id}",
  "post /workspaces/{id}/credits",
  "get,patch /launch-offer",
  "post /workspaces/{id}/support-access",
  "get /operations",
  "post /operations/retry/{jobId}",
  "get,post /definitions",
  "get,post /default-thresholds",
  "get,post /seed-benchmark",
  "get /audit",
]);
// Amendment 1, with paths per the SIG-10 ruling of 1 November 2026.
const WATCH = [
  "post /v1/app/watches",
  "delete /v1/app/watches/{id}",
  "get /v1/app/applicants/{id}/timeline",
  "get /v1/portal/{token}/watch",
  "post /v1/portal/{token}/watch",
  "post /v1/portal/{token}/watch/stop",
];

const METHODS = ["get", "post", "put", "patch", "delete"];
type Operation = { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> };
const operations = Object.entries(doc.paths).flatMap(([path, item]) =>
  METHODS.filter((m) => item[m]).map((m) => ({
    key: `${m} ${path}`,
    op: item[m] as Operation,
  })),
);

describe("T1 OpenAPI 3.1 validation", () => {
  it("has no errors at version 1.0.0", async () => {
    const validator = new Validator();
    const result = await validator.validate(doc as never);
    expect(result.errors).toBeUndefined();
    expect(result.valid).toBe(true);
    expect(validator.version).toBe("3.1");
    expect(doc.info.version).toMatch(/^1./);
  });
});

describe("T1 negative control", () => {
  it("the validator rejects a contract with a broken path item", async () => {
    const result = await new Validator().validate({ ...doc, paths: { noSlash: {} } } as never);
    expect(result.valid).toBe(false);
  });
});

describe("T2 every listed endpoint is present, with schemas", () => {
  it.each([...APP, ...PORTAL, ...ADMIN, ...WATCH])("%s", (key) => {
    const found = operations.find((o) => o.key === key);
    expect(found).toBeDefined();
    const responses = Object.entries(found?.op.responses ?? {}).filter(
      ([code]) => code.startsWith("2") || code.startsWith("3"),
    );
    expect(responses.length).toBeGreaterThan(0);
  });
});

describe("T3 AF-T1 assessment", () => {
  it("validates against the Assessment schema", () => {
    expect(schema("Assessment")(afT1()).errors ?? null).toBeNull();
  });

  it("negative control: a signal without evidence_quality is rejected (D12)", () => {
    const fixture = afT1();
    delete fixture.signals[0]?.evidence_quality;
    expect(schema("Assessment")(fixture).valid).toBe(false);
  });

  it("negative control: an unknown state is rejected", () => {
    const fixture = afT1();
    if (fixture.signals[0]) fixture.signals[0].state = "purple";
    expect(schema("Assessment")(fixture).valid).toBe(false);
  });
});

describe("contract rules", () => {
  it("GR-1: no approve or decline anywhere in the contract", () => {
    expect(readFileSync("openapi.yaml", "utf8")).not.toMatch(/approv|declin/i);
  });

  it("D13: state offers evidenced and not_observed, and no coverage-gap signal family", () => {
    const state = doc.components.schemas.SignalState as { enum: string[] };
    expect(state.enum).toEqual(expect.arrayContaining(["evidenced", "not_observed"]));
    expect(JSON.stringify(doc)).not.toContain("COV-");
  });

  it("every JSON field name is snake_case (API-1)", () => {
    const bad: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === "object") {
        const record = node as Record<string, unknown>;
        // A map of HTTP header names (x-http-headers) is not JSON fields; header names keep
        // their HTTP spelling, such as Content-Type.
        if (
          record["x-http-headers"] !== true &&
          record.properties &&
          typeof record.properties === "object"
        ) {
          bad.push(...Object.keys(record.properties).filter((k) => !/^[a-z][a-z0-9_]*$/.test(k)));
        }
        Object.values(record).forEach(walk);
      }
    };
    walk(doc.components.schemas);
    expect(bad).toEqual([]);
  });

  it("only the logo upload's header map is exempt from API-1", () => {
    const exempt: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (node && typeof node === "object") {
        if ((node as Record<string, unknown>)["x-http-headers"] === true) exempt.push(path);
        for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
      }
    };
    walk(doc.components.schemas, "schemas");
    expect(exempt).toEqual(["schemas.LogoUpload.properties.headers"]);
  });
});

// Lovable build follow-ups (SIG-19 comment, 6 November 2026), under SIG-10.
describe("roll-up state is declared where generated clients can see it", () => {
  const ROLLUP = ["green", "amber", "red_refer", "red_knockout", "unverified"];
  type Prop = { enum?: unknown[]; type?: unknown };
  const props = (name: string) =>
    (doc.components.schemas[name] as { properties: Record<string, Prop> }).properties;

  it.each(["Applicant", "AssessmentSummary"])(
    "%s.rollup_state lists every value inline",
    (name) => {
      const field = props(name).rollup_state;
      expect(field?.enum).toEqual([...ROLLUP, null]);
      expect(field?.type).toEqual(["string", "null"]);
    },
  );

  it("GET /v1/app/applicants takes a rollup_state filter with the same values", () => {
    const op = doc.paths["/v1/app/applicants"]?.get as {
      parameters: { name?: string; in?: string; schema?: Prop }[];
    };
    const param = op.parameters.find((p) => p.name === "rollup_state");
    expect(param?.in).toBe("query");
    expect(param?.schema?.enum).toEqual(ROLLUP);
  });

  it("the contract version is bumped for the additive change", () => {
    expect(doc.info.version).toMatch(/^1\.[1-9]/);
  });
});

// Lovable gaps (SIG-19 comment, 7 November 2026), under SIG-10.
describe("auto top-up can be read, and the logo upload is specified", () => {
  type Schema = {
    required?: string[];
    properties?: Record<string, Schema>;
    enum?: unknown[];
    type?: unknown;
    minimum?: number;
    maximum?: number;
    $ref?: string;
    minProperties?: number;
  };
  const schemas = doc.components.schemas as Record<string, Schema>;
  type Op = {
    requestBody?: { content: { "application/json": { schema: Schema } } };
    responses: Record<
      string,
      { $ref?: string; content?: { "application/json": { schema: Schema } } }
    >;
  };
  const op = (path: string, method: string) => doc.paths[path]?.[method] as Op;
  const requestRef = (o: Op) => o.requestBody?.content["application/json"].schema.$ref;
  const responseRef = (o: Op, status: string) =>
    o.responses[status]?.content?.["application/json"].schema.$ref ?? o.responses[status]?.$ref;

  it("GET /v1/app/credits carries an auto_topup block { enabled, pack_id, updated_at }", () => {
    expect(schemas.Credits?.required).toContain("auto_topup");
    expect(schemas.Credits?.properties?.auto_topup?.$ref).toBe("#/components/schemas/AutoTopup");
    expect(schemas.AutoTopup?.required).toEqual(["enabled", "pack_id", "updated_at"]);
    expect(schemas.AutoTopup?.properties?.updated_at?.type).toEqual(["string", "null"]);
  });

  it("PATCH /billing/auto-topup takes an input and returns the same block", () => {
    const patch = op("/v1/app/billing/auto-topup", "patch");
    expect(requestRef(patch)).toBe("#/components/schemas/AutoTopupInput");
    expect(schemas.AutoTopupInput?.required).toEqual(["enabled"]);
    expect(responseRef(patch, "200")).toBe("#/components/schemas/AutoTopup");
    expect(responseRef(patch, "400")).toBe("#/components/responses/Error");
  });

  it("POST /workspace/logo takes { content_type, size_bytes } within PNG, JPEG or SVG and 2 MB", () => {
    const post = op("/v1/app/workspace/logo", "post");
    expect(requestRef(post)).toBe("#/components/schemas/LogoUploadRequest");
    const req = schemas.LogoUploadRequest;
    expect(req?.required).toEqual(["content_type", "size_bytes"]);
    expect(req?.properties?.content_type?.enum).toEqual([
      "image/png",
      "image/jpeg",
      "image/svg+xml",
    ]);
    expect(req?.properties?.size_bytes?.minimum).toBe(1);
    expect(req?.properties?.size_bytes?.maximum).toBe(2 * 1024 * 1024);
    expect(responseRef(post, "400")).toBe("#/components/responses/Error");
  });

  it("returns a presigned PUT: { upload_url, method, headers, expires_at, logo_key }", () => {
    const post = op("/v1/app/workspace/logo", "post");
    expect(responseRef(post, "200")).toBe("#/components/schemas/LogoUpload");
    const res = schemas.LogoUpload;
    expect(res?.required).toEqual(["upload_url", "method", "headers", "expires_at", "logo_key"]);
    expect(res?.properties?.method?.enum).toEqual(["PUT"]);
    expect(res?.properties?.headers?.required).toEqual(["Content-Type"]);
  });

  it("PATCH /workspace takes a partial update with logo_key, and POST /workspaces still needs a name", () => {
    const patch = op("/v1/app/workspace", "patch");
    expect(requestRef(patch)).toBe("#/components/schemas/WorkspaceUpdate");
    expect(schemas.WorkspaceUpdate?.required ?? []).toEqual([]);
    expect(schemas.WorkspaceUpdate?.minProperties).toBe(1);
    expect(schemas.WorkspaceUpdate?.properties?.logo_key?.type).toEqual(["string", "null"]);
    expect(responseRef(patch, "400")).toBe("#/components/responses/Error");
    expect(requestRef(op("/v1/app/workspaces", "post"))).toBe(
      "#/components/schemas/WorkspaceInput",
    );
    expect(schemas.WorkspaceInput?.required).toEqual(["name"]);
  });

  it("is a minor version bump to 1.3.0 (1.2.0 was SIG-39)", () => {
    expect(doc.info.version).toBe("1.3.0");
  });
});
