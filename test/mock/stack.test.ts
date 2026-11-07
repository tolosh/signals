// SIG-11 hosting: offline checks on the stack and the Lambda bundle. Nothing touches AWS.
// SIG-51: synthesising the stack takes about 6 to 7 seconds on a slow machine, so these tests have
// an explicit 30-second timeout (T2). The one-container cap (T1) was measured to throttle
// concurrent requests with 503s and is withdrawn. Ruled 7 November 2026 (ADR 0005): the mock stays
// on Lambda with no cap, and keeps its state in one on-demand DynamoDB table in the mock stack.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";

const SLOW = 30_000;
import { SignalsMockStack } from "../../infra/mock-stack.js";

describe("hosted mock", () => {
  beforeAll(() => {
    execFileSync(process.execPath, ["scripts/build-mock-lambda.mjs"]);
  }, 60000);

  const template = () =>
    Template.fromStack(
      new SignalsMockStack(new App(), "Test", {
        env: { account: "932027117528", region: "ap-southeast-2" },
        assetPath: "dist/mock-lambda",
      }),
    );

  it(
    "is one Node 22 Lambda behind one HTTP API, with one table and no other store",
    () => {
      const t = template();
      t.hasResourceProperties("AWS::Lambda::Function", { Runtime: "nodejs22.x" });
      t.resourceCountIs("AWS::Lambda::Function", 1);
      t.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
      t.resourceCountIs("AWS::DynamoDB::Table", 1);
      t.resourceCountIs("AWS::RDS::DBCluster", 0);
      t.resourceCountIs("AWS::S3::Bucket", 0);
    },
    SLOW,
  );

  it(
    "the table is on demand, keyed by scenario and resource, with a TTL, and only the mock uses it",
    () => {
      const t = template();
      t.hasResourceProperties("AWS::DynamoDB::Table", {
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
        TimeToLiveSpecification: { AttributeName: "expires_at", Enabled: true },
      });
      const fn = Object.values(t.findResources("AWS::Lambda::Function"))[0] as {
        Properties: { Environment: { Variables: Record<string, unknown> } };
      };
      expect(Object.keys(fn.Properties.Environment.Variables)).toContain("MOCK_TABLE");
      const policies = JSON.stringify(t.findResources("AWS::IAM::Policy"));
      expect(policies).toMatch(/dynamodb:Query/);
      expect(policies).toMatch(/dynamodb:BatchWriteItem/);
    },
    SLOW,
  );

  it("the table is in the mock stack only: no other infra file declares one", () => {
    const tables = readdirSync("infra")
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /aws-dynamodb/.test(readFileSync(`infra/${f}`, "utf8")));
    expect(tables).toEqual(["mock-stack.ts"]);
  });

  it("the one-container cap stays withdrawn: no stack reserves concurrency", () => {
    const capped = readdirSync("infra")
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /reservedConcurrentExecutions/.test(readFileSync(`infra/${f}`, "utf8")));
    expect(capped).toEqual([]);
  });

  it(
    "the bundle serves AF-T1 and a contract-shaped error from its own folder",
    () => {
      const script = `
      process.chdir(${JSON.stringify(resolve("dist/mock-lambda"))});
      const { handler } = await import("file://" + process.cwd().replaceAll("\\\\", "/") + "/index.mjs");
      const call = (p) => handler({ rawPath: p, headers: {}, requestContext: { http: { method: "GET" } } });
      console.log(JSON.stringify([await call("/v1/app/assessments/asm_01"), await call("/v1/app/assessments/nope")]));`;
      const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        encoding: "utf8",
      });
      const [found, missing] = JSON.parse(output) as { statusCode: number; body: string }[];
      expect(found?.statusCode).toBe(200);
      expect((JSON.parse(found?.body ?? "{}") as { id: string }).id).toBe("asm_01");
      expect(missing?.statusCode).toBe(404);
    },
    SLOW,
  );
});
