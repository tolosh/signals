// SIG-61: the team member's connection, end to end against the fake openfeed. startConnect pushes
// the authorisation request (PKCE S256) and remembers the state for 10 minutes; completeConnect
// takes openfeed's callback once, exchanges the code with a DPoP-bound token and ingests. A state
// can't be replayed, and an expired or unknown one stores nothing.
import { describe, expect, it } from "vitest";
import { OpenfeedClient } from "../../../src/connectors/openfeed/client.js";
import {
  completeConnect,
  CONNECT_TTL_MINUTES,
  MemoryPendingConnects,
  startConnect,
} from "../../../src/research/realdata/connect.js";
import { guardRunRecord } from "../../../src/research/realdata/guard.js";
import { aesSealer } from "../../../src/research/realdata/sealer.js";
import { MemoryStore, STORES } from "../../../src/research/realdata/stores.js";
import {
  API,
  CLIENT_ID,
  FakeOpenfeed,
  inventedGrant,
  ISSUER,
  REDIRECT,
} from "../../connectors/openfeed/fake.js";

const REF = "cr_0000000000000000aaaa";

function setup() {
  const fake = new FakeOpenfeed();
  fake.addGrant(inventedGrant("g1", 3, 5));
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
  let r = 0;
  const random = (n: number) => Buffer.alloc(n, ++r);
  const stores = STORES.map((n) => new MemoryStore(n));
  const deps = {
    client,
    pending: new MemoryPendingConnects(),
    stores,
    sealer: aesSealer(Buffer.alloc(32, 3)),
    random,
  };
  return { fake, deps, stores };
}
const callbackFor = (fake: FakeOpenfeed, authorizeUrl: string) =>
  fake.authorise(new URL(authorizeUrl).searchParams.get("request_uri")!, "g1");

describe("connecting a team member", () => {
  it("starts with a pushed authorisation request and completes into the secure store", async () => {
    const { fake, deps, stores } = setup();
    const { authorizeUrl } = await startConnect(deps, {
      consumerRef: REF,
      at: "2026-11-10T00:00:00Z",
    });
    const { code, state } = callbackFor(fake, authorizeUrl);
    const summary = await completeConnect(deps, {
      code,
      state,
      at: "2026-11-10T00:03:00Z",
      purposeVersion: "1",
    });
    expect(summary).toMatchObject({ status: "complete", accounts: 2 });
    expect(guardRunRecord(summary).violations).toEqual([]);
    expect(await stores.find((s) => s.name === "openfeed_grants")!.count(REF)).toBe(1);
  });

  it("takes each state once", async () => {
    const { fake, deps } = setup();
    const { authorizeUrl } = await startConnect(deps, {
      consumerRef: REF,
      at: "2026-11-10T00:00:00Z",
    });
    const { code, state } = callbackFor(fake, authorizeUrl);
    await completeConnect(deps, { code, state, at: "2026-11-10T00:01:00Z", purposeVersion: "1" });
    await expect(
      completeConnect(deps, { code, state, at: "2026-11-10T00:02:00Z", purposeVersion: "1" }),
    ).rejects.toThrow(/unknown or expired/);
  });

  it(`refuses a state older than ${CONNECT_TTL_MINUTES} minutes, storing nothing`, async () => {
    const { fake, deps, stores } = setup();
    expect(CONNECT_TTL_MINUTES).toBe(10);
    const { authorizeUrl } = await startConnect(deps, {
      consumerRef: REF,
      at: "2026-11-10T00:00:00Z",
    });
    const { code, state } = callbackFor(fake, authorizeUrl);
    await expect(
      completeConnect(deps, { code, state, at: "2026-11-10T00:11:00Z", purposeVersion: "1" }),
    ).rejects.toThrow(/unknown or expired/);
    for (const s of stores) expect(await s.count(REF)).toBe(0);
  });

  it("refuses an unknown state", async () => {
    const { deps } = setup();
    await expect(
      completeConnect(deps, {
        code: "c",
        state: "nope",
        at: "2026-11-10T00:00:00Z",
        purposeVersion: "1",
      }),
    ).rejects.toThrow(/unknown or expired/);
  });

  it("uses a fresh 32-byte state and verifier each time", async () => {
    const { deps } = setup();
    const a = await startConnect(deps, { consumerRef: REF, at: "2026-11-10T00:00:00Z" });
    const b = await startConnect(deps, { consumerRef: REF, at: "2026-11-10T00:00:00Z" });
    expect(a.state).not.toBe(b.state);
    expect(Buffer.from(a.state, "base64url")).toHaveLength(32);
  });
});

describe("invites and the stored connection state", () => {
  it("derives the opaque consumer reference from a private invite token, one way", async () => {
    const { consumerRefFromInvite } = await import("../../../src/research/realdata/connect.js");
    const invite = Buffer.alloc(32, 5).toString("base64url");
    const ref = consumerRefFromInvite(invite);
    expect(ref).toMatch(/^cr_[0-9a-f]{32}$/);
    expect(consumerRefFromInvite(invite)).toBe(ref);
    expect(consumerRefFromInvite(Buffer.alloc(32, 6).toString("base64url"))).not.toBe(ref);
    expect(ref).not.toContain(invite);
  });

  it("refuses a short or malformed invite", async () => {
    const { consumerRefFromInvite } = await import("../../../src/research/realdata/connect.js");
    expect(() => consumerRefFromInvite("short")).toThrow(/invite/);
    expect(() => consumerRefFromInvite("x".repeat(43) + "!")).toThrow(/invite/);
  });
});
