// SIG-82 (40779; Lovable's answer, 40820 and 40822; review 23, 40821 G7): Supabase sign-ins,
// verified server-side with the project's public values only.
//   - ES256 only (40822, 1): the access token's signature against
//     <project URL>/auth/v1/.well-known/jwks.json, with its issuer (<project URL>/auth/v1),
//     audience (authenticated), expiry and not-before. Every other algorithm is refused without a
//     call. There is no fallback of any kind: the shared-secret check is removed altogether.
//   - A token whose issuer isn't <project URL>/auth/v1 raises IssuerMismatch before any fetch, so
//     a stage configured with the wrong project says so (401 issuer_mismatch, 40822, 2).
//   - If the key list can't be reached, the caller gets SignInUnavailable (the app answers 503).
//   - An unknown key ID forces one reload of the key list, at most once a minute, and is then
//     cached as unknown for a minute.
// Nothing here logs: a token and its claims never reach a log. ADR 0014 records this.
import { createPublicKey, verify as verifySignature, type JsonWebKey } from "node:crypto";

export type Verified = { sub: string; email: string | null };
export type Verifier = (token: string) => Promise<Verified | null>;

/** Supabase couldn't be reached to check a sign-in: the app answers 503, never a fallback. */
export class SignInUnavailable extends Error {
  constructor(message = "The sign-in service could not be reached") {
    super(message);
    this.name = "SignInUnavailable";
  }
}

/** The token names another issuer than this stage's project (40822, 2): the app answers 401
 * issuer_mismatch. It carries no value from the token or the configuration. */
export class IssuerMismatch extends Error {
  constructor() {
    super("The sign-in's issuer is not this stage's project");
    this.name = "IssuerMismatch";
  }
}

type Jwk = JsonWebKey & { kid?: string; alg?: string };
const KEYS_TTL_MS = 10 * 60 * 1000;
/** A cached key list is used when a refresh fails, for at most this long. */
const KEYS_STALE_MS = 60 * 60 * 1000;
/** At most one forced reload a minute, and an unknown key ID is remembered for a minute. */
const RELOAD_MIN_MS = 60 * 1000;
const SKEW_S = 30;

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
  let lastForced = -Infinity;
  const unknownKids = new Map<string, number>();

  /** The key list, or SignInUnavailable if it can't be fetched and no recent copy is held. */
  async function loadKeys(force: boolean): Promise<Jwk[]> {
    if (!force && keys && now() - keys.at < KEYS_TTL_MS) return keys.list;
    const fallback = () => {
      if (keys && now() - keys.at < KEYS_STALE_MS) return keys.list;
      throw new SignInUnavailable();
    };
    let body: unknown;
    try {
      const res = await get(`${issuer}/.well-known/jwks.json`, {
        headers: { apikey: o.publishableKey },
      });
      if (!res.ok) return fallback();
      body = await res.json();
    } catch {
      return fallback();
    }
    const list = obj(body).keys;
    if (!Array.isArray(list)) return fallback();
    keys = { at: now(), list: list as Jwk[] };
    return keys.list;
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

  async function findKey(kid: string): Promise<Jwk | null> {
    const match = (list: Jwk[]) =>
      list.find((k) => k.kid === kid && (k.alg === undefined || k.alg === "ES256")) ?? null;
    const first = match(await loadKeys(false));
    if (first) return first;
    const until = unknownKids.get(kid);
    if (until !== undefined && until > now()) return null;
    if (now() - lastForced < RELOAD_MIN_MS) return null;
    lastForced = now();
    const jwk = match(await loadKeys(true));
    if (!jwk) {
      unknownKids.set(kid, now() + RELOAD_MIN_MS);
      if (unknownKids.size > 1000)
        for (const [k, v] of unknownKids) if (v <= now()) unknownKids.delete(k);
    }
    return jwk;
  }

  async function bySignature(parts: string[], header: Record<string, unknown>) {
    if (typeof header.kid !== "string" || !header.kid) return null;
    const jwk = await findKey(header.kid);
    if (!jwk) return null;
    try {
      const key = createPublicKey({ key: jwk, format: "jwk" });
      const ok = verifySignature(
        "sha256",
        Buffer.from(`${parts[0]}.${parts[1]}`),
        { key, dsaEncoding: "ieee-p1363" },
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

  return async (token) => {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
    const header = obj(decode(parts[0]));
    if (header.alg !== "ES256") return null;
    if (obj(decode(parts[1])).iss !== issuer) throw new IssuerMismatch();
    return bySignature(parts, header);
  };
}
