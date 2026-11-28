// SIG-82: API Gateway HTTP API (payload v2) adapter for the demo stage. Nothing is logged but the
// method, the route's status and the time taken: never a path ID, a token, a body or a header.
import { DynamoStore, MemoryStore } from "./dynamo.js";
import { createSupabaseVerifier, type Verifier } from "../auth/supabase.js";
import { createDemoApp } from "./app.js";
import { readFileSync } from "node:fs";
import { wiredPort } from "./assessment-port.js";
import type { ScenarioInputs } from "./scenario-inputs.js";
import { demoConfigFrom } from "./config.js";
import { DemoStore } from "./store.js";

type HttpApiEvent = {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string }; domainName?: string };
};

// Refuses to start unless the Enrich path is local (T3).
const config = demoConfigFrom(process.env);
const table = process.env.DEMO_TABLE;
const store = new DemoStore(table ? new DynamoStore(table) : new MemoryStore());
const verify: Verifier =
  config.supabaseUrl && config.supabasePublishableKey
    ? createSupabaseVerifier({
        url: config.supabaseUrl,
        publishableKey: config.supabasePublishableKey,
      })
    : () => Promise.resolve(null);
// Candidate 1: the real composition, on the five SIG-76 inputs the build wrote (seeded order).
const inputs = JSON.parse(readFileSync("scenario-inputs.json", "utf8")) as ScenarioInputs;
const handle = createDemoApp({ config, store, verify, assessments: wiredPort(inputs) });

export const handler = async (event: HttpApiEvent) => {
  const started = Date.now();
  const res = await handle({
    method: event.requestContext.http.method,
    path: event.rawPath,
    query: event.rawQueryString ?? "",
    headers: event.headers ?? {},
    host: event.requestContext.domainName ?? event.headers?.host ?? "",
    ...(event.body
      ? {
          body: Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8").toString("utf8"),
        }
      : {}),
  }).catch(() => ({
    status: 500,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      error: { code: "internal", message: "Something went wrong on the demo stage" },
    }),
  }));
  console.log(
    JSON.stringify({
      method: event.requestContext.http.method,
      status: res.status,
      ms: Date.now() - started,
    }),
  );
  return { statusCode: res.status, headers: res.headers, body: res.body };
};
