// SIG-61: a team member's connection to openfeed, from start to the secure store.
// - startConnect makes a fresh state and PKCE verifier (32 random bytes each), pushes the
//   authorisation request and remembers {state -> consumer, verifier} for CONNECT_TTL_MINUTES.
//   The person goes to openfeed's authorize URL and gives the disclosure consent there. Before
//   that, connectStartStep shows Moroku's APP 5 collection notice (notice.ts; ruling N-1), and
//   startConnect refuses unless the current notice version was acknowledged.
// - completeConnect takes openfeed's callback (code, state) once. It exchanges the code for the
//   person's DPoP-bound tokens, records the consent and ingests into the secure store (ingest.ts).
//   An unknown, expired or replayed state stores nothing.
// Times and randomness are passed in.
//
// Invites: each team member gets a private invite token (32 random bytes, base64url) from Colin.
// Their opaque consumer reference is derived from it one way (consumerRefFromInvite), so the
// secure environment needs no table of people, and the reference names no one.
import { createHash } from "node:crypto";
import type { OpenfeedClient } from "../../connectors/openfeed/client.js";
import { consentRecord } from "./consent.js";
import { ingestGrant, type IngestSummary } from "./ingest.js";
import { COLLECTION_NOTICE, noticePage } from "./notice.js";
import type { Sealer } from "./sealer.js";
import { assertConsumerRef, type ConsumerStore } from "./stores.js";

export const CONNECT_TTL_MINUTES = 10;
const INVITE = /^[A-Za-z0-9_-]{43,128}$/;

/** The opaque consumer reference for an invite token: cr_ + 32 hex of a SHA-256. */
export function consumerRefFromInvite(invite: string): string {
  if (!INVITE.test(invite)) throw new Error("The invite token is malformed");
  const h = createHash("sha256").update(`signals-consumer-ref-v1|${invite}`).digest("hex");
  return `cr_${h.slice(0, 32)}`;
}

export type PendingConnect = {
  consumer_ref: string;
  code_verifier: string;
  started_at: string;
  /** The collection notice version the person was shown before going to openfeed. */
  notice_version: string;
};
export interface PendingConnects {
  put(state: string, p: PendingConnect): Promise<void>;
  /** Returns and removes the entry: a state is taken once. */
  take(state: string): Promise<PendingConnect | null>;
}
export class MemoryPendingConnects implements PendingConnects {
  private readonly m = new Map<string, PendingConnect>();
  async put(state: string, p: PendingConnect) {
    this.m.set(state, p);
  }
  async take(state: string) {
    const p = this.m.get(state) ?? null;
    this.m.delete(state);
    return p;
  }
}

export type ConnectDeps = {
  client: Pick<
    OpenfeedClient,
    "pushAuthorization" | "exchangeCode" | "getGrant" | "listAccounts" | "listTransactions"
  >;
  pending: PendingConnects;
  stores: readonly ConsumerStore[];
  sealer: Sealer;
  random: (bytes: number) => Uint8Array;
};

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");

export async function startConnect(
  deps: ConnectDeps,
  o: { consumerRef: string; at: string; noticeVersion: string },
): Promise<{ authorizeUrl: string; state: string }> {
  assertConsumerRef(o.consumerRef);
  if (o.noticeVersion !== COLLECTION_NOTICE.version)
    throw new Error("The current collection notice must be shown and acknowledged first");
  const state = b64(deps.random(32));
  const codeVerifier = b64(deps.random(32));
  const { authorizeUrl } = await deps.client.pushAuthorization({ state, codeVerifier });
  await deps.pending.put(state, {
    consumer_ref: o.consumerRef,
    code_verifier: codeVerifier,
    started_at: o.at,
    notice_version: o.noticeVersion,
  });
  return { authorizeUrl, state };
}

export async function completeConnect(
  deps: ConnectDeps,
  o: { code: string; state: string; at: string; purposeVersion: string },
): Promise<IngestSummary> {
  const p = await deps.pending.take(o.state);
  const age = p ? Date.parse(o.at) - Date.parse(p.started_at) : NaN;
  if (!p || !(age >= 0 && age <= CONNECT_TTL_MINUTES * 60_000))
    throw new Error("The connection state is unknown or expired");
  const tokens = await deps.client.exchangeCode({ code: o.code, codeVerifier: p.code_verifier });
  const today = o.at.slice(0, 10);
  const consent = consentRecord({
    consumerRef: p.consumer_ref,
    recordedOn: today,
    purposeVersion: o.purposeVersion,
    noticeVersion: p.notice_version,
  });
  // The data runs to the day before connection: today's transactions may not be posted yet.
  const asOf = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return ingestGrant(
    { api: deps.client, stores: deps.stores, sealer: deps.sealer },
    { consumerRef: p.consumer_ref, tokens, asOf, consent, revision: 1 },
  );
}

export type StartStep =
  { kind: "notice"; html: string } | { kind: "redirect"; location: string } | { kind: "refused" };

/**
 * GET /connect/start (ruling N-1, 9 November 2026): the APP 5 collection notice comes first. A
 * request without an acknowledgement of the current notice version gets the notice, with a link
 * that carries the acknowledgement; only that pushes the authorisation request and redirects to
 * openfeed. A malformed invite is refused before anything is shown.
 */
export async function connectStartStep(
  deps: ConnectDeps,
  o: { invite: string; notice?: string; at: string },
): Promise<StartStep> {
  let consumerRef: string;
  try {
    consumerRef = consumerRefFromInvite(o.invite);
  } catch {
    return { kind: "refused" };
  }
  if (o.notice !== COLLECTION_NOTICE.version) {
    const q = new URLSearchParams({ invite: o.invite, notice: COLLECTION_NOTICE.version });
    return { kind: "notice", html: noticePage(`/connect/start?${q.toString()}`) };
  }
  const { authorizeUrl } = await startConnect(deps, {
    consumerRef,
    at: o.at,
    noticeVersion: o.notice,
  });
  return { kind: "redirect", location: authorizeUrl };
}
