// SIG-61 T3 and H0 (Colin, 07:26 and 10:50 on 9 November 2026): when openfeed signals a revocation,
// it is detected within 15 minutes and the person's data is purged from every Signals store within
// 24 hours. openfeed has no webhooks, so the poller lists grants every 5 minutes and fails closed:
// a grant that disappears, or whose revision changes and can't be confirmed ACTIVE, is purged.
// The timeline tests drive the poller with explicit times; nothing reads the clock.
import { describe, expect, it } from "vitest";
import { OpenfeedClient } from "../../../src/connectors/openfeed/client.js";
import { consentRecord } from "../../../src/research/realdata/consent.js";
import { guardRunRecord } from "../../../src/research/realdata/guard.js";
import { ingestGrant } from "../../../src/research/realdata/ingest.js";
import {
  DETECT_WITHIN_MINUTES,
  MemoryRevocationState,
  POLL_INTERVAL_MINUTES,
  pollRevocations,
  PURGE_WITHIN_HOURS,
  reportRevoked,
} from "../../../src/research/realdata/revocation.js";
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

const T0 = Date.parse("2026-11-10T00:00:00Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

/** A store that fails while `down` is true, standing in for an outage. */
class FlakyStore extends MemoryStore {
  down = false;
  override async deleteConsumer(ref: string) {
    if (this.down) throw new Error("outage");
    return super.deleteConsumer(ref);
  }
  override async count(ref: string) {
    if (this.down) throw new Error("outage");
    return super.count(ref);
  }
}

async function setup(people = ["a", "b"]) {
  const fake = new FakeOpenfeed();
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
  const stores = STORES.map((n) => new FlakyStore(n));
  const sealer = aesSealer(Buffer.alloc(32, 9));
  const state = new MemoryRevocationState();
  const refs: Record<string, string> = {};
  for (const p of people) {
    const ref = `cr_00000000000000000${p}${p}${p}`;
    refs[p] = ref;
    fake.addGrant(inventedGrant(`g-${p}`, 3, 5));
    const verifier = `${p}`.repeat(48);
    const par = await client.pushAuthorization({ state: p, codeVerifier: verifier });
    const tokens = await client.exchangeCode({
      code: fake.authorise(par.requestUri, `g-${p}`).code,
      codeVerifier: verifier,
    });
    const consent = consentRecord({
      consumerRef: ref,
      recordedOn: "2026-11-10",
      purposeVersion: "1",
    });
    await ingestGrant(
      { api: client, stores, sealer },
      { consumerRef: ref, tokens, asOf: "2026-10-31", consent, revision: 1 },
    );
  }
  const deps = { api: client, stores: stores as ConsumerStore[], sealer, state };
  return { fake, client, stores, sealer, state, deps, refs };
}
const held = async (stores: ConsumerStore[], ref: string) =>
  (await Promise.all(stores.map((s) => s.count(ref).catch(() => -1)))).reduce((a, b) => a + b, 0);

/** Runs the poller every POLL_INTERVAL_MINUTES from `from` to `to`; returns each report. */
async function run(deps: Parameters<typeof pollRevocations>[0], from: number, to: number) {
  const reports = [];
  for (let m = from; m <= to; m += POLL_INTERVAL_MINUTES)
    reports.push({ m, r: await pollRevocations(deps, at(m)) });
  return reports;
}

describe("revocation: detected within 15 minutes, purged within 24 hours", () => {
  it("polls every 5 minutes against a 15-minute detection and a 24-hour purge target", () => {
    expect(POLL_INTERVAL_MINUTES).toBe(5);
    expect(DETECT_WITHIN_MINUTES).toBe(15);
    expect(PURGE_WITHIN_HOURS).toBe(24);
  });

  it("detects a revocation on the next poll and purges every store, leaving others untouched", async () => {
    const { fake, deps, refs, stores } = await setup();
    await pollRevocations(deps, at(0));
    fake.revoke("g-a"); // just after the poll at minute 0
    const reports = await run(deps, 5, 15);
    const detectedAt = reports.find((x) => x.r.detected > 0)!.m;
    expect(detectedAt - 0).toBeLessThanOrEqual(DETECT_WITHIN_MINUTES);
    expect(reports[0]!.r).toMatchObject({ detected: 1, purged: 1, pending: 0 });
    expect(await held(stores, refs.a!)).toBe(0);
    expect(await held(stores, refs.b!)).toBeGreaterThan(0);
  });

  it("purges a grant that disappears from openfeed's list", async () => {
    const { fake, deps, refs, stores } = await setup();
    fake.grants.delete("g-a");
    const r = await pollRevocations(deps, at(0));
    expect(r).toMatchObject({ detected: 1, purged: 1 });
    expect(await held(stores, refs.a!)).toBe(0);
  });

  it("keeps a grant whose revision changed but which openfeed confirms ACTIVE", async () => {
    const { fake, deps, refs, stores } = await setup();
    fake.grants.get("g-a")!.revision += 1; // the person added an account, say
    const before = await held(stores, refs.a!);
    const r = await pollRevocations(deps, at(0));
    expect(r).toMatchObject({ detected: 0, purged: 0 });
    expect(await held(stores, refs.a!)).toBe(before);
    // The new revision is recorded, so the next poll is quiet.
    expect((await pollRevocations(deps, at(5))).checked).toBe(0);
  });

  it("fails closed: a changed grant that can't be confirmed ACTIVE is purged", async () => {
    const { fake, deps, refs, stores } = await setup();
    fake.grants.get("g-a")!.revision += 1;
    fake.failNext = [500]; // the status check fails
    const r = await pollRevocations(deps, at(0));
    expect(r).toMatchObject({ detected: 1, purged: 1 });
    expect(await held(stores, refs.a!)).toBe(0);
  });

  it("purges at once on a 403 disclosure_grant_required seen anywhere else", async () => {
    const { deps, refs, stores } = await setup();
    const receipt = await reportRevoked(deps, refs.a!, at(1));
    expect(receipt.status).toBe("complete");
    expect(await held(stores, refs.a!)).toBe(0);
  });

  it("retries a failed purge on every poll until it completes", async () => {
    const { fake, deps, refs, stores } = await setup();
    stores[0]!.down = true;
    fake.revoke("g-a");
    const first = await pollRevocations(deps, at(0));
    expect(first).toMatchObject({ detected: 1, purged: 0, pending: 1, overdue: 0 });
    await run(deps, 5, 180);
    stores[0]!.down = false;
    const after = await pollRevocations(deps, at(185));
    expect(after).toMatchObject({ purged: 1, pending: 0 });
    expect(await held(stores, refs.a!)).toBe(0);
  });

  it("raises an overdue alarm if a purge is still pending 24 hours after detection", async () => {
    const { fake, deps, stores } = await setup();
    stores[0]!.down = true;
    fake.revoke("g-a");
    await pollRevocations(deps, at(0));
    expect((await pollRevocations(deps, at(24 * 60 - 5))).overdue).toBe(0);
    expect((await pollRevocations(deps, at(24 * 60 + 5))).overdue).toBe(1);
  });

  it("flags detection at risk when openfeed's grant list can't be read for 10 minutes", async () => {
    const { fake, deps } = await setup();
    await pollRevocations(deps, at(0));
    fake.grantsDown = true;
    expect((await pollRevocations(deps, at(5))).detection_at_risk).toBe(false);
    const r = await pollRevocations(deps, at(15));
    expect(r).toMatchObject({ poll_failed: true, detection_at_risk: true, purged: 0 });
  });

  it("returns a report the T2 guard accepts", async () => {
    const { fake, deps } = await setup();
    fake.revoke("g-a");
    const r = await pollRevocations(deps, at(0));
    expect(guardRunRecord(r).violations).toEqual([]);
  });
});
