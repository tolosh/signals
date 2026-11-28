// SIG-82 review 23 (40821, G7 and the out-of-scope items) and Lovable's answer (40820): the
// verifier's fallback, written before the change.
//   - GET <iss>/user is used only for a token whose header says HS256, and only while the
//     HS256 fallback is on (until Lovable's ES256 switch is confirmed). It never depends on the key
//     list, and it is off unless asked for.
//   - When fetching the key list fails, an ES256 token is never sent to the fallback. The caller
//     gets SignInUnavailable, so the app answers 503.
//   - ES256 only (40820, 1): any other signed algorithm is refused without a fetch.
//   - Unknown key IDs are cached negatively, and forced reloads are rate-limited.
//   - A fallback answer is never cached past the token's exp.
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as auth from "../../src/auth/supabase.js";

const { createSupabaseVerifier } = auth;
const SignInUnavailable = (auth as Record<string, unknown>).SignInUnavailable as
  (new (...a: never[]) => Error) | undefined;

const URL_ = "https://abcdefgh.supabase.co";
const KEY = "sb_publishable_test";
const NOW = 1_800_000_000_000;
const JWKS_URL = `${URL_}/auth/v1/.well-known/jwks.json`;
const USER_URL = `${URL_}/auth/v1/user`;
const b64 = (x: Buffer | string) => Buffer.from(x).toString("base64url");

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const KID = "kid-1";
const JWKS = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: KID, alg: "ES256" }] };

const es256 = (claims: Record<string, unknown> = {}, kid = KID) => {
  const h = b64(JSON.stringify({ alg: "ES256", typ: "JWT", kid }));
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
const hs256 = (claims: Record<string, unknown> = { sub: "user-h", exp: NOW / 1000 + 600 }) =>
  `${b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64(JSON.stringify(claims))}.c2ln`;
const rs256 = () =>
  `${b64(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID }))}.${b64(JSON.stringify({ sub: "x" }))}.c2ln`;

type Route = () => { status: number; body: unknown; raw?: string } | "network";
function fake(routes: Record<string, Route>) {
  const calls: string[] = [];
  const f = (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const r = routes[url]?.();
    if (!r || r === "network") return Promise.reject(new Error("network down"));
    return Promise.resolve(new Response(r.raw ?? JSON.stringify(r.body), { status: r.status }));
  };
  return { fetch: f as typeof fetch, calls };
}

let clock = NOW;
const make = (routes: Record<string, Route>, o: { hs256Fallback?: boolean } = {}) => {
  clock = NOW;
  const f = fake(routes);
  const verify = createSupabaseVerifier({
    url: URL_,
    publishableKey: KEY,
    fetch: f.fetch,
    now: () => clock,
    ...o,
  } as Parameters<typeof createSupabaseVerifier>[0]);
  return { verify, calls: f.calls };
};
const USER_OK: Route = () => ({ status: 200, body: { id: "user-h", email: "h@demo.test" } });

describe("G7: the /auth/v1/user fallback is for HS256 tokens only, while it is switched on", () => {
  it("SignInUnavailable is exported for the app to answer 503", () => {
    expect(typeof SignInUnavailable).toBe("function");
  });

  // 40822, 1 (a disclosed test edit): the fallback was removed, so "an HS256 token goes to /user"
  // and "when /user itself fails" are dropped; test/api/es256-only.test.ts covers the removal.

  it("with the fallback off, or not asked for, an HS256 token is refused without any call", async () => {
    for (const o of [{ hs256Fallback: false }, {}]) {
      const { verify, calls } = make({ [USER_URL]: USER_OK }, o);
      expect(await verify(hs256())).toBeNull();
      expect(calls).toEqual([]);
    }
  });

  it.each([
    ["a 500", () => ({ status: 500, body: {} })],
    ["a 404", () => ({ status: 404, body: {} })],
    ["a network error", () => "network" as const],
    ["a body that isn't JSON", () => ({ status: 200, body: null, raw: "<html>" })],
  ] as [string, Route][])(
    "when fetching the keys fails (%s), an ES256 token is never sent to /user: SignInUnavailable",
    async (_, jwks) => {
      const { verify, calls } = make(
        { [JWKS_URL]: jwks, [USER_URL]: USER_OK },
        { hs256Fallback: true },
      );
      await expect(verify(es256())).rejects.toBeInstanceOf(SignInUnavailable ?? Error);
      await expect(verify(es256())).rejects.toThrow();
      expect(calls).not.toContain(USER_URL);
    },
  );

  it("ES256 only (40820, 1): an RS256 token is refused without a fetch", async () => {
    const { verify, calls } = make({ [JWKS_URL]: () => ({ status: 200, body: JWKS }) });
    expect(await verify(rs256())).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("unknown key IDs: cached negatively, and forced reloads rate-limited", () => {
  it("an unknown kid forces one reload; repeating it, or another unknown kid, fetches nothing more within a minute", async () => {
    const { verify, calls } = make({ [JWKS_URL]: () => ({ status: 200, body: JWKS }) });
    expect(await verify(es256({}, "kid-unknown"))).toBeNull();
    expect(calls).toHaveLength(2); // the first load, then one forced reload
    for (let i = 0; i < 20; i++) expect(await verify(es256({}, "kid-unknown"))).toBeNull();
    for (let i = 0; i < 20; i++) expect(await verify(es256({}, `kid-random-${i}`))).toBeNull();
    expect(calls).toHaveLength(2);
    expect(await verify(es256())).toEqual({ sub: "user-a", email: "a@demo.test" });
    expect(calls).toHaveLength(2);
    clock = NOW + 61_000;
    await verify(es256({}, "kid-new"));
    expect(calls).toHaveLength(3);
  });
});

describe("a fallback answer is never cached past the token's exp", () => {
  // 40822, 1 (a disclosed test edit): the fallback's cache was removed with it.

  it("an HS256 token with no exp, or one already past it, is refused without a call", async () => {
    const { verify, calls } = make({ [USER_URL]: USER_OK }, { hs256Fallback: true });
    expect(await verify(hs256({ sub: "user-h" }))).toBeNull();
    expect(await verify(hs256({ sub: "user-h", exp: NOW / 1000 - 1 }))).toBeNull();
    expect(calls).toEqual([]);
  });
});
