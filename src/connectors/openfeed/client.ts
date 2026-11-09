// SIG-61: the openfeed connector, written to openfeed's published OpenAPI spec and developer docs
// (read 9 November 2026; SIG-61 comment 40194). It is tested against a fake openfeed only. Nothing
// in the repository calls openfeed production.
//
// What openfeed allows, and so what this client does:
// - Client authentication is private_key_jwt, PS256 (jose.ts). Endpoints come from the issuer's
//   discovery document.
// - client_credentials tokens carry only openfeed-au:app:all:read and openfeed-au:grant:all:list.
//   They list grants (the revocation poller) and can't read data.
// - Data needs the person's own token, from the authorisation-code flow: PAR, PKCE S256 and
//   DPoP-bound tokens (openfeed-au:data:banking:read, openfeed-au:grant:self:query). So ingestion
//   runs while the person is connecting (connect.ts).
// - Collections page with limit and offset (at most 1000), and links.next while more remain.
//   The grant list pages with meta.hasNext.
// - Errors: 403 disclosure_grant_required means the grant is revoked; 402 credit_exhausted is
//   billing, not revocation; 429 is retried with back-off; a DPoP nonce is retried once.
//
// openfeed has no webhooks (CLAUDE.md). Error messages name the status and openfeed's code, never a
// token, a body or an identifier.
import { createHash } from "node:crypto";
import { clientAssertion, dpopProof, type Signer } from "./jose.js";

export type FetchResponse = {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};
export type Fetch = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<FetchResponse>;

export class OpenfeedError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    what: string,
  ) {
    super(`openfeed ${what}: HTTP ${status}${code ? ` (${code})` : ""}`);
  }
}
/** 403 disclosure_grant_required, or a refresh refused: the grant is gone. */
export class GrantRevokedError extends OpenfeedError {}
/** 402 credit_exhausted: the grant is suspended for billing. Consent is intact. */
export class CreditExhaustedError extends OpenfeedError {}

export type UserTokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  /** Seconds since the epoch. */
  expiresAt: number;
  grantId: string;
};

export type GrantIndexItem = { id: string; revision: number };
export type GrantDetail = {
  grant_id: string;
  grantStatus: "ACTIVE" | "REVOKED" | string;
  bankingAccountIds: string[];
  meteringState?: string;
};
export type BankingAccount = { accountId: string; [field: string]: unknown };
export type BankingTransaction = {
  transactionId: string;
  accountId: string;
  [field: string]: unknown;
};

export type ClientConfig = {
  clientId: string;
  redirectUri: string;
  /** https://auth.openfeed.au in production. */
  issuer: string;
  /** https://api.openfeed.au in production. */
  apiBase: string;
  clientSigner: Signer;
  dpopSigner: Signer;
  fetch: Fetch;
  nowSeconds: () => number;
  /** A fresh UUID for each jti. */
  newId: () => string;
  sleep: (ms: number) => Promise<void>;
};

export const APP_SCOPES = ["openfeed-au:grant:all:list"] as const;
export const USER_SCOPES = [
  "openfeed-au:data:banking:read",
  "openfeed-au:grant:self:query",
] as const;
const PAGE = 1000;
const RETRIES_429 = 4;

/** The PKCE S256 challenge: base64url(SHA-256(verifier)) (RFC 7636). */
export const pkceChallenge = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

type Discovery = {
  token_endpoint: string;
  pushed_authorization_request_endpoint: string;
  authorization_endpoint: string;
};

const parse = async (r: FetchResponse): Promise<Record<string, unknown>> => {
  const text = await r.text();
  if (!text) return {};
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
const codeOf = (body: Record<string, unknown>): string | null => {
  const c = body.code ?? body.error;
  // Only a short machine code is kept: anything else could carry data.
  return typeof c === "string" && /^[a-z_]{1,40}$/.test(c) ? c : null;
};

export class OpenfeedClient {
  private discovery: Promise<Discovery> | null = null;
  private appToken: { token: string; expiresAt: number } | null = null;

  constructor(readonly config: ClientConfig) {}

  private discover(): Promise<Discovery> {
    this.discovery ??= (async () => {
      const r = await this.config.fetch(`${this.config.issuer}/.well-known/openid-configuration`, {
        method: "GET",
      });
      if (r.status !== 200) throw new OpenfeedError(r.status, null, "discovery");
      const d = await parse(r);
      for (const k of [
        "token_endpoint",
        "pushed_authorization_request_endpoint",
        "authorization_endpoint",
      ])
        if (typeof d[k] !== "string") throw new Error(`openfeed discovery has no ${k}`);
      return d as unknown as Discovery;
    })();
    return this.discovery;
  }

  private async assertionForm(extra: Record<string, string>): Promise<string> {
    const { clientId, issuer, clientSigner, nowSeconds, newId } = this.config;
    const assertion = await clientAssertion(clientSigner, {
      clientId,
      issuer,
      now: nowSeconds(),
      jti: newId(),
    });
    return new URLSearchParams({
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
      ...extra,
    }).toString();
  }

  /** A client_credentials token for the grant list, reused until a minute before it expires. */
  private async app(): Promise<string> {
    const now = this.config.nowSeconds();
    if (this.appToken && this.appToken.expiresAt - 60 > now) return this.appToken.token;
    const { token_endpoint } = await this.discover();
    const r = await this.config.fetch(token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: await this.assertionForm({
        grant_type: "client_credentials",
        scope: APP_SCOPES.join(" "),
      }),
    });
    const body = await parse(r);
    if (r.status !== 200 || typeof body.access_token !== "string")
      throw new OpenfeedError(r.status, codeOf(body), "app token");
    this.appToken = { token: body.access_token, expiresAt: now + Number(body.expires_in ?? 60) };
    return body.access_token;
  }

  /** Every grant the app holds, with its revision (the revocation poller's input). */
  async listGrants(): Promise<GrantIndexItem[]> {
    const out: GrantIndexItem[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const token = await this.app();
      const r = await this.config.fetch(
        `${this.config.apiBase}/v1/app/grants?limit=${PAGE}&offset=${offset}`,
        { method: "GET", headers: { authorization: `Bearer ${token}` } },
      );
      const body = await parse(r);
      if (r.status !== 200) throw new OpenfeedError(r.status, codeOf(body), "grant list");
      const data = Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
      for (const g of data)
        if (typeof g.id === "string" && typeof g.revision === "number")
          out.push({ id: g.id, revision: g.revision });
      const meta = body.meta as { hasNext?: boolean } | undefined;
      if (!meta?.hasNext || data.length === 0) return out;
    }
  }

  /** Pushes the authorisation request (PAR, PKCE S256); returns the URL to send the person to. */
  async pushAuthorization(o: {
    state: string;
    codeVerifier: string;
  }): Promise<{ requestUri: string; authorizeUrl: string }> {
    const d = await this.discover();
    const r = await this.config.fetch(d.pushed_authorization_request_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: await this.assertionForm({
        client_id: this.config.clientId,
        response_type: "code",
        redirect_uri: this.config.redirectUri,
        scope: USER_SCOPES.join(" "),
        state: o.state,
        code_challenge: pkceChallenge(o.codeVerifier),
        code_challenge_method: "S256",
      }),
    });
    const body = await parse(r);
    if ((r.status !== 201 && r.status !== 200) || typeof body.request_uri !== "string")
      throw new OpenfeedError(r.status, codeOf(body), "authorisation request");
    const u = new URL(d.authorization_endpoint);
    u.searchParams.set("client_id", this.config.clientId);
    u.searchParams.set("request_uri", body.request_uri);
    return { requestUri: body.request_uri, authorizeUrl: u.toString() };
  }

  private async userToken(form: Record<string, string>, what: string): Promise<UserTokens> {
    const { token_endpoint } = await this.discover();
    let nonce: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const proof = await dpopProof(this.config.dpopSigner, {
        method: "POST",
        url: token_endpoint,
        now: this.config.nowSeconds(),
        jti: this.config.newId(),
        ...(nonce ? { nonce } : {}),
      });
      const r = await this.config.fetch(token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", dpop: proof },
        body: await this.assertionForm(form),
      });
      const body = await parse(r);
      const code = codeOf(body);
      if (code === "use_dpop_nonce" && !nonce && r.headers.get("dpop-nonce")) {
        nonce = r.headers.get("dpop-nonce") ?? undefined;
        continue;
      }
      if (r.status === 400 && code === "invalid_grant" && form.grant_type === "refresh_token")
        throw new GrantRevokedError(r.status, code, what);
      if (r.status !== 200 || typeof body.access_token !== "string")
        throw new OpenfeedError(r.status, code, what);
      return {
        accessToken: body.access_token,
        refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : "",
        tokenType: typeof body.token_type === "string" ? body.token_type : "DPoP",
        expiresAt: this.config.nowSeconds() + Number(body.expires_in ?? 0),
        grantId: typeof body.grant_id === "string" ? body.grant_id : "",
      };
    }
    throw new OpenfeedError(400, "use_dpop_nonce", what);
  }

  exchangeCode(o: { code: string; codeVerifier: string }): Promise<UserTokens> {
    return this.userToken(
      {
        grant_type: "authorization_code",
        code: o.code,
        code_verifier: o.codeVerifier,
        redirect_uri: this.config.redirectUri,
      },
      "code exchange",
    );
  }

  refresh(refreshToken: string): Promise<UserTokens> {
    return this.userToken({ grant_type: "refresh_token", refresh_token: refreshToken }, "refresh");
  }

  /** A DPoP-bound GET for the person's data, with the nonce and 429 handling. */
  private async data(
    tokens: UserTokens,
    url: string,
    what: string,
  ): Promise<Record<string, unknown>> {
    let nonce: string | undefined;
    let retries = 0;
    for (;;) {
      const proof = await dpopProof(this.config.dpopSigner, {
        method: "GET",
        url,
        now: this.config.nowSeconds(),
        jti: this.config.newId(),
        accessToken: tokens.accessToken,
        ...(nonce ? { nonce } : {}),
      });
      const r = await this.config.fetch(url, {
        method: "GET",
        headers: { authorization: `DPoP ${tokens.accessToken}`, dpop: proof },
      });
      const body = await parse(r);
      const code = codeOf(body);
      if (r.status === 200) return body;
      if (code === "use_dpop_nonce" && !nonce && r.headers.get("dpop-nonce")) {
        nonce = r.headers.get("dpop-nonce") ?? undefined;
        continue;
      }
      if (r.status === 429 && retries < RETRIES_429) {
        await this.config.sleep(1000 * 2 ** retries++);
        continue;
      }
      if (r.status === 403 && code === "disclosure_grant_required")
        throw new GrantRevokedError(r.status, code, what);
      if (r.status === 402) throw new CreditExhaustedError(r.status, code, what);
      throw new OpenfeedError(r.status, code, what);
    }
  }

  private async collection<T>(tokens: UserTokens, first: string, what: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = first;
    while (url) {
      const body = await this.data(tokens, url, what);
      if (Array.isArray(body.data)) out.push(...(body.data as T[]));
      const next = (body.links as { next?: unknown } | undefined)?.next;
      // Follow next only on openfeed's own API host.
      url =
        typeof next === "string" && new URL(next).origin === new URL(this.config.apiBase).origin
          ? next
          : undefined;
    }
    return out;
  }

  async getGrant(tokens: UserTokens, grantId: string): Promise<GrantDetail> {
    const body = await this.data(
      tokens,
      `${this.config.apiBase}/v1/grants/${encodeURIComponent(grantId)}`,
      "grant",
    );
    const d = body.data as Record<string, unknown> | undefined;
    if (!d || typeof d.grantStatus !== "string") throw new OpenfeedError(200, null, "grant shape");
    return {
      grant_id: String(d.grant_id ?? grantId),
      grantStatus: d.grantStatus,
      bankingAccountIds: Array.isArray(d.bankingAccountIds) ? d.bankingAccountIds.map(String) : [],
      ...(typeof d.meteringState === "string" ? { meteringState: d.meteringState } : {}),
    };
  }

  listAccounts(tokens: UserTokens): Promise<BankingAccount[]> {
    return this.collection(
      tokens,
      `${this.config.apiBase}/v1/banking/accounts?limit=${PAGE}`,
      "accounts",
    );
  }

  listTransactions(
    tokens: UserTokens,
    accountId: string,
    window: { oldestDate: string; newestDate: string },
  ): Promise<BankingTransaction[]> {
    const q = new URLSearchParams({
      oldestDate: window.oldestDate,
      newestDate: window.newestDate,
      limit: String(PAGE),
    });
    return this.collection(
      tokens,
      `${this.config.apiBase}/v1/banking/accounts/${encodeURIComponent(accountId)}/transactions?${q}`,
      "transactions",
    );
  }
}
