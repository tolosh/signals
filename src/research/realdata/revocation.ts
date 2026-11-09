// SIG-61 T3 and H0 (Colin, 07:26 and 10:50 on 9 November 2026): a revocation openfeed signals is
// detected within 15 minutes, and the person's data is purged from every Signals store within
// 24 hours.
//
// openfeed has no webhooks (CLAUDE.md). The secure environment's scheduler runs pollRevocations
// every POLL_INTERVAL_MINUTES. Each poll lists the app's grants with the client-credentials token
// and compares each grant link's revision:
// - a grant missing from the list is revoked;
// - a grant whose revision changed is checked with the person's sealed refresh token. It is kept
//   only if openfeed confirms it ACTIVE; anything else (REVOKED, a refused refresh, an error) is
//   treated as revoked. The poller fails closed.
// A revoked person is queued with the time of detection, and purged at once through the T3
// deletion procedure. A purge that fails stays queued and is retried on every poll. One still
// queued PURGE_WITHIN_HOURS after detection is counted as overdue, which raises the alarm. If the
// grant list can't be read for longer than DETECT_WITHIN_MINUTES minus one interval, detection is
// at risk, which raises the other alarm. A 403 disclosure_grant_required seen anywhere else calls
// reportRevoked, which queues and purges the same way.
//
// Times are passed in; nothing here reads the clock. The report holds counts only and passes the
// T2 guard.
import type { GrantDetail, GrantIndexItem, UserTokens } from "../../connectors/openfeed/client.js";
import { deleteConsumer, type DeletionReceipt } from "./deletion.js";
import { assertGuarded } from "./guard.js";
import type { GrantLink } from "./ingest.js";
import type { Sealer } from "./sealer.js";
import { assertConsumerRef, type ConsumerStore } from "./stores.js";

export const POLL_INTERVAL_MINUTES = 5;
export const DETECT_WITHIN_MINUTES = 15;
export const PURGE_WITHIN_HOURS = 24;
export const REPORT_SCHEMA_VERSION = "1.0.0";

export interface GrantsApi {
  listGrants(): Promise<GrantIndexItem[]>;
  refresh(refreshToken: string): Promise<UserTokens>;
  getGrant(tokens: UserTokens, grantId: string): Promise<GrantDetail>;
}

export type Pending = { consumer_ref: string; detected_at: string };
export interface RevocationState {
  pending(): Promise<Pending[]>;
  /** Queues a purge. A second detection keeps the first time. */
  enqueue(consumerRef: string, detectedAt: string): Promise<void>;
  dequeue(consumerRef: string): Promise<void>;
  lastSuccess(): Promise<string | null>;
  setLastSuccess(at: string): Promise<void>;
}

export class MemoryRevocationState implements RevocationState {
  private readonly queue = new Map<string, string>();
  private last: string | null = null;
  async pending() {
    return [...this.queue].map(([consumer_ref, detected_at]) => ({ consumer_ref, detected_at }));
  }
  async enqueue(consumerRef: string, detectedAt: string) {
    if (!this.queue.has(consumerRef)) this.queue.set(consumerRef, detectedAt);
  }
  async dequeue(consumerRef: string) {
    this.queue.delete(consumerRef);
  }
  async lastSuccess() {
    return this.last;
  }
  async setLastSuccess(at: string) {
    this.last = at;
  }
}

export type RevocationDeps = {
  api: GrantsApi;
  stores: readonly ConsumerStore[];
  sealer: Sealer;
  state: RevocationState;
};

export type PollReport = {
  record_type: "revocation_poll";
  schema_version: typeof REPORT_SCHEMA_VERSION;
  data_source: "openfeed-production";
  polled_on: string;
  grant_links: number;
  /** Links whose revision changed and were checked with openfeed. */
  checked: number;
  detected: number;
  purged: number;
  pending: number;
  overdue: number;
  poll_failed: boolean;
  detection_at_risk: boolean;
};

const ms = (iso: string) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error("Times are ISO 8601 date-times");
  return t;
};
const linksStore = (stores: readonly ConsumerStore[]) => {
  const s = stores.find((x) => x.name === "openfeed_grants");
  if (!s) throw new Error("The openfeed_grants store is required");
  return s;
};

async function readLinks(stores: readonly ConsumerStore[]): Promise<GrantLink[]> {
  const s = linksStore(stores);
  const out: GrantLink[] = [];
  for (const ref of await s.listConsumers())
    for (const r of await s.get(ref)) out.push(r as GrantLink);
  return out;
}

/** Purges one person through the T3 procedure; dequeues on a complete, verified receipt. */
async function purge(
  deps: RevocationDeps,
  consumerRef: string,
  at: string,
): Promise<DeletionReceipt> {
  const receipt = await deleteConsumer(deps.stores, consumerRef, at);
  if (receipt.status === "complete" && receipt.verified) await deps.state.dequeue(consumerRef);
  return receipt;
}

/** Confirms a changed grant is still ACTIVE, refreshing the sealed token. False on anything else. */
async function stillActive(
  deps: RevocationDeps,
  link: GrantLink,
  revision: number,
): Promise<boolean> {
  try {
    const refresh = await deps.sealer.unseal(link.sealed_refresh_token, link.consumer_ref);
    const tokens = await deps.api.refresh(refresh);
    const grant = await deps.api.getGrant(tokens, link.grant_id);
    if (grant.grantStatus !== "ACTIVE") return false;
    await linksStore(deps.stores).put(link.consumer_ref, "grant", {
      ...link,
      revision,
      sealed_refresh_token: tokens.refreshToken
        ? await deps.sealer.seal(tokens.refreshToken, link.consumer_ref)
        : link.sealed_refresh_token,
    } satisfies GrantLink);
    return true;
  } catch {
    return false;
  }
}

export async function pollRevocations(deps: RevocationDeps, at: string): Promise<PollReport> {
  const now = ms(at);
  let detected = 0;
  let purged = 0;
  let checked = 0;
  let pollFailed = false;

  const links = await readLinks(deps.stores);
  let grants: GrantIndexItem[] | null = null;
  try {
    grants = await deps.api.listGrants();
    await deps.state.setLastSuccess(at);
  } catch {
    pollFailed = true;
  }

  if (grants) {
    const byId = new Map(grants.map((g) => [g.id, g.revision]));
    const queued = new Set((await deps.state.pending()).map((p) => p.consumer_ref));
    for (const link of links) {
      if (queued.has(link.consumer_ref)) continue;
      const revision = byId.get(link.grant_id);
      let revoked = revision === undefined;
      if (revision !== undefined && revision !== link.revision) {
        checked++;
        revoked = !(await stillActive(deps, link, revision));
      }
      if (revoked) {
        detected++;
        await deps.state.enqueue(link.consumer_ref, at);
      }
    }
  }

  // Every queued purge is attempted on every poll, new or retried.
  for (const p of await deps.state.pending()) {
    const receipt = await purge(deps, p.consumer_ref, at).catch(() => null);
    if (receipt?.status === "complete" && receipt.verified) purged++;
  }

  const still = await deps.state.pending();
  const overdue = still.filter((p) => now - ms(p.detected_at) > PURGE_WITHIN_HOURS * 3_600_000);
  const last = await deps.state.lastSuccess();
  const riskAfter = (DETECT_WITHIN_MINUTES - POLL_INTERVAL_MINUTES) * 60_000;
  const report: PollReport = {
    record_type: "revocation_poll",
    schema_version: REPORT_SCHEMA_VERSION,
    data_source: "openfeed-production",
    polled_on: at.slice(0, 10),
    grant_links: links.length,
    checked,
    detected,
    purged,
    pending: still.length,
    overdue: overdue.length,
    poll_failed: pollFailed,
    detection_at_risk: last === null ? pollFailed : now - ms(last) > riskAfter,
  };
  assertGuarded(report);
  return report;
}

/** A revocation seen elsewhere (a 403 disclosure_grant_required): queue and purge at once. */
export async function reportRevoked(
  deps: RevocationDeps,
  consumerRef: string,
  at: string,
): Promise<DeletionReceipt> {
  assertConsumerRef(consumerRef);
  ms(at);
  await deps.state.enqueue(consumerRef, at);
  return purge(deps, consumerRef, at);
}
