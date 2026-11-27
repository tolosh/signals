// SIG-82 (40822, items 1 and 2; Colin, 28 Nov 2026): written before the change.
//   - ES256 only, with the /auth/v1/user fallback removed altogether: an HS256 token, or any other
//     algorithm, is refused without any call, and no option brings the fallback back.
//   - SUPABASE_HS256_FALLBACK is no longer a setting: any value refuses to start, so a stale deploy
//     can't believe the fallback is on. /health says the stage verifies ES256 only.
//   - A token whose issuer isn't the configured one gets a 401 with the non-secret code
//     issuer_mismatch, decided before any fetch (a wrong issuer also means a wrong key-list URL).
import { generateKeyPairSync, sign } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDemoApp } from "../../src/api/app.js";
import { NOT_WIRED } from "../../src/api/assessment-port.js";
import { demoConfigFrom } from "../../src/api/config.js";
import { MemoryStore } from "../../src/api/dynamo.js";
import { DemoStore } from "../../src/api/store.js";
import * as auth from "../../src/auth/supabase.js";
import { responseValidator } from "./contract.js";

const { createSupabaseVerifier } = auth;
class Missing extends Error {}
const IssuerMismatch =
  ((auth as Record<string, unknown>).IssuerMismatch as (new () => Error) | undefined) ?? Missing;

const URL_ = "https://abcdefgh.supabase.co";
const NOW = 1_800_000_000_000;
const JWKS_URL = `${URL_}/auth/v1/.well-known/jwks.json`;
const b64 = (x: Buffer | string) => Buffer.from(x).toString("base64url");
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const JWKS = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "kid-1", alg: "ES256" }] };

const token = (header: Record<string, unknown>, claims: Record<string, unknown> = {}) => {
  const h = b64(JSON.stringify({ typ: "JWT", kid: "kid-1", ...header }));
  const p = b64(
    JSON.stringify({
      iss: `${URL_}/auth/v1`,
      aud: "authenticated",
      sub: "user-a",
      email: "a@demo.test",
      exp: NOW / 1000 + 600,
      ...claims,
    }),
  );
  const s = sign("sha256", Buffer.from(`${h}.${p}`), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${h}.${p}.${b64(s)}`;
};
const es256 = (claims: Record<string, unknown> = {}) => token({ alg: "ES256" }, claims);

const make = (extra: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  const f = (input: string | URL | Request) => {
    calls.push(String(input));
    if (String(input) === JWKS_URL)
      return Promise.resolve(new Response(JSON.stringify(JWKS), { status: 200 }));
    return Promise.resolve(
      new Response(JSON.stringify({ id: "user-h", email: "h@demo.test" }), { status: 200 }),
    );
  };
  const verify = createSupabaseVerifier({
    url: URL_,
    publishableKey: "sb_publishable_test",
    fetch: f as typeof fetch,
    now: () => NOW,
    ...extra,
  } as Parameters<typeof createSupabaseVerifier>[0]);
  return { verify, calls };
};

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });

describe("40822, 1: ES256 only; the /auth/v1/user fallback is removed", () => {
  it("still accepts a good ES256 token", async () => {
    const { verify } = make();
    expect(await verify(es256())).toEqual({ sub: "user-a", email: "a@demo.test" });
  });

  it("refuses an HS256 token without any call, even if the old option is passed", async () => {
    for (const extra of [{}, { hs256Fallback: true }]) {
      const { verify, calls } = make(extra);
      expect(await verify(token({ alg: "HS256" }))).toBeNull();
      expect(calls).toEqual([]);
    }
  });

  it("refuses every other algorithm without any call", async () => {
    for (const alg of ["RS256", "ES384", "EdDSA", "none", "hs256", "es256"]) {
      const { verify, calls } = make({ hs256Fallback: true });
      expect(await verify(token({ alg })), alg).toBeNull();
      expect(calls, alg).toEqual([]);
    }
  });

  it("no source file references the /user endpoint or an HS256 fallback", () => {
    const hits = ["src/auth", "src/api", "infra"]
      .flatMap(files)
      .filter((f) => /\.(ts|mjs)$/.test(f))
      .filter((f) =>
        /auth\/v1\/user|\/user[`"]|hs256Fallback|HS256_FALLBACK/i.test(readFileSync(f, "utf8")),
      );
    expect(hits).toEqual([]);
  });

  it("SUPABASE_HS256_FALLBACK is no longer a setting: any value refuses to start", () => {
    const env = { ENRICH_PATH: "local", SUPABASE_URL: URL_, DEMO_MEMBERS: "a@demo.test:A" };
    expect(() => demoConfigFrom(env)).not.toThrow();
    for (const v of ["on", "off", ""])
      expect(() => demoConfigFrom({ ...env, SUPABASE_HS256_FALLBACK: v }), v).toThrow(/40822/);
    expect(demoConfigFrom(env)).not.toHaveProperty("hs256Fallback");
  });
});

const appWith = (verify: Parameters<typeof createDemoApp>[0]["verify"]) =>
  createDemoApp({
    config: demoConfigFrom({
      ENRICH_PATH: "local",
      DEMO_COMMIT: "0123456789abcdef0123456789abcdef01234567",
      SUPABASE_URL: URL_,
      DEMO_MEMBERS: "a@demo.test:A",
    }),
    store: new DemoStore(new MemoryStore()),
    verify,
    now: () => NOW,
    assessments: NOT_WIRED,
  });

describe("40822, 2: a wrong issuer is a 401 issuer_mismatch", () => {
  it("the verifier raises IssuerMismatch for another issuer, before any fetch", async () => {
    expect(IssuerMismatch).not.toBe(Missing);
    for (const iss of [
      "https://zzzzzzzz.supabase.co/auth/v1",
      `${URL_}/auth/v1/`,
      URL_,
      undefined,
      42,
    ]) {
      const { verify, calls } = make();
      await expect(verify(es256({ iss })), String(iss)).rejects.toBeInstanceOf(IssuerMismatch);
      expect(calls, String(iss)).toEqual([]);
    }
  });

  it("the right issuer with a bad signature is still a plain rejection", async () => {
    const { verify } = make();
    const [h, p] = es256().split(".");
    expect(await verify(`${h}.${p}.${b64("forged")}`)).toBeNull();
  });

  it("the app answers 401 issuer_mismatch, contract-valid, naming no value", async () => {
    const res = await appWith(() => Promise.reject(new IssuerMismatch()))({
      method: "GET",
      path: "/v1/app/me",
      headers: { authorization: "Bearer any-token" },
      host: "abc.execute-api.ap-southeast-2.amazonaws.com",
    });
    expect(res.status).toBe(401);
    const body = JSON.parse(res.body) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("issuer_mismatch");
    expect(body.error.message).not.toMatch(/supabase\.co|abcdefgh|any-token/);
    expect(responseValidator("/v1/app/me", "get", 401)(body).valid).toBe(true);
  });

  it("other rejections stay 401 unauthenticated", async () => {
    const res = await appWith(() => Promise.resolve(null))({
      method: "GET",
      path: "/v1/app/me",
      headers: { authorization: "Bearer any-token" },
      host: "abc.execute-api.ap-southeast-2.amazonaws.com",
    });
    expect(res.status).toBe(401);
    expect((JSON.parse(res.body) as { error: { code: string } }).error.code).toBe(
      "unauthenticated",
    );
  });
});

describe("/health says the stage verifies ES256 only", () => {
  it("reports auth.alg ES256 and no fallback field", async () => {
    const res = await appWith(() => Promise.resolve(null))({
      method: "GET",
      path: "/health",
      headers: {},
      host: "abc.execute-api.ap-southeast-2.amazonaws.com",
    });
    const body = JSON.parse(res.body) as { auth?: Record<string, unknown> };
    expect(body.auth).toEqual({ alg: "ES256" });
  });
});
