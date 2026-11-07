// SIG-48 T6 on the mock, and the request fixtures SIG-49 builds against. Runs against the local
// server, or the hosted mock with npm run test:hosted (each test starts from POST /mock-reset/requests).
import "./scenario.js";
import type { Server } from "node:http";
import { hostedBase } from "./target.js";
import type { AddressInfo } from "node:net";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMockServer } from "../../src/mock/server.js";
import { loadContract } from "../contract/helpers.js";

const doc = loadContract();
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(doc as object, "openapi");

let server: Server | undefined;
let base: string;
beforeAll(async () => {
  const hosted = hostedBase();
  if (hosted) {
    base = hosted;
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
beforeEach(async () => {
  expect((await fetch(`${base}/mock-reset/requests`, { method: "POST" })).status).toBe(204);
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
const post = (path: string, body?: unknown) =>
  fetch(base + path, {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });

type Req = {
  id: string;
  status: string;
  applicant_id: string;
  response: { note: string | null } | null;
};
const PORTAL = "/v1/portal/{token}/requests";
const APP = "/v1/app/applicants/{id}/requests";

describe("T6 the request endpoints on the mock validate against the contract", () => {
  it("the portal lists apl_02's open income_not_found request (EQ-01 failed)", async () => {
    const res = await get("/v1/portal/tok_01/requests");
    const body = (await res.json()) as { items: Req[] };
    expect(valid("get", PORTAL, 200, body)).toBeNull();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ status: "open", applicant_id: "apl_02" });
  });

  it("explain records the reason and note; the lender sees it as explained", async () => {
    const [req] = ((await (await get("/v1/portal/tok_01/requests")).json()) as { items: Req[] })
      .items;
    const res = await post(`/v1/portal/tok_01/requests/${req?.id ?? ""}/explain`, {
      reason_code: "new_job_no_pay_yet",
      note: "Started on 1 November; first pay is on the 15th",
    });
    expect(res.status).toBe(200);
    const explained = (await res.json()) as Req;
    expect(
      valid("post", "/v1/portal/{token}/requests/{requestId}/explain", 200, explained),
    ).toBeNull();
    expect(explained.status).toBe("explained");
    const lender = (await (await get("/v1/app/applicants/apl_02/requests")).json()) as {
      items: Req[];
    };
    expect(valid("get", APP, 200, lender)).toBeNull();
    expect(lender.items[0]?.status).toBe("explained");
    expect(lender.items[0]?.response?.note).toBe("Started on 1 November; first pay is on the 15th");
    // An explained request is no longer open, so the portal step goes away.
    const portal = (await (await get("/v1/portal/tok_01/requests")).json()) as { items: Req[] };
    expect(portal.items).toEqual([]);
  });

  it("an unknown reason code is a 400 in the contract's error shape", async () => {
    const [req] = ((await (await get("/v1/portal/tok_01/requests")).json()) as { items: Req[] })
      .items;
    const res = await post(`/v1/portal/tok_01/requests/${req?.id ?? ""}/explain`, {
      reason_code: "lottery",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_parameter");
  });

  it("connect returns the openfeed URL and marks the request connected", async () => {
    const [req] = ((await (await get("/v1/portal/tok_01/requests")).json()) as { items: Req[] })
      .items;
    const res = await post(`/v1/portal/tok_01/requests/${req?.id ?? ""}/connect`);
    expect(res.status).toBe(200);
    expect(
      valid("post", "/v1/portal/{token}/requests/{requestId}/connect", 200, await res.json()),
    ).toBeNull();
    const lender = (await (await get("/v1/app/applicants/apl_02/requests")).json()) as {
      items: Req[];
    };
    expect(lender.items[0]?.status).toBe("connected");
  });

  it("the lender can resend and close", async () => {
    const [req] = (
      (await (await get("/v1/app/applicants/apl_02/requests")).json()) as { items: Req[] }
    ).items;
    const resent = await post(`/v1/app/applicants/apl_02/requests/${req?.id ?? ""}/resend`);
    expect(
      valid(
        "post",
        "/v1/app/applicants/{id}/requests/{requestId}/resend",
        200,
        await resent.json(),
      ),
    ).toBeNull();
    const closed = (await (
      await post(`/v1/app/applicants/apl_02/requests/${req?.id ?? ""}/close`)
    ).json()) as Req;
    expect(closed.status).toBe("closed");
  });

  it("an unknown request is a 404", async () => {
    expect((await post("/v1/app/applicants/apl_02/requests/req_nope/close")).status).toBe(404);
  });
});

describe("request fixtures for SIG-49, one per status", () => {
  it.each(["open", "connected", "explained", "resolved", "closed"])("%s", async (status) => {
    const res = await get("/v1/app/applicants/apl_02/requests", { prefer: `example=${status}` });
    const body = (await res.json()) as { items: Req[] };
    expect(valid("get", APP, 200, body)).toBeNull();
    expect(body.items.map((i) => i.status)).toEqual([status]);
  });
});

describe("T7 negative control on the mock: apl_01 (salary shared) has no request", () => {
  it("lists none", async () => {
    const body = (await (await get("/v1/app/applicants/apl_01/requests")).json()) as {
      items: Req[];
    };
    expect(body.items).toEqual([]);
  });
});
