// SIG-61: a fake openfeed for the connector, ingestion and revocation tests. It follows openfeed's
// published OpenAPI spec and developer docs (read 9 November 2026; SIG-61 comment 40194):
// - discovery at /.well-known/openid-configuration on the auth host;
// - private_key_jwt client authentication, PS256, aud = the issuer, a fresh jti each time;
// - client_credentials tokens carry only openfeed-au:app:all:read and openfeed-au:grant:all:list
//   and can't read banking data; data needs the person's DPoP-bound token;
// - GET /v1/app/grants is offset-paged with meta.hasNext; collections page with limit/offset and
//   links.next; 403 {code: disclosure_grant_required} once a grant is revoked; 402 credit_exhausted.
// Every value in it is invented. Nothing here calls the network.
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  verify,
  type KeyObject,
} from "node:crypto";
import type { Fetch, FetchResponse } from "../../../src/connectors/openfeed/client.js";
import { localSigner } from "../../../src/connectors/openfeed/jose.js";

export const ISSUER = "https://auth.openfeed.test";
export const API = "https://api.openfeed.test";
export const CLIENT_ID = "app-00000000-0000-4000-8000-000000000001";
export const REDIRECT = "https://signals.test/v1/openfeed/callback";

export function keyPair(): { privateKey: KeyObject; publicKey: KeyObject } {
  return generateKeyPairSync("rsa", { modulusLength: 2048 });
}

const b64urlDecode = (s: string) => Buffer.from(s, "base64url");
const json = (s: string) => JSON.parse(b64urlDecode(s).toString("utf8")) as Record<string, unknown>;

function verifyJwt(token: string, key: KeyObject): Record<string, unknown> | null {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  const header = json(h);
  if (header.alg !== "PS256") return null;
  const ok = verify(
    "sha256",
    Buffer.from(`${h}.${p}`),
    { key, padding: 6 /* RSA_PKCS1_PSS_PADDING */, saltLength: 32 },
    b64urlDecode(s),
  );
  return ok ? { ...json(p), _header: header } : null;
}

export function jwkThumbprint(jwk: { e?: string; kty?: string; n?: string }): string {
  const canonical = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n });
  return createHash("sha256").update(canonical).digest("base64url");
}

export type FakeTransaction = Record<string, unknown> & {
  transactionId: string;
  accountId: string;
};
export type FakeGrant = {
  id: string;
  userId: string;
  revision: number;
  status: "ACTIVE" | "REVOKED";
  accounts: { accountId: string; [k: string]: unknown }[];
  transactions: FakeTransaction[];
};

type Token = { kind: "app" | "user"; scopes: string[]; grantId?: string; jkt?: string };

export class FakeOpenfeed {
  readonly clientKey = keyPair();
  readonly dpopKey = keyPair();
  readonly grants = new Map<string, FakeGrant>();
  readonly seenJti = new Set<string>();
  readonly calls: { method: string; url: string; auth: string | null }[] = [];
  private readonly tokens = new Map<string, Token>();
  private readonly refreshTokens = new Map<string, string>();
  private readonly codes = new Map<string, { grantId: string; challenge: string }>();
  private readonly par = new Map<string, { challenge: string; state: string }>();
  private counter = 0;
  /** Seconds since the epoch, as the fake sees it. Tests move it. */
  now = 1_793_000_000;
  /** Queued status codes returned before the next data call is served (429, 500, 402). */
  failNext: number[] = [];
  /** When set, the next data call is answered 401 use_dpop_nonce unless it carries this nonce. */
  requireNonce: string | null = null;
  /** When true, GET /v1/app/grants fails with 503. */
  grantsDown = false;
  pageSize = 1000;
  /** Called before each request is served, so a test can change state mid-flow. */
  beforeCall: ((url: string) => void) | null = null;

  signer() {
    return localSigner(this.clientKey.privateKey);
  }
  dpopSigner() {
    return localSigner(this.dpopKey.privateKey);
  }

  addGrant(g: Omit<FakeGrant, "status" | "revision"> & Partial<FakeGrant>): FakeGrant {
    const grant: FakeGrant = { status: "ACTIVE", revision: 1, ...g };
    this.grants.set(grant.id, grant);
    return grant;
  }
  revoke(id: string): void {
    const g = this.grants.get(id);
    if (!g) throw new Error("no such grant");
    g.status = "REVOKED";
    g.revision += 1;
  }
  /** Issues an authorisation code for a grant, as openfeed does after the disclosure screen. */
  authorise(requestUri: string, grantId: string): { code: string; state: string } {
    const p = this.par.get(requestUri);
    if (!p) throw new Error("unknown request_uri");
    const code = `code-${++this.counter}`;
    this.codes.set(code, { grantId, challenge: p.challenge });
    return { code, state: p.state };
  }

  private issue(t: Token): { access_token: string; token_type: string; expires_in: number } {
    const access = `at-${++this.counter}`;
    this.tokens.set(access, t);
    return { access_token: access, token_type: t.jkt ? "DPoP" : "Bearer", expires_in: 300 };
  }

  private clientAuthenticated(form: URLSearchParams): boolean {
    if (
      form.get("client_assertion_type") !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
    )
      return false;
    const claims = verifyJwt(form.get("client_assertion") ?? "", this.clientKey.publicKey);
    if (!claims) return false;
    const { iss, sub, aud, jti, exp, iat } = claims as Record<string, unknown>;
    if (iss !== CLIENT_ID || sub !== CLIENT_ID || aud !== ISSUER) return false;
    if (typeof jti !== "string" || this.seenJti.has(jti)) return false;
    if (typeof exp !== "number" || typeof iat !== "number") return false;
    if (exp < this.now || exp - iat > 60) return false;
    this.seenJti.add(jti);
    return true;
  }

  /** Verifies a DPoP proof; returns the key thumbprint or a reason. */
  private dpop(
    proof: string | null,
    method: string,
    url: string,
    accessToken?: string,
  ): { jkt: string } | { error: string } {
    if (!proof) return { error: "invalid_dpop_proof" };
    const [h] = proof.split(".");
    if (!h) return { error: "invalid_dpop_proof" };
    const header = json(h) as { typ?: string; jwk?: JsonWebKey };
    if (header.typ !== "dpop+jwt" || !header.jwk) return { error: "invalid_dpop_proof" };
    const key = createPublicKey({ key: header.jwk, format: "jwk" });
    const claims = verifyJwt(proof, key);
    if (!claims) return { error: "invalid_dpop_proof" };
    const htu = url.split("?")[0];
    if (claims.htm !== method || claims.htu !== htu) return { error: "invalid_dpop_proof" };
    if (typeof claims.jti !== "string" || this.seenJti.has(claims.jti))
      return { error: "invalid_dpop_proof" };
    this.seenJti.add(claims.jti);
    if (this.requireNonce && claims.nonce !== this.requireNonce) return { error: "use_dpop_nonce" };
    if (accessToken !== undefined) {
      const ath = createHash("sha256").update(accessToken).digest("base64url");
      if (claims.ath !== ath) return { error: "invalid_dpop_proof" };
    }
    return { jkt: jwkThumbprint(header.jwk as { e: string; kty: string; n: string }) };
  }

  readonly fetch: Fetch = async (url, init) => {
    const method = init.method ?? "GET";
    const headers = new Map(
      Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    this.calls.push({ method, url, auth: headers.get("authorization") ?? null });
    this.beforeCall?.(url);
    const u = new URL(url);
    const reply = (
      status: number,
      body?: unknown,
      extra: Record<string, string> = {},
    ): FetchResponse => ({
      status,
      headers: { get: (n: string) => extra[n.toLowerCase()] ?? null },
      text: async () => (body === undefined ? "" : JSON.stringify(body)),
    });

    if (u.origin === ISSUER) {
      if (method === "GET" && u.pathname === "/.well-known/openid-configuration")
        return reply(200, {
          issuer: ISSUER,
          token_endpoint: `${ISSUER}/oauth/token`,
          pushed_authorization_request_endpoint: `${ISSUER}/oauth/par`,
          authorization_endpoint: `${ISSUER}/oauth/authorize`,
        });
      const form = new URLSearchParams(init.body ?? "");
      if (!this.clientAuthenticated(form)) return reply(401, { error: "invalid_client" });
      if (u.pathname === "/oauth/par") {
        if (form.get("code_challenge_method") !== "S256")
          return reply(400, { error: "invalid_request" });
        const requestUri = `urn:ietf:params:oauth:request_uri:${++this.counter}`;
        this.par.set(requestUri, {
          challenge: form.get("code_challenge") ?? "",
          state: form.get("state") ?? "",
        });
        return reply(201, { request_uri: requestUri, expires_in: 60 });
      }
      if (u.pathname === "/oauth/token") {
        const grantType = form.get("grant_type");
        if (grantType === "client_credentials") {
          const scopes = (form.get("scope") ?? "").split(" ").filter(Boolean);
          const allowed = ["openfeed-au:app:all:read", "openfeed-au:grant:all:list"];
          if (scopes.some((s) => !allowed.includes(s)))
            return reply(400, { error: "invalid_scope" });
          return reply(200, this.issue({ kind: "app", scopes }));
        }
        const d = this.dpop(headers.get("dpop") ?? null, "POST", url);
        if ("error" in d)
          return reply(
            400,
            { error: d.error },
            d.error === "use_dpop_nonce" ? { "dpop-nonce": this.requireNonce ?? "" } : {},
          );
        let grantId: string | undefined;
        if (grantType === "authorization_code") {
          const c = this.codes.get(form.get("code") ?? "");
          const verifier = form.get("code_verifier") ?? "";
          const challenge = createHash("sha256").update(verifier).digest("base64url");
          if (!c || c.challenge !== challenge || form.get("redirect_uri") !== REDIRECT)
            return reply(400, { error: "invalid_grant" });
          this.codes.delete(form.get("code") ?? "");
          grantId = c.grantId;
        } else if (grantType === "refresh_token") {
          grantId = this.refreshTokens.get(form.get("refresh_token") ?? "");
          if (!grantId || this.grants.get(grantId)?.status !== "ACTIVE")
            return reply(400, { error: "invalid_grant" });
          this.refreshTokens.delete(form.get("refresh_token") ?? "");
        } else return reply(400, { error: "unsupported_grant_type" });
        const t = this.issue({
          kind: "user",
          grantId,
          jkt: d.jkt,
          scopes: ["openfeed-au:data:banking:read", "openfeed-au:grant:self:query"],
        });
        const refresh = `rt-${++this.counter}`;
        this.refreshTokens.set(refresh, grantId);
        return reply(200, { ...t, refresh_token: refresh, grant_id: grantId });
      }
      return reply(404);
    }

    if (u.origin !== API) return reply(404);
    const auth = headers.get("authorization") ?? "";
    const [scheme, value] = auth.split(" ");
    const token = value ? this.tokens.get(value) : undefined;
    if (!token) return reply(401);

    if (u.pathname === "/v1/app/grants") {
      if (scheme !== "Bearer" || !token.scopes.includes("openfeed-au:grant:all:list"))
        return reply(403);
      if (this.grantsDown) return reply(503);
      const limit = Number(u.searchParams.get("limit") ?? 1000);
      const offset = Number(u.searchParams.get("offset") ?? 0);
      const all = [...this.grants.values()].map((g) => ({ id: g.id, revision: g.revision }));
      return reply(200, {
        version: "V1",
        data: all.slice(offset, offset + limit),
        meta: { limit, offset, hasNext: offset + limit < all.length },
      });
    }

    // Everything below is user data: a DPoP-bound user token only.
    if (scheme !== "DPoP" || token.kind !== "user")
      return reply(403, { code: "insufficient_scope", message: "x" });
    const d = this.dpop(headers.get("dpop") ?? null, method, url, value);
    if ("error" in d)
      return reply(
        401,
        { code: d.error, message: "x" },
        d.error === "use_dpop_nonce" ? { "dpop-nonce": this.requireNonce ?? "" } : {},
      );
    if (d.jkt !== token.jkt) return reply(401, { code: "invalid_dpop_proof", message: "x" });
    const queued = this.failNext.shift();
    if (queued === 429)
      return reply(429, { code: "rate_limited", message: "x" }, { "retry-after": "1" });
    if (queued === 402) return reply(402, { code: "credit_exhausted", message: "x" });
    if (queued) return reply(queued, { code: "server_error", message: "x" });
    const grant = this.grants.get(token.grantId ?? "");
    if (!grant || grant.status !== "ACTIVE")
      return reply(403, { code: "disclosure_grant_required", message: "x" });

    const grantMatch = /^\/v1\/grants\/([^/]+)$/.exec(u.pathname);
    if (grantMatch) {
      if (grantMatch[1] !== grant.id) return reply(404);
      return reply(200, {
        version: "V1",
        data: {
          grant_id: grant.id,
          grantStatus: grant.status,
          userId: grant.userId,
          bankingAccountIds: grant.accounts.map((a) => a.accountId),
          energyAccountIds: [],
          meteringState: "ACTIVE",
          grantRevision: grant.revision,
        },
      });
    }
    const page = <T>(rows: T[]) => {
      const limit = Number(u.searchParams.get("limit") ?? this.pageSize);
      const offset = Number(u.searchParams.get("offset") ?? 0);
      const size = Math.min(limit, this.pageSize);
      const next = new URL(url);
      next.searchParams.set("offset", String(offset + size));
      next.searchParams.set("limit", String(size));
      return reply(200, {
        version: "V1",
        data: rows.slice(offset, offset + size),
        meta: { limit: size, offset },
        links: { self: url, ...(offset + size < rows.length ? { next: next.toString() } : {}) },
      });
    };
    if (u.pathname === "/v1/banking/accounts") return page(grant.accounts);
    const txMatch = /^\/v1\/banking\/accounts\/([^/]+)\/transactions$/.exec(u.pathname);
    if (txMatch) {
      if (!grant.accounts.some((a) => a.accountId === txMatch[1])) return reply(404);
      const oldest = u.searchParams.get("oldestDate");
      const newest = u.searchParams.get("newestDate");
      const rows = grant.transactions.filter((t) => {
        if (t.accountId !== txMatch[1]) return false;
        const date = String(t.postedDateTime ?? t.transactionDate ?? "").slice(0, 10);
        return (!oldest || date >= oldest) && (!newest || date <= newest);
      });
      return page(rows);
    }
    return reply(404);
  };
}

/** An invented grant with one transaction account and one card, and n transactions a month. */
export function inventedGrant(
  id: string,
  months = 14,
  perMonth = 30,
): Omit<FakeGrant, "status" | "revision"> {
  const accounts = [
    {
      accountId: `${id}-acc-1`,
      displayName: "EVERYDAY ACCOUNT OF A PERSON",
      maskedNumber: "xxx-xxx xxxx1234",
      productCategory: "TRANS_AND_SAVINGS_ACCOUNTS",
      accountType: "TRANS_AND_SAVINGS_ACCOUNTS",
      productName: "Everyday",
      providerId: "bank-a",
      providerName: "BANK A",
      isOwned: true,
      status: "OPEN",
    },
    {
      accountId: `${id}-acc-2`,
      displayName: "CARD OF A PERSON",
      maskedNumber: "xxxx xxxx xxxx 9876",
      productCategory: "CRED_AND_CHRG_CARDS",
      accountType: "CRED_AND_CHRG_CARDS",
      productName: "Card",
      providerId: "bank-a",
      providerName: "BANK A",
      isOwned: true,
      status: "OPEN",
    },
  ];
  const transactions: FakeTransaction[] = [];
  let n = 0;
  for (let m = 0; m < months; m++)
    for (let k = 0; k < perMonth; k++) {
      const month = new Date(Date.UTC(2026, 9 - m, 1 + (k % 28)));
      const date = month.toISOString().slice(0, 10);
      transactions.push({
        transactionId: `${id}-t-${++n}`,
        accountId: accounts[k % 2]!.accountId,
        amount: k === 0 ? "2500.00" : `-${(10 + k).toFixed(2)}`,
        currency: "AUD",
        transactionDate: date,
        postedDateTime: `${date}T01:00:00Z`,
        description: k === 0 ? "SALARY INVENTED EMPLOYER" : `INVENTED MERCHANT ${k}`,
        reference: k === 0 ? "PAY 0001" : "",
        transactionType: k === 0 ? "TRANSFER_INCOMING" : "PAYMENT",
        status: "POSTED",
        merchantCategoryCode: k === 0 ? undefined : "5411",
        merchantName: k === 0 ? undefined : `INVENTED MERCHANT ${k}`,
      });
    }
  return { id, userId: `user-${id}`, accounts, transactions };
}
