import { existsSync, readFileSync } from "node:fs";
import { App } from "aws-cdk-lib";
import { demoSettings, SignalsDemoStack } from "./demo-stack.js";
import { SignalsMockStack } from "./mock-stack.js";

const app = new App();
const env = { account: "932027117528", region: "ap-southeast-2" };

new SignalsMockStack(app, "MorokuSignalsMock-dev", { env, assetPath: "dist/mock-lambda" });

// SIG-82 (D59): the hosted demo stage MorokuSignalsDemo, synthetic data only. Synthesised only
// when asked for (-c demo=true), after `node infra/build-demo-lambda.mjs` has built the asset and
// recorded its commit; docs/handover/demo-wave.md has the deploy steps. The secure environment's
// stack is never added to this file (handover note).
if (app.node.tryGetContext("demo") === "true") {
  // Review 23 (40821, G4): any Enrich path but local fails the build; nothing is overridden.
  const settings = demoSettings(
    {
      enrichPath: app.node.tryGetContext("enrichPath") as unknown,
      hs256Fallback: app.node.tryGetContext("hs256Fallback") as unknown,
    },
    process.env,
  );
  const asset = "dist/demo-lambda";
  if (!existsSync(`${asset}/build-info.json`))
    throw new Error("Build the demo asset first: node infra/build-demo-lambda.mjs");
  const build = JSON.parse(readFileSync(`${asset}/build-info.json`, "utf8")) as {
    commit: string;
    dirty?: boolean;
  };
  const ctx = (k: string) => {
    const v: unknown = app.node.tryGetContext(k);
    if (typeof v !== "string" || !v) throw new Error(`Pass -c ${k}=<value> to deploy the demo`);
    return v;
  };
  new SignalsDemoStack(app, "MorokuSignalsDemo", {
    env,
    assetPath: asset,
    build,
    supabaseUrl: ctx("supabaseUrl"),
    supabasePublishableKey: ctx("supabasePublishableKey"),
    demoMembers: ctx("demoMembers"),
    enrichPath: settings.enrichPath,
    hs256Fallback: settings.hs256Fallback,
  });
}
