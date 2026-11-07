// SIG-11: hosts the mock for Lovable. Synthetic fixtures only, so the API is public by design.
// SIG-51 (ADR 0005, ruled 7 November 2026): no concurrency cap; the mock's state is in one
// on-demand DynamoDB table, keyed by scenario (pk) and resource type and ID (sk), with written items
// expiring after 7 days. Mock only: real persistence is Aurora with RLS (WP2).
import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from "aws-cdk-lib";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

export class SignalsMockStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { assetPath: string }) {
    super(scope, id, props);

    const state = new Table(this, "MockState", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expires_at",
      // Synthetic fixtures only: the table goes with the stack.
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const fn = new LambdaFunction(this, "Mock", {
      runtime: Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: Code.fromAsset(props.assetPath),
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: { MOCK_TABLE: state.tableName },
      logGroup: new LogGroup(this, "MockLogs", { retention: RetentionDays.ONE_WEEK }),
    });

    state.grantReadWriteData(fn);

    const api = new HttpApi(this, "MockApi", {
      apiName: "moroku-signals-mock-dev",
      defaultIntegration: new HttpLambdaIntegration("MockIntegration", fn),
    });

    Tags.of(this).add("project", "moroku-signals");
    Tags.of(this).add("stage", "dev");
    new CfnOutput(this, "MockUrl", { value: api.apiEndpoint });
  }
}
