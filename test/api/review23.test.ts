// SIG-82 review 23 (40821) on the demo application layer, written before the change:
//   - G10: withdrawing returns a PortalSession, and a malformed applicant email is refused at input;
//   - G11: src/api/store.ts names no mock module;
//   - 40820, 3: a demo member matched by email is bound to the sub first seen, and a later sign-in
//     with the same email but another sub is refused;
//   - G7: a sign-in that can't be checked (the key list or /user unreachable) is a 503, not a 401;
//   - a 500 carries a correlation ID, logged with no PII;
//   - /health says whether the HS256 fallback is on.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoApp, type DemoRequest } from "../../src/api/app.js";
import { NOT_WIRED } from "../../src/api/assessment-port.js";
import { demoConfigFrom } from "../../src/api/config.js";
import { MemoryStore } from "../../src/api/dynamo.js";
import { DemoStore } from "../../src/api/store.js";
import * as auth from "../../src/auth/supabase.js";
import { responseValidator } from "./contract.js";

const SignInUnavailable = (auth as Record<string, unknown>).SignInUnavailable as
  (new (message?: string) => Error) | undefined;
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const USERS: Record<string, { sub: string; email: string }> = {
  "token-a": { sub: "user-a", email: "a@demo.test" },
  "token-a-other-sub": { sub: "user-imposter", email: "A@demo.test" },
  "token-b": { sub: "user-b", email: "b@demo.test" },
};
const env = (over: Record<string, string> = {}) => ({
  ENRICH_PATH: "local",
  DEMO_COMMIT: COMMIT,
  SUPABASE_URL: "https://abcdefgh.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  DEMO_MEMBERS: "a@demo.test:A, b@demo.test:B",
  ...over,
});

let rows: MemoryStore;
let logs: string[];
type Verify = Parameters<typeof createDemoApp>[0]["verify"];
const appOn = (
  store: MemoryStore,
  verify: Verify = (t) => Promise.resolve(USERS[t] ?? null),
  e = env(),
) =>
  createDemoApp({
    config: demoConfigFrom(e),
    store: new DemoStore(store),
    verify,
    now: () => 1_800_000_000_000,
    assessments: NOT_WIRED,
  });

beforeEach(() => {
  rows = new MemoryStore();
  logs = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    });
});
afterEach(() => vi.restoreAllMocks());

async function call(
  app: ReturnType<typeof createDemoApp>,
  method: string,
  path: string,
  o: { token?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  const req: DemoRequest = {
    method,
    path,
    headers,
    host: "abc.execute-api.ap-southeast-2.amazonaws.com",
    ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
  };
  const res = await app(req);
  const json = (res.headers["content-type"] ?? "").includes("json")
    ? (JSON.parse(res.body) as Record<string, unknown>)
    : null;
  return { ...res, json };
}
const valid = (template: string, method: string, res: { status: number; json: unknown }) =>
  expect(responseValidator(template, method, res.status)(res.json).errors ?? null).toBeNull();
const applicant = (email: unknown) => ({
  name: "Applicant",
  email,
  product_type: "personal",
  loan_request: { loan_amount: 20000, term_months: 60, purpose: "Car", security_value: null },
});

describe("G10: withdrawing consent returns a PortalSession", () => {
  it("POST /v1/portal/{token}/withdraw validates against the contract, at step withdrawn", async () => {
    const app = appOn(rows);
    const a = await call(app, "POST", "/v1/app/applicants", {
      token: "token-a",
      body: applicant(null),
    });
    const inv = await call(app, "POST", `/v1/app/applicants/${String(a.json?.id)}/invites`, {
      token: "token-a",
      body: { channel: "email" },
    });
    const token = String(inv.json?.portal_url).split("/connect/")[1] as string;
    const res = await call(app, "POST", `/v1/portal/${token}/withdraw`);
    expect(res.status).toBe(200);
    valid("/v1/portal/{token}/withdraw", "post", res);
    expect(res.json?.step).toBe("withdrawn");
    const after = await call(app, "GET", `/v1/portal/${token}`);
    valid("/v1/portal/{token}", "get", after);
    expect(after.json?.step).toBe("withdrawn");
  });
});

describe("G10: a malformed applicant email is refused at input", () => {
  it.each(["not-an-email", "a@", "@demo.test", "a b@demo.test", "", "a@demo", 42, {}])(
    "refuses %j with a contract-shaped 400",
    async (email) => {
      const app = appOn(rows);
      const res = await call(app, "POST", "/v1/app/applicants", {
        token: "token-a",
        body: applicant(email),
      });
      expect(res.status).toBe(400);
      valid("/v1/app/applicants", "post", res);
      expect((res.json?.error as { code: string }).code).toBe("invalid_parameter");
    },
  );

  it.each([null, undefined, "applicant@demo.test", "first.last+tag@sub.example.com.au"])(
    "accepts %j, and the response validates",
    async (email) => {
      const app = appOn(rows);
      const res = await call(app, "POST", "/v1/app/applicants", {
        token: "token-a",
        body: applicant(email),
      });
      expect(res.status).toBe(201);
      valid("/v1/app/applicants", "post", res);
    },
  );
});

describe("G11: src/api/store.ts names no mock module", () => {
  it("doesn't match the ADR 0005 state guard's pattern", () => {
    expect(readFileSync("src/api/store.ts", "utf8")).not.toMatch(
      /@aws-sdk\/(client|lib)-dynamodb|mock\/persist|mock\/state/,
    );
  });
});

describe("40820, 3: a member matched by email is bound to the first sub seen", () => {
  it("refuses a later sign-in with the same email and another sub; the first still works", async () => {
    const app = appOn(rows);
    expect((await call(app, "GET", "/v1/app/me", { token: "token-a" })).status).toBe(200);
    const other = await call(app, "GET", "/v1/app/me", { token: "token-a-other-sub" });
    expect(other.status).toBe(403);
    valid("/v1/app/me", "get", other);
    expect((await call(app, "GET", "/v1/app/me", { token: "token-a" })).status).toBe(200);
  });

  it("the binding is recorded, so it holds on a cold Lambda over the same store", async () => {
    await call(appOn(rows), "GET", "/v1/app/me", { token: "token-a" });
    const cold = appOn(rows);
    expect((await call(cold, "GET", "/v1/app/me", { token: "token-a-other-sub" })).status).toBe(
      403,
    );
    expect((await call(cold, "GET", "/v1/app/me", { token: "token-a" })).status).toBe(200);
  });

  it("whichever sub signs in first is the one bound", async () => {
    const app = appOn(rows);
    expect((await call(app, "GET", "/v1/app/me", { token: "token-a-other-sub" })).status).toBe(200);
    expect((await call(app, "GET", "/v1/app/me", { token: "token-a" })).status).toBe(403);
  });

  it("one member's binding doesn't touch another's", async () => {
    const app = appOn(rows);
    await call(app, "GET", "/v1/app/me", { token: "token-a" });
    expect((await call(app, "GET", "/v1/app/me", { token: "token-b" })).status).toBe(200);
  });
});

describe("G7: a sign-in that can't be checked is a 503", () => {
  it("answers 503 sign_in_unavailable when the verifier can't reach Supabase", async () => {
    expect(typeof SignInUnavailable).toBe("function");
    const Unavailable = SignInUnavailable ?? Error;
    const app = appOn(rows, () => Promise.reject(new Unavailable("keys unreachable")));
    const res = await call(app, "GET", "/v1/app/me", { token: "token-a" });
    expect(res.status).toBe(503);
    valid("/v1/app/me", "get", res);
    expect((res.json?.error as { code: string }).code).toBe("sign_in_unavailable");
  });
});

describe("a 500 carries a correlation ID, logged with no PII", () => {
  it("returns the ID in the body and a header, and logs it without the email, name or token", async () => {
    const broken = new MemoryStore();
    broken.query = () => Promise.reject(new Error("boom a@demo.test Secret Applicant token-a"));
    const app = appOn(broken);
    const res = await call(app, "GET", "/v1/app/applicants", { token: "token-a" }).catch(() => ({
      status: -1,
      headers: {} as Record<string, string>,
      body: "",
      json: null,
    }));
    expect(res.status).toBe(500);
    valid("/v1/app/applicants", "get", res);
    const id = res.headers["x-correlation-id"] ?? "";
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(String((res.json?.error as { message: string }).message)).toContain(id);
    const line = logs.find((l) => l.includes(id));
    expect(line).toBeDefined();
    for (const l of logs)
      for (const secret of ["a@demo.test", "Secret", "Applicant", "token-a", "boom", "user-a"])
        expect(l).not.toContain(secret);
  });
});

describe("/health says whether the HS256 fallback is on", () => {
  it("off unless configured on; any other value refuses to start", async () => {
    const off = await call(appOn(rows), "GET", "/health");
    expect((off.json?.auth as { hs256_fallback?: boolean } | undefined)?.hs256_fallback).toBe(
      false,
    );
    const on = await call(
      appOn(rows, undefined, env({ SUPABASE_HS256_FALLBACK: "on" })),
      "GET",
      "/health",
    );
    expect((on.json?.auth as { hs256_fallback?: boolean } | undefined)?.hs256_fallback).toBe(true);
    expect(demoConfigFrom(env({ SUPABASE_HS256_FALLBACK: "off" })).hs256Fallback).toBe(false);
    expect(() => demoConfigFrom(env({ SUPABASE_HS256_FALLBACK: "yes" }))).toThrow(/HS256/);
  });
});
