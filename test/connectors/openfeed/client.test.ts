// SIG-61: the openfeed connector, against the fake openfeed (test/connectors/openfeed/fake.ts),
// which checks every client assertion and DPoP proof the way openfeed's docs describe. Nothing
// here calls the network.
import { describe, expect, it } from "vitest";
import {
  CreditExhaustedError,
  GrantRevokedError,
  OpenfeedClient,
  OpenfeedError,
  pkceChallenge,
} from "../../../src/connectors/openfeed/client.js";
import { API, CLIENT_ID, FakeOpenfeed, inventedGrant, ISSUER, REDIRECT } from "./fake.js";

function setup() {
  const fake = new FakeOpenfeed();
  let id = 0;
  const sleeps: number[] = [];
  const client = new OpenfeedClient({
    clientId: CLIENT_ID,
    redirectUri: REDIRECT,
    issuer: ISSUER,
    apiBase: API,
    clientSigner: fake.signer(),
    dpopSigner: fake.dpopSigner(),
    fetch: fake.fetch,
    nowSeconds: () => fake.now,
    newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { fake, client, sleeps };
}

async function connect(fake: FakeOpenfeed, client: OpenfeedClient, grantId: string) {
  const verifier = "v".repeat(43) + grantId;
  const par = await client.pushAuthorization({ state: "state-1", codeVerifier: verifier });
  const { code } = fake.authorise(par.requestUri, grantId);
  return client.exchangeCode({ code, codeVerifier: verifier });
}

describe("openfeed connector: authentication", () => {
  it("authenticates with a PS256 private_key_jwt whose aud is the issuer and whose jti is fresh", async () => {
    const { fake, client } = setup();
    fake.addGrant(inventedGrant("g1"));
    await client.listGrants();
    await client.listGrants();
    // The fake rejects a reused jti, a wrong aud or iss, and an assertion living over 60 seconds.
    expect(fake.seenJti.size).toBeGreaterThanOrEqual(1);
  });

  it("asks client_credentials only for the two app scopes openfeed issues to them", async () => {
    const { fake, client } = setup();
    fake.addGrant(inventedGrant("g1"));
    await expect(client.listGrants()).resolves.toEqual([{ id: "g1", revision: 1 }]);
  });

  it("pushes the authorisation request with PKCE S256 and returns the authorize URL", async () => {
    const { client } = setup();
    const par = await client.pushAuthorization({ state: "s", codeVerifier: "a".repeat(43) });
    expect(par.requestUri).toMatch(/^urn:ietf:params:oauth:request_uri:/);
    const u = new URL(par.authorizeUrl);
    expect(u.origin + u.pathname).toBe(`${ISSUER}/oauth/authorize`);
    expect(u.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(u.searchParams.get("request_uri")).toBe(par.requestUri);
  });

  it("computes the S256 challenge as base64url(SHA-256(verifier)) (RFC 7636 appendix B)", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("exchanges the code for DPoP-bound tokens naming the grant", async () => {
    const { fake, client } = setup();
    fake.addGrant(inventedGrant("g1"));
    const tokens = await connect(fake, client, "g1");
    expect(tokens.grantId).toBe("g1");
    expect(tokens.tokenType).toBe("DPoP");
    expect(tokens.refreshToken).toBeTruthy();
    expect(tokens.expiresAt).toBe(fake.now + 300);
  });

  it("refreshes, and a refresh on a revoked grant is a GrantRevokedError", async () => {
    const { fake, client } = setup();
    fake.addGrant(inventedGrant("g1"));
    const t1 = await connect(fake, client, "g1");
    const t2 = await client.refresh(t1.refreshToken);
    expect(t2.accessToken).not.toBe(t1.accessToken);
    fake.revoke("g1");
    await expect(client.refresh(t2.refreshToken)).rejects.toBeInstanceOf(GrantRevokedError);
  });

  it("retries once with the server's DPoP nonce", async () => {
    const { fake, client } = setup();
    fake.addGrant(inventedGrant("g1"));
    const tokens = await connect(fake, client, "g1");
    fake.requireNonce = "nonce-1";
    await expect(client.getGrant(tokens, "g1")).resolves.toMatchObject({ grantStatus: "ACTIVE" });
  });
});

describe("openfeed connector: data", () => {
  it("lists every grant across pages", async () => {
    const { fake, client } = setup();
    for (let i = 0; i < 2500; i++)
      fake.addGrant({ id: `g${i}`, userId: "u", accounts: [], transactions: [] });
    const grants = await client.listGrants();
    expect(grants).toHaveLength(2500);
    expect(new Set(grants.map((g) => g.id)).size).toBe(2500);
  });

  it("reads the grant, its accounts and every transaction page within the dates asked", async () => {
    const { fake, client } = setup();
    fake.pageSize = 100;
    fake.addGrant(inventedGrant("g1", 14, 30));
    const tokens = await connect(fake, client, "g1");
    const grant = await client.getGrant(tokens, "g1");
    expect(grant.bankingAccountIds).toEqual(["g1-acc-1", "g1-acc-2"]);
    const accounts = await client.listAccounts(tokens);
    expect(accounts.map((a) => a.accountId)).toEqual(["g1-acc-1", "g1-acc-2"]);
    const txns = await client.listTransactions(tokens, "g1-acc-1", {
      oldestDate: "2025-11-01",
      newestDate: "2026-10-31",
    });
    expect(txns).toHaveLength(12 * 15);
    expect(txns.every((t) => t.accountId === "g1-acc-1")).toBe(true);
  });

  it("never sends a client_credentials token to a data endpoint", async () => {
    const { fake, client } = setup();
    fake.addGrant(inventedGrant("g1"));
    const tokens = await connect(fake, client, "g1");
    await client.listAccounts(tokens);
    const data = fake.calls.filter((c) => c.url.startsWith(`${API}/v1/banking`));
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((c) => c.auth?.startsWith("DPoP "))).toBe(true);
  });

  it("maps 403 disclosure_grant_required to GrantRevokedError", async () => {
    const { fake, client } = setup();
    fake.addGrant(inventedGrant("g1"));
    const tokens = await connect(fake, client, "g1");
    fake.revoke("g1");
    await expect(client.listAccounts(tokens)).rejects.toBeInstanceOf(GrantRevokedError);
  });

  it("maps 402 credit_exhausted to CreditExhaustedError, which is not a revocation", async () => {
    const { fake, client } = setup();
    fake.addGrant(inventedGrant("g1"));
    const tokens = await connect(fake, client, "g1");
    fake.failNext = [402];
    const err = await client.listAccounts(tokens).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CreditExhaustedError);
    expect(err).not.toBeInstanceOf(GrantRevokedError);
  });

  it("backs off and retries on 429, then gives up after four retries", async () => {
    const { fake, client, sleeps } = setup();
    fake.addGrant(inventedGrant("g1"));
    const tokens = await connect(fake, client, "g1");
    fake.failNext = [429, 429];
    await expect(client.listAccounts(tokens)).resolves.toHaveLength(2);
    expect(sleeps).toEqual([1000, 2000]);
    fake.failNext = [429, 429, 429, 429, 429];
    await expect(client.listAccounts(tokens)).rejects.toBeInstanceOf(OpenfeedError);
  });

  it("names the status and openfeed's code in errors, never a response body or token", async () => {
    const { fake, client } = setup();
    fake.addGrant(inventedGrant("g1"));
    const tokens = await connect(fake, client, "g1");
    fake.failNext = [500];
    const err = (await client.listAccounts(tokens).catch((e: unknown) => e)) as Error;
    expect(err.message).toContain("500");
    expect(err.message).not.toContain(tokens.accessToken);
    expect(err.message).not.toContain("g1-acc");
  });
});
