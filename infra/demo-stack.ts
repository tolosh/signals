// SIG-82 (D59; sections 4 and 5): the hosted demo stage, MorokuSignalsDemo. Synthetic data only.
//   - one on-demand DynamoDB table, the demo's persistence stand-in (ADR 0014), the mock's layout;
//   - one Lambda running src/api/lambda.ts, with the Enrich path forced to local (T3) and the
//     pinned Enrich 1.8.0 build bundled into it (vendor/moroku-enrich/), so it never needs Enrich;
//   - one HTTP API.
// No real-data resource (T1): no KMS key, bucket or role from realdata-stack.ts. No Enrich table,
// parameter, secret or hostname (T2): the Lambda's only grants are its table and its logs, and any
// Enrich host in the configuration refuses to synthesise. The commit the build recorded is passed
// to the Lambda, and /health reads it back (T4). The Supabase URL and publishable key are public
// stack configuration (40779), not secrets. Colin deploys.
import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from "aws-cdk-lib";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import { parseMembers, refuseEnrichHost } from "../src/api/config.js";

/**
 * Review 23 (40821, G4; 40820, 2): the demo's settings from `cdk synth` context and the shell.
 *   - The Enrich path: an enrichPath context, or an ENRICH_PATH value, other than local fails the
 *     build. Nothing is overridden.
 *   - hs256Fallback: on (the default, until Lovable's ES256 switch is confirmed) or off.
 */
export function demoSettings(
  context: Readonly<Record<string, unknown>>,
  env: Readonly<Record<string, string | undefined>>,
): { enrichPath: "local"; hs256Fallback: boolean } {
  const fromContext = context.enrichPath;
  if (fromContext !== undefined && fromContext !== "local")
    throw new Error(
      "The demo stage's Enrich path is forced to local (D58): -c enrichPath must be local or absent",
    );
  if (env.ENRICH_PATH !== undefined && env.ENRICH_PATH !== "" && env.ENRICH_PATH !== "local")
    throw new Error(
      "The demo stage's Enrich path is forced to local (D58): ENRICH_PATH must be local or unset",
    );
  const fallback = context.hs256Fallback ?? "on";
  if (fallback !== "on" && fallback !== "off")
    throw new Error("-c hs256Fallback must be on or off (40820, 2)");
  return { enrichPath: "local", hs256Fallback: fallback === "on" };
}

export type DemoStackProps = StackProps & {
  assetPath: string;
  /** What infra/build-demo-lambda.mjs recorded in build-info.json. A dirty build refuses. */
  build: { commit: string; dirty?: boolean };
  supabaseUrl: string;
  supabasePublishableKey: string;
  /** "<email or user id>:A,<email or user id>:B" */
  demoMembers: string;
  /** Always local (D58). Anything else refuses to synthesise. */
  enrichPath: "local";
  /** HS256 tokens go to /auth/v1/user (40820, 2). True until Lovable's ES256 switch is confirmed. */
  hs256Fallback?: boolean;
};

export class SignalsDemoStack extends Stack {
  constructor(scope: Construct, id: string, props: DemoStackProps) {
    super(scope, id, props);
    if (props.enrichPath !== "local")
      throw new Error("The demo stage's Enrich path is forced to local (D58)");
    if (!/^[0-9a-f]{40}$/.test(props.build.commit))
      throw new Error("The demo build must record a full 40-character commit SHA");
    if (props.build.dirty !== false && props.build.dirty !== undefined)
      throw new Error(
        "The demo build was made from a dirty tree (--allow-dirty); rebuild from a clean commit to deploy",
      );
    refuseEnrichHost("supabaseUrl", props.supabaseUrl);
    refuseEnrichHost("supabasePublishableKey", props.supabasePublishableKey);
    refuseEnrichHost("demoMembers", props.demoMembers);
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(props.supabaseUrl))
      throw new Error("supabaseUrl must be the project's https://<ref>.supabase.co URL");
    parseMembers(props.demoMembers);

    const state = new Table(this, "DemoState", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expires_at",
      // Synthetic data only: the table goes with the stack.
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const fn = new LambdaFunction(this, "DemoApi", {
      runtime: Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: Code.fromAsset(props.assetPath),
      memorySize: 1024,
      timeout: Duration.seconds(29),
      environment: {
        STAGE: "demo",
        ENRICH_PATH: "local",
        DEMO_COMMIT: props.build.commit,
        DEMO_TABLE: state.tableName,
        SUPABASE_URL: props.supabaseUrl,
        SUPABASE_PUBLISHABLE_KEY: props.supabasePublishableKey,
        DEMO_MEMBERS: props.demoMembers,
        SUPABASE_HS256_FALLBACK: props.hs256Fallback === false ? "off" : "on",
      },
      logGroup: new LogGroup(this, "DemoLogs", {
        retention: RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    state.grantReadWriteData(fn);

    const api = new HttpApi(this, "DemoHttpApi", {
      apiName: "moroku-signals-demo",
      defaultIntegration: new HttpLambdaIntegration("DemoIntegration", fn),
    });

    Tags.of(this).add("project", "moroku-signals");
    Tags.of(this).add("stage", "demo");
    Tags.of(this).add("data", "synthetic");
    new CfnOutput(this, "DemoUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "DemoCommit", { value: props.build.commit });
  }
}
