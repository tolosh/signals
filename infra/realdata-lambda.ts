// SIG-61: the secure environment's Lambda entry points (infra/realdata-stack.ts). Built by
// scripts/build-realdata-lambda.mjs. Not deployed: deploying needs Colin's go-ahead and openfeed's
// production registration (client ID and the registered public key).
//
// - poll: every 5 minutes (EventBridge Scheduler), the revocation poller. Its guarded log line
//   carries `overdue` and `at_risk`, which the stack's metric filters turn into the PurgeOverdue
//   and DetectionAtRisk alarms.
// - start: GET /connect/start?invite=<token>. Derives the person's opaque reference from the
//   invite, pushes the authorisation request and redirects to openfeed.
// - callback: GET /v1/openfeed/callback?code&state. Exchanges the code and ingests.
// Every line of output goes through realdataLog (the T2 guard). Responses carry no data.
import { KMSClient } from "@aws-sdk/client-kms";
import { S3Client } from "@aws-sdk/client-s3";
import { OpenfeedClient } from "../src/connectors/openfeed/client.js";
import { kmsSigner } from "../src/connectors/openfeed/kms-signer.js";
import {
  completeConnect,
  consumerRefFromInvite,
  startConnect,
} from "../src/research/realdata/connect.js";
import {
  S3PendingConnects,
  S3RevocationState,
  S3Store,
} from "../src/research/realdata/s3-store.js";
import { realdataLog } from "../src/research/realdata/log.js";
import { pollRevocations } from "../src/research/realdata/revocation.js";
import { kmsSealer } from "../src/research/realdata/sealer.js";
import { STORES } from "../src/research/realdata/stores.js";
import { randomBytes, randomUUID } from "node:crypto";

/** The version of the purpose text shown with the invite; it names the truth comparison. */
const PURPOSE_VERSION = "1";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function wiring() {
  const region = "ap-southeast-2";
  const s3 = new S3Client({ region });
  const kms = new KMSClient({ region });
  const ssend = (c: unknown) => s3.send(c as never);
  const ksend = (c: unknown) => kms.send(c as never);
  const at = (name: string) => ({
    bucket: env(`BUCKET_${name.toUpperCase()}`),
    kmsKeyId: env(name === "truth_capture" ? "TRUTH_KEY" : "DATA_KEY"),
  });
  const client = new OpenfeedClient({
    clientId: env("OPENFEED_CLIENT_ID"),
    redirectUri: env("OPENFEED_REDIRECT_URI"),
    issuer: env("OPENFEED_ISSUER"),
    apiBase: env("OPENFEED_API"),
    clientSigner: kmsSigner(env("CLIENT_SIGNING_KEY"), ksend),
    dpopSigner: kmsSigner(env("DPOP_SIGNING_KEY"), ksend),
    fetch: async (url, init) => {
      const r = await fetch(url, init);
      return { status: r.status, headers: r.headers, text: () => r.text() };
    },
    nowSeconds: () => Math.floor(Date.now() / 1000),
    newId: () => randomUUID(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  return {
    client,
    stores: STORES.map((n) => new S3Store(n, at(n), ssend)),
    sealer: kmsSealer(env("DATA_KEY"), ksend),
    state: new S3RevocationState(at("control"), ssend),
    pending: new S3PendingConnects(at("control"), ssend),
  };
}

type HttpEvent = { queryStringParameters?: Record<string, string | undefined> };
type HttpResult = { statusCode: number; headers?: Record<string, string>; body: string };
const page = (statusCode: number, body: string): HttpResult => ({
  statusCode,
  headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  body,
});

export async function poll(): Promise<void> {
  const w = wiring();
  const report = await pollRevocations(
    { api: w.client, stores: w.stores, sealer: w.sealer, state: w.state },
    new Date().toISOString(),
  );
  realdataLog("revocation_poll", { ...report, at_risk: report.detection_at_risk ? 1 : 0 });
}

export async function start(event: HttpEvent): Promise<HttpResult> {
  try {
    const consumerRef = consumerRefFromInvite(event.queryStringParameters?.invite ?? "");
    const w = wiring();
    const { authorizeUrl } = await startConnect(
      {
        client: w.client,
        pending: w.pending,
        stores: w.stores,
        sealer: w.sealer,
        random: randomBytes,
      },
      { consumerRef, at: new Date().toISOString() },
    );
    realdataLog("connect_started", { status: "complete" });
    return {
      statusCode: 302,
      headers: { location: authorizeUrl, "cache-control": "no-store" },
      body: "",
    };
  } catch {
    realdataLog("connect_started", { status: "failed" });
    return page(400, "This invite link can't be used. Ask for a new one.");
  }
}

export async function callback(event: HttpEvent): Promise<HttpResult> {
  const q = event.queryStringParameters ?? {};
  if (!q.code || !q.state)
    return page(400, "The connection didn't complete. Try the invite link again.");
  try {
    const w = wiring();
    const summary = await completeConnect(
      {
        client: w.client,
        pending: w.pending,
        stores: w.stores,
        sealer: w.sealer,
        random: randomBytes,
      },
      {
        code: q.code,
        state: q.state,
        at: new Date().toISOString(),
        purposeVersion: PURPOSE_VERSION,
      },
    );
    realdataLog("ingest_summary", { ...summary });
    return summary.status === "complete"
      ? page(200, "Your accounts are connected. You can close this page.")
      : page(200, "Sharing was stopped, so nothing was kept.");
  } catch {
    realdataLog("ingest_summary", { status: "failed" });
    return page(500, "The connection didn't complete, and nothing was kept. Try again later.");
  }
}
