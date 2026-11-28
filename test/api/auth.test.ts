// SIG-82 (40779): Supabase sign-ins are verified server-side with the project's public values
// only: the access token's signature against <project URL>/auth/v1/.well-known/jwks.json, with its
// issuer, audience and expiry. ES256 only: the shared-secret fallback (GET /auth/v1/user) was
// removed (40822, 1), and a wrong issuer raises IssuerMismatch (40822, 2). No token is ever logged.
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bearerOf, createSupabaseVerifier, IssuerMismatch } from "../../src/auth/supabase.js";

const URL_ = "https://abcdefgh.supabase.co";
const KEY = "sb_publishable_test";
const NOW = 1_800_000_000_000;
const b64 = (x: Buffer | string) => Buffer.from(x).toString("base64url");

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const other = generateKeyPairSync("ec", { namedCurve: "P-256" });
const KID = "kid-1";
const jwks = (pub: KeyObject = publicKey) => ({
  keys: [{ ...pub.export({ format: "jwk" }), kid: KID, alg: "ES256", use: "sig" }],
});

function token(claims: Record<string, unknown>, o: { key?: KeyObject; kid?: string } = {}) {
  const header = b64(JSON.stringify({ alg: "ES256", typ: "JWT", kid: o.kid ?? KID }));
  const payload = b64(JSON.stringify(claims));
  const sig = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: o.key ?? privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${b64(sig)}`;
}
const good = (over: Record<string, unknown> = {}) =>
  token({
    iss: `${URL_}/auth/v1`,
    aud: "authenticated",
    sub: "user-a",
    email: "a@demo.test",
    role: "authenticated",
    exp: NOW / 1000 + 600,
    iat: NOW / 1000 - 10,
    ...over,
  });

type Call = { url: string; headers: Record<string, string> };
function fakeFetch(routes: Record<string, () => { status: number; body: unknown }>) {
  const calls: Call[] = [];
  const f = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const route = routes[url];
    if (!route) return Promise.reject(new Error(`unexpected fetch ${url}`));
    const r = route();
    return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status }));
  };
  return { fetch: f as typeof fetch, calls };
}
const JWKS_URL = `${URL_}/auth/v1/.well-known/jwks.json`;
const USER_URL = `${URL_}/auth/v1/user`;

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    });
});
afterEach(() => vi.restoreAllMocks());

describe("JWKS verification (preferred)", () => {
  const verifier = () => {
    const f = fakeFetch({ [JWKS_URL]: () => ({ status: 200, body: jwks() }) });
    return {
      verify: createSupabaseVerifier({
        url: URL_,
        publishableKey: KEY,
        fetch: f.fetch,
        now: () => NOW,
      }),
      calls: f.calls,
    };
  };

  it("accepts a token signed by the project's key, with the right issuer, audience and expiry", async () => {
    const { verify } = verifier();
    expect(await verify(good())).toEqual({ sub: "user-a", email: "a@demo.test" });
  });

  it("rejects a token signed by another key", async () => {
    const { verify } = verifier();
    const forged = token(
      { iss: `${URL_}/auth/v1`, aud: "authenticated", sub: "x", exp: NOW / 1000 + 600 },
      { key: other.privateKey },
    );
    expect(await verify(forged)).toBeNull();
  });

  it("rejects the wrong issuer, the wrong audience, an expired token and a not-yet-valid one", async () => {
    const { verify } = verifier();
    // 40822, 2 (a disclosed test edit): a wrong issuer is IssuerMismatch, not a plain rejection.
    await expect(verify(good({ iss: "https://evil.supabase.co/auth/v1" }))).rejects.toBeInstanceOf(
      IssuerMismatch,
    );
    expect(await verify(good({ aud: "anon" }))).toBeNull();
    expect(await verify(good({ exp: NOW / 1000 - 1 }))).toBeNull();
    expect(await verify(good({ nbf: NOW / 1000 + 120 }))).toBeNull();
  });

  it("accepts an audience given as a list that includes authenticated", async () => {
    const { verify } = verifier();
    expect(await verify(good({ aud: ["authenticated", "other"] }))).not.toBeNull();
  });

  it("rejects alg none, a tampered payload and garbage", async () => {
    const { verify } = verifier();
    const [, payload] = good().split(".");
    const none = `${b64(JSON.stringify({ alg: "none", kid: KID }))}.${payload}.`;
    expect(await verify(none)).toBeNull();
    const t = good().split(".");
    const tampered = `${t[0]}.${b64(JSON.stringify({ sub: "admin", aud: "authenticated", iss: `${URL_}/auth/v1`, exp: NOW / 1000 + 600 }))}.${t[2]}`;
    expect(await verify(tampered)).toBeNull();
    expect(await verify("not-a-jwt")).toBeNull();
    expect(await verify("")).toBeNull();
  });

  it("fetches the keys once and caches them", async () => {
    const { verify, calls } = verifier();
    await verify(good());
    await verify(good({ sub: "user-b" }));
    expect(calls.filter((c) => c.url === JWKS_URL)).toHaveLength(1);
  });

  it("sends nothing but the project's own URLs", async () => {
    const { verify, calls } = verifier();
    await verify(good());
    for (const c of calls) expect(c.url.startsWith(`${URL_}/auth/v1/`)).toBe(true);
  });
});

// 40822, 1 (a disclosed test edit): the shared-secret fallback was removed, so its three tests
// (checks with /user, caches by hash, rejects a refused token) are replaced by this one.
describe("no shared-secret fallback", () => {
  it("refuses an HS256 token without calling /auth/v1/user or anything else", async () => {
    const f = fakeFetch({
      [JWKS_URL]: () => ({ status: 200, body: { keys: [] } }),
      [USER_URL]: () => ({ status: 200, body: { id: "user-h", email: "h@demo.test" } }),
    });
    const verify = createSupabaseVerifier({
      url: URL_,
      publishableKey: KEY,
      fetch: f.fetch,
      now: () => NOW,
    });
    const hs = `${b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64(JSON.stringify({ iss: `${URL_}/auth/v1`, sub: "user-h", exp: NOW / 1000 + 600 }))}.c2ln`;
    expect(await verify(hs)).toBeNull();
    expect(f.calls).toEqual([]);
  });
});

describe("tokens are never logged", () => {
  it("logs no token, and no hash of one, on success or failure", async () => {
    const f = fakeFetch({ [JWKS_URL]: () => ({ status: 500, body: {} }) });
    const verify = createSupabaseVerifier({
      url: URL_,
      publishableKey: KEY,
      fetch: f.fetch,
      now: () => NOW,
    });
    const t = good();
    // Review 23 (40821, G7): an unreachable key list now rejects with SignInUnavailable.
    await verify(t).catch(() => null);
    const hash = createHash("sha256").update(t).digest("hex");
    for (const line of logs) {
      expect(line).not.toContain(t);
      expect(line).not.toContain(t.split(".")[2] ?? "");
      expect(line).not.toContain(hash);
    }
  });
});

describe("bearerOf", () => {
  it("reads a bearer token from the Authorization header, case-insensitively", () => {
    expect(bearerOf({ authorization: "Bearer abc" })).toBe("abc");
    expect(bearerOf({ Authorization: "bearer abc" })).toBe("abc");
    expect(bearerOf({})).toBeNull();
    expect(bearerOf({ authorization: "Basic abc" })).toBeNull();
  });
});
