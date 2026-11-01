// SIG-11 hosting: offline checks on the stack and the Lambda bundle. Nothing touches AWS.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
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

  it("is one Node 22 Lambda behind one HTTP API, and nothing stateful", () => {
    const t = template();
    t.hasResourceProperties("AWS::Lambda::Function", { Runtime: "nodejs22.x" });
    t.resourceCountIs("AWS::Lambda::Function", 1);
    t.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    t.resourceCountIs("AWS::DynamoDB::Table", 0);
    t.resourceCountIs("AWS::RDS::DBCluster", 0);
    t.resourceCountIs("AWS::S3::Bucket", 0);
  });

  it("the bundle serves AF-T1 and a contract-shaped error from its own folder", () => {
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
  });
});
