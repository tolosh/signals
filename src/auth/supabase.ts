// SIG-82 (40779): Supabase sign-ins, verified server-side with the project's public values only.
// Preferred: the access token's signature against <project URL>/auth/v1/.well-known/jwks.json
// (ES256 or RS256), with its issuer (<project URL>/auth/v1), audience (authenticated), expiry and
// not-before. If the project publishes no keys (it still signs with a shared secret), the token is
// checked with GET <project URL>/auth/v1/user, sending the token and the publishable key, and the
// answer is cached briefly by a SHA-256 of the token, never the token. Nothing here logs: a token,
// its hash and its claims never reach a log. The choice is recorded in ADR 0014.
import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type JsonWebKey,
} from "node:crypto";

export type Verified = { sub: string; email: string | null };
export type Verifier = (token: string) => Promise<Verified | null>;

type Jwk = JsonWebKey & { kid?: string; alg?: string };
const KEYS_TTL_MS = 10 * 60 * 1000;
const USER_TTL_MS = 60 * 1000;
const SKEW_S = 30;
const ALGS: Record<string, { hash: string; ec: boolean }> = {
  ES256: { hash: "sha256", ec: true },
  RS256: { hash: "sha256", ec: false },
};

/** The bearer token from the Authorization header, or null. */
export function bearerOf(headers: Readonly<Record<string, string | undefined>>): string | null {
  const v = headers.authorization ?? headers.Authorization;
  const m = /^Bearer\s+(\S+)$/i.exec(v ?? "");
  return m ? (m[1] as string) : null;
}

const decode = (part: string): unknown => {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
  } catch {
    return null;
  }
};
const obj = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};

export function createSupabaseVerifier(o: {
  url: string;
  publishableKey: string;
  fetch?: typeof fetch;
  now?: () => number;
}): Verifier {
  const base = o.url.replace(/\/+$/, "");
  const issuer = `${base}/auth/v1`;
  const get = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  let keys: { at: number; list: Jwk[] } | null = null;
  const users = new Map<string, { until: number; user: Verified | null }>();

  async function loadKeys(force: boolean): Promise<Jwk[] | null> {
    if (!force && keys && now() - keys.at < KEYS_TTL_MS) return keys.list;
    try {
      const res = await get(`${issuer}/.well-known/jwks.json`, {
        headers: { apikey: o.publishableKey },
      });
      if (!res.ok) return keys?.list ?? null;
      const list = (obj(await res.json()).keys ?? []) as Jwk[];
      keys = { at: now(), list: Array.isArray(list) ? list : [] };
      return keys.list;
    } catch {
      return keys?.list ?? null;
    }
  }

  function claimsOk(c: Record<string, unknown>): boolean {
    const t = now() / 1000;
    const aud = c.aud;
    const audOk = Array.isArray(aud) ? aud.includes("authenticated") : aud === "authenticated";
    return (
      c.iss === issuer &&
      audOk &&
      typeof c.exp === "number" &&
      c.exp > t &&
      (c.nbf === undefined || (typeof c.nbf === "number" && c.nbf <= t + SKEW_S)) &&
      typeof c.sub === "string" &&
      c.sub.length > 0
    );
  }

  async function bySignature(parts: string[], header: Record<string, unknown>) {
    const alg = Object.hasOwn(ALGS, String(header.alg)) ? ALGS[String(header.alg)] : undefined;
    if (!alg) return null;
    for (const force of [false, true]) {
      const list = await loadKeys(force);
      if (!list) return null;
      const jwk = list.find(
        (k) => k.kid === header.kid && (k.alg === undefined || k.alg === header.alg),
      );
      if (!jwk) continue;
      try {
        const key = createPublicKey({ key: jwk, format: "jwk" });
        const ok = verifySignature(
          alg.hash,
          Buffer.from(`${parts[0]}.${parts[1]}`),
          alg.ec ? { key, dsaEncoding: "ieee-p1363" } : key,
          Buffer.from(parts[2] as string, "base64url"),
        );
        if (!ok) return null;
      } catch {
        return null;
      }
      const c = obj(decode(parts[1] as string));
      return claimsOk(c)
        ? { sub: c.sub as string, email: typeof c.email === "string" ? c.email : null }
        : null;
    }
    return null;
  }

  async function byUserEndpoint(token: string): Promise<Verified | null> {
    const id = createHash("sha256").update(token).digest("hex");
    const hit = users.get(id);
    if (hit && hit.until > now()) return hit.user;
    let user: Verified | null = null;
    try {
      const res = await get(`${issuer}/user`, {
        headers: { authorization: `Bearer ${token}`, apikey: o.publishableKey },
      });
      if (res.ok) {
        const u = obj(await res.json());
        if (typeof u.id === "string" && u.id)
          user = { sub: u.id, email: typeof u.email === "string" ? u.email : null };
      }
    } catch {
      user = null;
    }
    users.set(id, { until: now() + USER_TTL_MS, user });
    if (users.size > 1000) for (const [k, v] of users) if (v.until <= now()) users.delete(k);
    return user;
  }

  return async (token) => {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
    const header = obj(decode(parts[0]));
    if (Object.hasOwn(ALGS, String(header.alg))) return bySignature(parts, header);
    // A shared-secret project publishes no keys: Supabase itself checks the token.
    if (header.alg === "HS256") {
      const list = await loadKeys(false);
      if (list && list.length > 0) return null;
      return byUserEndpoint(token);
    }
    return null;
  };
}
