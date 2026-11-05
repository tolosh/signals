// SIG-11: hosts the mock for Lovable. Synthetic fixtures only, so the API is public by design.
import { CfnOutput, Duration, Stack, Tags, type StackProps } from "aws-cdk-lib";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

export class SignalsMockStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { assetPath: string }) {
    super(scope, id, props);

    const fn = new LambdaFunction(this, "Mock", {
      runtime: Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: Code.fromAsset(props.assetPath),
      memorySize: 256,
      timeout: Duration.seconds(5),
      logGroup: new LogGroup(this, "MockLogs", { retention: RetentionDays.ONE_WEEK }),
    });

    const api = new HttpApi(this, "MockApi", {
      apiName: "moroku-signals-mock-dev",
      defaultIntegration: new HttpLambdaIntegration("MockIntegration", fn),
    });

    Tags.of(this).add("project", "moroku-signals");
    Tags.of(this).add("stage", "dev");
    new CfnOutput(this, "MockUrl", { value: api.apiEndpoint });
  }
}
