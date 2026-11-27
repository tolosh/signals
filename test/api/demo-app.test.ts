// SIG-82 candidate 0 (rulings 40775, 1 and 40777; Lovable's audit, 40782): the demo application
// layer serves the contract's /v1/app and /v1/portal workflow on the mock's routing approach and
// state store, with:
//   - a verified Supabase sign-in on every /v1/app call, scoped to the demo workspace it maps to;
//   - T5: tenant B gets 404 on tenant A's resources;
//   - the assessment endpoints returning a labelled 501 (no fixture, SIG-76 T4);
//   - CORS for the three Lovable origins only;
//   - demo workspaces A and B, seeded with credits and the AF-T1 policy (11.5%, 3% buffer, 5.5%
//     floor, expense method observed);
//   - a labelled HTTPS sandbox-consent page that returns to /connect/:token/progress, the step
//     advancing progress, finances, done.
// Every JSON response is checked against openapi.yaml.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoApp, type DemoRequest, type DemoResponse } from "../../src/api/app.js";
import { NOT_WIRED } from "../../src/api/assessment-port.js";
import { demoConfigFrom, DEMO_ORIGINS } from "../../src/api/config.js";
import { DEMO_PRODUCT, DEMO_WORKSPACES, SANDBOX_SCENARIOS } from "../../src/api/seed.js";
import { DemoStore } from "../../src/api/store.js";
import { MemoryStore } from "../../src/mock/persist.js";
import { responseValidator } from "./contract.js";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const HOST = "abc123.execute-api.ap-southeast-2.amazonaws.com";
const CUSTOM = "https://signals-launchpad.moroku.digital";
const LOVABLE = "https://moroku-signals.lovable.app";
const PREVIEW = "https://id-preview--7bb65be2-4f2d-46a9-97ef-1039aace98ee.lovable.app";
const TOKENS: Record<string, { sub: string; email: string }> = {
  "token-a": { sub: "user-a", email: "a@demo.test" },
  "token-b": { sub: "user-b", email: "B@Demo.test" },
  "token-stranger": { sub: "user-x", email: "x@demo.test" },
};

let clock = 1_800_000_000_000;
let rows: MemoryStore;
let logs: string[];
const bodies: string[] = [];
const config = () =>
  demoConfigFrom({
    ENRICH_PATH: "local",
    DEMO_COMMIT: COMMIT,
    STAGE: "demo",
    SUPABASE_URL: "https://abcdefgh.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    DEMO_MEMBERS: "a@demo.test:A, b@demo.test:B",
  });
const appOn = (store: MemoryStore) =>
  createDemoApp({
    config: config(),
    store: new DemoStore(store),
    verify: (t) => Promise.resolve(TOKENS[t] ?? null),
    now: () => clock,
    assessments: NOT_WIRED,
  });
let app: ReturnType<typeof createDemoApp>;

beforeEach(() => {
  rows = new MemoryStore();
  app = appOn(rows);
  logs = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    });
});
afterEach(() => {
  for (const line of logs) for (const t of Object.keys(TOKENS)) expect(line).not.toContain(t);
  vi.restoreAllMocks();
});

async function call(
  method: string,
  path: string,
  o: { token?: string; origin?: string; body?: unknown; form?: string; query?: string } = {},
): Promise<DemoResponse & { json: unknown }> {
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.origin) headers.origin = o.origin;
  let body: string | undefined;
  if (o.form !== undefined) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = o.form;
  } else if (o.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(o.body);
  }
  const req: DemoRequest = {
    method,
    path,
    query: o.query ?? "",
    headers,
    host: HOST,
    ...(body ? { body } : {}),
  };
  const res = await app(req);
  bodies.push(res.body);
  let json: unknown = undefined;
  if ((res.headers["content-type"] ?? "").includes("application/json")) json = JSON.parse(res.body);
  return { ...res, json };
}
const valid = (template: string, method: string, res: { status: number; json: unknown }) => {
  const v = responseValidator(template, method, res.status)(res.json);
  expect(v.errors ?? null).toBeNull();
};
const createApplicant = async (token = "token-a", name = "Scenario applicant") => {
  const res = await call("POST", "/v1/app/applicants", {
    token,
    body: {
      name,
      email: null,
      product_type: "personal",
      loan_request: { loan_amount: 20000, term_months: 60, purpose: "Car", security_value: null },
    },
  });
  expect(res.status).toBe(201);
  valid("/v1/app/applicants", "post", res);
  return res.json as { id: string; status: string };
};
const invite = async (id: string, origin = CUSTOM) => {
  const res = await call("POST", `/v1/app/applicants/${id}/invites`, {
    token: "token-a",
    origin,
    body: { channel: "email" },
  });
  expect(res.status).toBe(201);
  valid("/v1/app/applicants/{id}/invites", "post", res);
  const url = (res.json as { portal_url: string }).portal_url;
  return { url, token: url.split("/connect/")[1] as string };
};

describe("health", () => {
  it("GET /health reads back the commit, with no sign-in", async () => {
    const res = await call("GET", "/health");
    expect(res.status).toBe(200);
    expect((res.json as { commit: string }).commit).toBe(COMMIT);
  });
});

describe("CORS for the three Lovable origins only", () => {
  it("lists exactly the demo's origins", () => {
    expect([...DEMO_ORIGINS].sort()).toEqual([CUSTOM, LOVABLE, PREVIEW].sort());
  });

  it.each([CUSTOM, LOVABLE, PREVIEW])("answers the preflight from %s", async (origin) => {
    const res = await call("OPTIONS", "/v1/app/me", { origin });
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(origin);
    expect(res.headers["access-control-allow-headers"]).toMatch(/authorization/);
    expect(res.headers.vary).toMatch(/origin/i);
  });

  it("gives no other origin access", async () => {
    for (const origin of [
      "https://evil.example",
      "http://signals-launchpad.moroku.digital",
      "null",
    ]) {
      const res = await call("OPTIONS", "/v1/app/me", { origin });
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
      const get = await call("GET", "/v1/app/me", { origin, token: "token-a" });
      expect(get.headers["access-control-allow-origin"]).toBeUndefined();
    }
  });

  it("allows the origin on ordinary responses too", async () => {
    const res = await call("GET", "/v1/app/me", { origin: LOVABLE, token: "token-a" });
    expect(res.headers["access-control-allow-origin"]).toBe(LOVABLE);
  });
});

describe("sign-in on every /v1/app call", () => {
  it("refuses a call with no token, or a token that doesn't verify", async () => {
    for (const token of [undefined, "forged"]) {
      const res = await call("GET", "/v1/app/me", token ? { token } : {});
      expect(res.status).toBe(401);
      valid("/v1/app/me", "get", res);
    }
  });

  it("refuses a verified user who belongs to no demo workspace", async () => {
    const res = await call("GET", "/v1/app/applicants", { token: "token-stranger" });
    expect(res.status).toBe(403);
    expect((res.json as { error: { code: string } }).error.code).toBe("not_a_demo_member");
  });

  it("maps each member to their workspace, by email, case-insensitively", async () => {
    const a = await call("GET", "/v1/app/me", { token: "token-a" });
    const b = await call("GET", "/v1/app/me", { token: "token-b" });
    valid("/v1/app/me", "get", a);
    expect((a.json as { workspace: { id: string } }).workspace.id).toBe(DEMO_WORKSPACES.A.id);
    expect((b.json as { workspace: { id: string } }).workspace.id).toBe(DEMO_WORKSPACES.B.id);
    expect((a.json as { user: { id: string } }).user.id).toBe("user-a");
  });
});

describe("demo workspaces A and B: credits and the seeded policy", () => {
  it("seeds credits, so the app is never stuck behind checkout", async () => {
    const me = await call("GET", "/v1/app/me", { token: "token-a" });
    expect((me.json as { credit_balance: number }).credit_balance).toBeGreaterThan(0);
    const credits = await call("GET", "/v1/app/credits", { token: "token-a" });
    expect(credits.status).toBe(200);
    valid("/v1/app/credits", "get", credits);
    expect((credits.json as { balance: number }).balance).toBe(DEMO_WORKSPACES.A.credits);
  });

  it("labels the stage on the user's banners", async () => {
    const me = await call("GET", "/v1/app/me", { token: "token-a" });
    const banners = (me.json as { banners: { code: string; message: string }[] }).banners;
    expect(banners.some((b) => b.code === "demo_stage" && /synthetic/i.test(b.message))).toBe(true);
  });

  it("serves the AF-T1 policy: 3% buffer, 5.5% floor, card factor 0.03, expense method observed", async () => {
    const res = await call("GET", "/v1/app/settings/policy/personal", { token: "token-a" });
    expect(res.status).toBe(200);
    valid("/v1/app/settings/policy/{product}", "get", res);
    expect(res.json).toMatchObject({
      product: "personal",
      buffer: 3,
      floor_rate: 5.5,
      card_factor: 0.03,
      expense_method: "observed",
    });
  });

  it("holds the 11.5% product rate and AF-T1 server-side, since the UI has no rate field", () => {
    expect(DEMO_PRODUCT).toMatchObject({
      product_type: "personal",
      product_rate_pct: 11.5,
      policy: "AF-T1",
    });
    expect(DEMO_PRODUCT.policy_detail).toMatchObject({
      buffer_pct: 3,
      floor_rate_pct: 5.5,
      card_commitment_factor: 0.03,
      expense_method: "observed",
    });
  });
});

describe("the applicant workflow", () => {
  it("creates, lists, reads and edits an applicant in the caller's workspace", async () => {
    const created = await createApplicant();
    expect(created.status).toBe("invited");
    const list = await call("GET", "/v1/app/applicants", { token: "token-a" });
    valid("/v1/app/applicants", "get", list);
    expect((list.json as { items: { id: string }[] }).items.map((i) => i.id)).toContain(created.id);
    const got = await call("GET", `/v1/app/applicants/${created.id}`, { token: "token-a" });
    valid("/v1/app/applicants/{id}", "get", got);
    const patched = await call("PATCH", `/v1/app/applicants/${created.id}`, {
      token: "token-a",
      body: { loan_amount: 25000, term_months: 48 },
    });
    expect(patched.status).toBe(200);
    expect(
      (patched.json as { loan_request: { loan_amount: number } }).loan_request.loan_amount,
    ).toBe(25000);
  });

  it("refuses an applicant without a name or product type", async () => {
    const res = await call("POST", "/v1/app/applicants", { token: "token-a", body: { name: "" } });
    expect(res.status).toBe(400);
  });

  it("keeps state across instances on the same store (a cold Lambda)", async () => {
    const created = await createApplicant();
    app = appOn(rows);
    const got = await call("GET", `/v1/app/applicants/${created.id}`, { token: "token-a" });
    expect(got.status).toBe(200);
  });

  it("an invite carries the portal link on the caller's Lovable origin, over HTTPS", async () => {
    const created = await createApplicant();
    const { url } = await invite(created.id, PREVIEW);
    expect(url).toMatch(new RegExp(`^${PREVIEW.replace(/[.]/g, "\\.")}/connect/tok_[a-z0-9]{32}$`));
    const fallback = await invite(created.id, "https://evil.example");
    expect(fallback.url.startsWith(`${CUSTOM}/connect/`)).toBe(true);
  });
});

describe("T5: tenant B gets 404 on tenant A's resources", () => {
  it("can't see, read, edit, close, invite or assess A's applicant", async () => {
    const a = await createApplicant("token-a", "Tenant A applicant");
    const list = await call("GET", "/v1/app/applicants", { token: "token-b" });
    expect((list.json as { items: { id: string }[] }).items.map((i) => i.id)).not.toContain(a.id);
    const attempts: [string, string, unknown?][] = [
      ["GET", `/v1/app/applicants/${a.id}`],
      ["PATCH", `/v1/app/applicants/${a.id}`, { loan_amount: 1 }],
      ["DELETE", `/v1/app/applicants/${a.id}`],
      ["POST", `/v1/app/applicants/${a.id}/invites`, { channel: "email" }],
      ["GET", `/v1/app/applicants/${a.id}/assessments`],
      ["POST", `/v1/app/applicants/${a.id}/assessments`],
      ["GET", `/v1/app/applicants/${a.id}/requests`],
      ["GET", `/v1/app/applicants/${a.id}/timeline`],
    ];
    for (const [method, path, body] of attempts) {
      const res = await call(method, path, { token: "token-b", ...(body ? { body } : {}) });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect((res.json as { error: { code: string } }).error.code).toBe("not_found");
    }
    const still = await call("GET", `/v1/app/applicants/${a.id}`, { token: "token-a" });
    expect(still.status).toBe(200);
  });

  it("stores each workspace's records under its own partition", async () => {
    const a = await createApplicant("token-a");
    const keys = rows.items().filter((i) => i.sk.includes(a.id));
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k.pk).toBe(`ws#${DEMO_WORKSPACES.A.id}`);
  });
});

describe("the applicant portal and the sandbox consent", () => {
  it("walks welcome, progress, finances, done", async () => {
    const a = await createApplicant();
    const { token } = await invite(a.id);
    const s0 = await call("GET", `/v1/portal/${token}`);
    expect(s0.status).toBe(200);
    valid("/v1/portal/{token}", "get", s0);
    expect(s0.json).toMatchObject({ step: "welcome", lender_name: DEMO_WORKSPACES.A.name });

    const connect = await call("POST", `/v1/portal/${token}/connect`, { origin: LOVABLE });
    expect(connect.status).toBe(200);
    valid("/v1/portal/{token}/connect", "post", connect);
    const consentUrl = (connect.json as { url: string }).url;
    expect(consentUrl).toBe(`https://${HOST}/demo/consent/${token}`);
    expect((await call("GET", `/v1/portal/${token}`)).json).toMatchObject({ step: "progress" });
    const applicant = await call("GET", `/v1/app/applicants/${a.id}`, { token: "token-a" });
    expect((applicant.json as { status: string }).status).toBe("connecting");

    const page = await call("GET", `/demo/consent/${token}`);
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toMatch(/text\/html/);
    expect(page.body).toMatch(/sandbox/i);
    expect(page.body).toMatch(/synthetic/i);
    for (const s of SANDBOX_SCENARIOS) expect(page.body).toContain(`value="${s.key}"`);

    const consent = await call("POST", `/demo/consent/${token}`, { form: "scenario=B" });
    expect(consent.status).toBe(303);
    expect(consent.headers.location).toBe(`${LOVABLE}/connect/${token}/progress`);
    expect((await call("GET", `/v1/portal/${token}`)).json).toMatchObject({ step: "progress" });

    clock += 6_000;
    const s2 = await call("GET", `/v1/portal/${token}`);
    expect(s2.json).toMatchObject({ step: "finances" });
    const connected = await call("GET", `/v1/app/applicants/${a.id}`, { token: "token-a" });
    expect((connected.json as { status: string }).status).toBe("connected");

    const fp = await call("PUT", `/v1/portal/${token}/financial-position`, {
      body: {
        household_earners: 1,
        assets: [],
        liabilities: [],
        repayments: [],
        income: [],
        expenses: [],
      },
    });
    expect(fp.status).toBe(200);
    valid("/v1/portal/{token}/financial-position", "put", fp);
    expect((await call("GET", `/v1/portal/${token}`)).json).toMatchObject({ step: "done" });
  });

  it("refuses an unknown scenario, and an unknown token", async () => {
    const a = await createApplicant();
    const { token } = await invite(a.id);
    await call("POST", `/v1/portal/${token}/connect`);
    expect((await call("POST", `/demo/consent/${token}`, { form: "scenario=Z" })).status).toBe(400);
    expect((await call("GET", "/v1/portal/tok_nope")).status).toBe(404);
    expect((await call("GET", "/demo/consent/tok_nope")).status).toBe(404);
  });

  it("offers the five pre-registered scenarios, A, B, C, D and D2", () => {
    expect(SANDBOX_SCENARIOS.map((s) => s.key)).toEqual(["A", "B", "C", "D", "D2"]);
  });
});

describe("the assessment endpoints: a labelled 501 in candidate 0", () => {
  it("running an assessment returns 501, not a fixture", async () => {
    const a = await createApplicant();
    const res = await call("POST", `/v1/app/applicants/${a.id}/assessments`, { token: "token-a" });
    expect(res.status).toBe(501);
    valid("/v1/app/applicants/{id}/assessments", "post", res);
    expect((res.json as { error: { code: string; message: string } }).error).toMatchObject({
      code: "assessment_not_wired",
    });
  });

  it("an applicant's assessment list is empty", async () => {
    const a = await createApplicant();
    const res = await call("GET", `/v1/app/applicants/${a.id}/assessments`, { token: "token-a" });
    expect(res.status).toBe(200);
    valid("/v1/app/applicants/{id}/assessments", "get", res);
    expect((res.json as { items: unknown[] }).items).toEqual([]);
  });

  it("the assessment, evidence and trace return 501; the PDF says it isn't in this demo", async () => {
    for (const path of [
      "/v1/app/assessments/asm_x",
      "/v1/app/assessments/asm_x/signals/INC-01/evidence",
      "/v1/app/assessments/asm_x/affordability/trace",
    ]) {
      const res = await call("GET", path, { token: "token-a" });
      expect(res.status, path).toBe(501);
    }
    const pdf = await call("GET", "/v1/app/assessments/asm_x/report.pdf", { token: "token-a" });
    expect(pdf.status).toBe(501);
    expect((pdf.json as { error: { message: string } }).error.message).toMatch(
      /not available in this demo/i,
    );
  });
});

describe("everything else", () => {
  it("answers a contract path the demo doesn't serve with a labelled 501", async () => {
    const res = await call("POST", "/v1/app/checkout", {
      token: "token-a",
      body: { pack_id: "p" },
    });
    expect(res.status).toBe(501);
    expect((res.json as { error: { code: string } }).error.code).toBe("not_available_in_demo");
  });

  it("answers an unknown path with 404", async () => {
    expect((await call("GET", "/v1/app/nothing-here", { token: "token-a" })).status).toBe(404);
  });

  it("never says approve or decline", () => {
    for (const b of bodies) expect(b).not.toMatch(/\b(approve|approved|decline|declined)\b/i);
  });
});
