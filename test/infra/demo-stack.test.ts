// SIG-82 section 6, T1 to T4 on the synthesised demo stack (D59; mandate 40777's gates):
//   T1 no real-data resource (realdata-stack.ts's keys, buckets or roles);
//   T2 no Enrich table, SSM path or hostname;
//   T3 the Enrich path fixed to local, and ApiEnrich can't be constructed in this stage;
//   T4 (synth half) the Lambda carries the commit the build recorded.
// infra/app.ts keeps the real-data stack out (handover note).
import { readFileSync } from "node:fs";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { SignalsDemoStack } from "../../infra/demo-stack.js";
import { REAL_DATA_ROLES } from "../../infra/realdata-stack.js";
import { apiEnrichInDemo, demoConfigFrom } from "../../src/api/config.js";

/** Enrich's hostnames (SIG-82 T2). */
const ENRICH_HOSTS = ["enrich.moroku.digital", "enrich-dev.moroku.digital"];

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const synth = (over: Partial<ConstructorParameters<typeof SignalsDemoStack>[2]> = {}) =>
  Template.fromStack(
    new SignalsDemoStack(new App(), "MorokuSignalsDemo-test", {
      env: { account: "111111111111", region: "ap-southeast-2" },
      assetPath: "test/infra/empty-asset",
      build: { commit: COMMIT },
      supabaseUrl: "https://abcdefgh.supabase.co",
      supabasePublishableKey: "sb_publishable_test",
      demoMembers: "a@demo.test:A,b@demo.test:B",
      enrichPath: "local",
      ...over,
    }),
  );
const template = synth();
const json = JSON.stringify(template.toJSON());
const lambdaEnv = () => {
  const fns = template.findResources("AWS::Lambda::Function");
  const env = Object.values(fns).map(
    (f) =>
      (f as { Properties: { Environment?: { Variables?: Record<string, unknown> } } }).Properties
        .Environment?.Variables ?? {},
  );
  return env.find((v) => "DEMO_TABLE" in v) ?? {};
};

describe("T1: no real-data resource in the demo template", () => {
  it("has no KMS key, no S3 bucket and none of the real-data roles", () => {
    expect(Object.keys(template.findResources("AWS::KMS::Key"))).toHaveLength(0);
    expect(Object.keys(template.findResources("AWS::KMS::Alias"))).toHaveLength(0);
    expect(Object.keys(template.findResources("AWS::S3::Bucket"))).toHaveLength(0);
    for (const role of REAL_DATA_ROLES) expect(json).not.toContain(role);
    expect(json.toLowerCase()).not.toContain("realdata");
    expect(json.toLowerCase()).not.toContain("real-data");
  });

  it("holds its state in one DynamoDB table, a Lambda and an HTTP API only", () => {
    template.resourceCountIs("AWS::DynamoDB::Table", 1);
    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    expect(Object.keys(template.findResources("AWS::RDS::DBCluster"))).toHaveLength(0);
    expect(Object.keys(template.findResources("AWS::SecretsManager::Secret"))).toHaveLength(0);
  });

  it("infra/app.ts never names the real-data stack", () => {
    const app = readFileSync("infra/app.ts", "utf8");
    expect(app).not.toMatch(/realdata|RealData/);
    expect(app).toContain("MorokuSignalsDemo");
  });
});

describe("T2: no Enrich table, parameter or hostname", () => {
  it("names no Enrich host, table, SSM path or secret", () => {
    for (const host of ENRICH_HOSTS) expect(json).not.toContain(host);
    expect(json).not.toMatch(/enrich[-_.a-z]*\.moroku\.digital/i);
    expect(json).not.toMatch(/arn:aws:dynamodb:[^"]*:table\/[^"]*enrich/i);
    expect(json).not.toMatch(/parameter\/[^"]*enrich/i);
    expect(json).not.toMatch(/secret:[^"]*enrich/i);
    expect(Object.keys(template.findResources("AWS::SSM::Parameter"))).toHaveLength(0);
  });

  it("grants the Lambda nothing beyond its own table and logs", () => {
    const policies = template.findResources("AWS::IAM::Policy");
    const statements = Object.values(policies).flatMap(
      (p) =>
        (p as { Properties: { PolicyDocument: { Statement: { Action: unknown }[] } } }).Properties
          .PolicyDocument.Statement,
    );
    const actions = statements.flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]));
    for (const a of actions) expect(String(a)).toMatch(/^(dynamodb|logs):/);
  });

  it("refuses an Enrich hostname anywhere in its configuration", () => {
    expect(() => synth({ supabaseUrl: "https://enrich-dev.moroku.digital" })).toThrow(/Enrich/);
  });
});

describe("T3: the Enrich path is fixed to local", () => {
  it("sets ENRICH_PATH=local on the Lambda", () => {
    expect(lambdaEnv().ENRICH_PATH).toBe("local");
  });

  it("refuses to synthesise any other path", () => {
    expect(() => synth({ enrichPath: "api" as "local" })).toThrow(/local/);
  });

  it("the runtime configuration refuses any other path, or none", () => {
    expect(() => demoConfigFrom({ ENRICH_PATH: "api", DEMO_COMMIT: COMMIT })).toThrow(/local/);
    expect(() => demoConfigFrom({ DEMO_COMMIT: COMMIT })).toThrow(/local/);
    expect(demoConfigFrom({ ENRICH_PATH: "local", DEMO_COMMIT: COMMIT }).enrichPath).toBe("local");
  });

  it("an attempt to construct ApiEnrich in this stage fails", () => {
    expect(() => apiEnrichInDemo()).toThrow(/forced to local/);
  });
});

describe("T4 (synth): the deployed commit can be read back", () => {
  it("passes the build's commit to the Lambda", () => {
    expect(lambdaEnv().DEMO_COMMIT).toBe(COMMIT);
    expect(lambdaEnv().STAGE).toBe("demo");
  });

  it("refuses a missing or malformed commit", () => {
    expect(() => synth({ build: { commit: "" } })).toThrow(/commit/);
    expect(() => synth({ build: { commit: "HEAD" } })).toThrow(/commit/);
  });

  it("puts the Supabase project's public values in stack configuration, not secrets", () => {
    expect(lambdaEnv().SUPABASE_URL).toBe("https://abcdefgh.supabase.co");
    expect(lambdaEnv().SUPABASE_PUBLISHABLE_KEY).toBe("sb_publishable_test");
  });
});

describe("T2 (bundle): the Lambda's code names no Enrich host and no mock fixture", () => {
  it("bundles src/api/lambda.ts without an Enrich hostname or the mock's fixtures", async () => {
    const { build } = await import("esbuild");
    const out = await build({
      entryPoints: ["src/api/lambda.ts"],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      write: false,
    });
    const code = out.outputFiles[0]?.text ?? "";
    expect(code.length).toBeGreaterThan(0);
    expect(code).not.toMatch(/enrich[-_.a-z0-9]*\.moroku\.digital/i);
    expect(code).not.toContain("af-t1-assessment.json");
    expect(code).not.toContain("Harbour Mutual");
  }, 60_000);
});
