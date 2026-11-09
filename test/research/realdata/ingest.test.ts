// SIG-61 (10:50, item 4): ingestion from openfeed into the secure store, against the fake openfeed.
// It runs once, while the person is connecting, with their own DPoP-bound token (openfeed's
// client-credentials tokens can't read data). It keeps only the fields the engines read, writes
// only to the secure stores, is all-or-nothing, purges at once if the grant is revoked mid-way, and
// returns a summary of counts that the T2 guard accepts. Every value is invented.
import { describe, expect, it } from "vitest";
import { OpenfeedClient } from "../../../src/connectors/openfeed/client.js";
import { consentRecord } from "../../../src/research/realdata/consent.js";
import { guardRunRecord } from "../../../src/research/realdata/guard.js";
import {
  ingestGrant,
  LOOKBACK_MONTHS,
  TRANSACTION_FIELDS,
} from "../../../src/research/realdata/ingest.js";
import { aesSealer } from "../../../src/research/realdata/sealer.js";
import { MemoryStore, STORES, type ConsumerStore } from "../../../src/research/realdata/stores.js";
import {
  API,
  CLIENT_ID,
  FakeOpenfeed,
  inventedGrant,
  ISSUER,
  REDIRECT,
} from "../../connectors/openfeed/fake.js";

const REF = "cr_0000000000000000aaaa";
const OTHER = "cr_0000000000000000bbbb";
const AS_OF = "2026-10-31";

async function setup(months = 14, perMonth = 30) {
  const fake = new FakeOpenfeed();
  fake.pageSize = 100;
  let id = 0;
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
    sleep: async () => {},
  });
  fake.addGrant(inventedGrant("g1", months, perMonth));
  const verifier = "v".repeat(48);
  const par = await client.pushAuthorization({ state: "s", codeVerifier: verifier });
  const tokens = await client.exchangeCode({
    code: fake.authorise(par.requestUri, "g1").code,
    codeVerifier: verifier,
  });
  const stores: ConsumerStore[] = STORES.map((n) => new MemoryStore(n));
  const sealer = aesSealer(Buffer.alloc(32, 7));
  const consent = consentRecord({
    consumerRef: REF,
    recordedOn: "2026-11-10",
    purposeVersion: "1",
    noticeVersion: "0.1",
  });
  const deps = { api: client, stores, sealer };
  const input = { consumerRef: REF, tokens, asOf: AS_OF, consent, revision: 1 };
  return { fake, client, stores, sealer, deps, input };
}
const store = (stores: ConsumerStore[], n: string) => stores.find((s) => s.name === n)!;
const allRecords = async (stores: ConsumerStore[], ref: string) =>
  (await Promise.all(stores.map((s) => s.get(ref)))).flat();

describe("ingestion into the secure store", () => {
  it("stores the accounts and the transactions inside the 12-month lookback", async () => {
    const { deps, input, stores } = await setup();
    const summary = await ingestGrant(deps, input);
    expect(LOOKBACK_MONTHS).toBe(12);
    expect(summary).toMatchObject({ status: "complete", accounts: 2, transactions: 12 * 30 });
    const raw = await store(stores, "raw_grant_data").get(REF);
    const txns = raw.flatMap((r) => (r as { transactions?: unknown[] }).transactions ?? []);
    expect(txns).toHaveLength(12 * 30);
  });

  it("keeps only the fields the engines read", async () => {
    const { deps, input, stores } = await setup();
    await ingestGrant(deps, input);
    const raw = (await store(stores, "raw_grant_data").get(REF)) as Record<string, unknown>[];
    const accounts = raw.filter((r) => r.kind === "account");
    for (const a of accounts) {
      const acc = a.account as Record<string, unknown>;
      expect(acc).not.toHaveProperty("displayName");
      expect(acc).not.toHaveProperty("maskedNumber");
      expect(acc).not.toHaveProperty("accountNumber");
    }
    const txns = raw.flatMap(
      (r) => (r.transactions as Record<string, unknown>[] | undefined) ?? [],
    );
    for (const t of txns) for (const k of Object.keys(t)) expect(TRANSACTION_FIELDS).toContain(k);
  });

  it("never asks for account detail (where openfeed returns the unmasked account number)", async () => {
    const { deps, input, fake } = await setup();
    await ingestGrant(deps, input);
    const detail = fake.calls.filter((c) =>
      /\/v1\/banking\/accounts\/[^/]+$/.test(new URL(c.url).pathname),
    );
    expect(detail).toEqual([]);
  });

  it("keeps the grant link with the refresh token sealed, never in clear", async () => {
    const { deps, input, stores, sealer } = await setup();
    await ingestGrant(deps, input);
    const [link] = (await store(stores, "openfeed_grants").get(REF)) as Record<string, unknown>[];
    expect(link).toMatchObject({ grant_id: "g1", revision: 1, consumer_ref: REF });
    expect(JSON.stringify(link)).not.toContain(input.tokens.refreshToken);
    expect(await sealer.unseal(String(link!.sealed_refresh_token), REF)).toBe(
      input.tokens.refreshToken,
    );
  });

  it("records the consent and the purge date with the link", async () => {
    const { deps, input, stores } = await setup();
    await ingestGrant(deps, input);
    const [link] = (await store(stores, "openfeed_grants").get(REF)) as Record<string, unknown>[];
    expect(link).toMatchObject({
      retention: "purge_after_comparison",
      purge_by: "2026-12-10",
      consent: { deidentification_consent: false },
    });
  });

  it("returns a summary of counts the T2 guard accepts", async () => {
    const { deps, input } = await setup();
    const summary = await ingestGrant(deps, input);
    expect(guardRunRecord(summary).violations).toEqual([]);
    expect(JSON.stringify(summary)).not.toContain("g1");
    expect(JSON.stringify(summary)).not.toContain(REF);
  });

  it("purges everything at once if the grant is revoked part-way through", async () => {
    const { deps, input, stores, fake } = await setup();
    await store(stores, "truth_capture").put(REF, "t1", { invented: true });
    await store(stores, "raw_grant_data").put(OTHER, "r1", { invented: true });
    let n = 0;
    fake.beforeCall = (url) => {
      if (url.includes("/transactions") && ++n === 3) fake.revoke("g1");
    };
    const summary = await ingestGrant(deps, input);
    expect(summary.status).toBe("revoked");
    expect(summary.purge?.status).toBe("complete");
    expect(await allRecords(stores, REF)).toEqual([]);
    expect(await store(stores, "raw_grant_data").count(OTHER)).toBe(1);
  });

  it("is all-or-nothing: any other failure leaves no partial data for the person", async () => {
    const { deps, input, stores, fake } = await setup();
    let n = 0;
    fake.beforeCall = (url) => {
      if (url.includes("/transactions") && ++n === 2) fake.failNext = [500];
    };
    await expect(ingestGrant(deps, input)).rejects.toThrow(/500/);
    expect(await allRecords(stores, REF)).toEqual([]);
  });

  it("refuses a grant that isn't ACTIVE, storing nothing", async () => {
    const { deps, input, stores, fake } = await setup();
    fake.revoke("g1");
    const summary = await ingestGrant(deps, input);
    expect(summary.status).toBe("revoked");
    expect(await allRecords(stores, REF)).toEqual([]);
  });

  it("refuses to write anywhere but the secure stores", async () => {
    const { deps, input } = await setup();
    await expect(
      ingestGrant(
        { ...deps, stores: deps.stores.filter((s) => s.name !== "openfeed_grants") },
        input,
      ),
    ).rejects.toThrow(/every store/);
  });
});
