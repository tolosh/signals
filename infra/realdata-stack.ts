// SIG-61 (ADR 0008): the secure environment for team members' real data. Synthesised and tested
// (test/infra/realdata-stack.test.ts); NOT deployed and not in infra/app.ts. Deploying needs
// Colin's go-ahead, the target account, and openfeed's production registration.
//
// - Sydney only.
// - Two customer-managed keys, rotated yearly and kept if the stack is deleted: the data key (bank
//   data, derived features, run inputs, grant links, sealed refresh tokens) and the truth key (the
//   truth-capture records), so access to declarations and to bank data is granted separately.
// - Two RSA_3072 signing keys for openfeed (client assertion and DPoP), so the private keys never
//   leave KMS.
// - One S3 bucket per store, and a control bucket: SSE-KMS with the store's key and bucket keys;
//   Block Public Access; TLS only; a write under any other key refused; no versioning, so a
//   deleted record is gone at once and the 24-hour purge holds. Nothing real goes in DynamoDB.
// - CloudTrail: management events (every KMS use) and data events on the store buckets, with
//   log-file validation, plus S3 server access logs, into a private, TLS-only, versioned bucket.
// - The poller every 5 minutes; the connect and callback functions behind an HTTP API.
// - Alarms on PurgeOverdue and DetectionAtRisk. DetectionAtRisk also fires when the poller's
//   metric goes missing, so a stopped poller isn't silent. Both go to an SNS topic Colin subscribes
//   to.
import { Duration, RemovalPolicy, Stack, Tags, type StackProps } from "aws-cdk-lib";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { CfnTrail, Trail } from "aws-cdk-lib/aws-cloudtrail";
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { AnyPrincipal, Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Key, KeySpec, KeyUsage } from "aws-cdk-lib/aws-kms";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { FilterPattern, LogGroup, MetricFilter, RetentionDays } from "aws-cdk-lib/aws-logs";
import { BlockPublicAccess, Bucket, BucketEncryption, type IBucket } from "aws-cdk-lib/aws-s3";
import { Schedule, ScheduleExpression } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import { Topic } from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";
import type { StoreName } from "../src/research/realdata/stores.js";

export type RealDataProps = StackProps & {
  assetPath: string;
  /** openfeed's production values; placeholders until the app is registered. */
  openfeed?: { clientId: string; issuer: string; api: string };
};

const NAMESPACE = "MorokuSignals/RealData";

/** Stub, tests first. */
export const REAL_DATA_ROLES: string[] = [];

export class SignalsRealDataStack extends Stack {
  constructor(scope: Construct, id: string, props: RealDataProps) {
    super(scope, id, props);
    if (props.env?.region !== "ap-southeast-2")
      throw new Error("The secure environment is in ap-southeast-2 (Sydney) only");

    const dataKey = new Key(this, "DataKey", {
      description: "Signals real data: the store buckets and sealed refresh tokens (SIG-61)",
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const truthKey = new Key(this, "TruthKey", {
      description: "Signals real data: the truth-capture bucket (SIG-61)",
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const signingKey = (name: string, description: string) =>
      new Key(this, name, {
        description,
        keySpec: KeySpec.RSA_3072,
        keyUsage: KeyUsage.SIGN_VERIFY,
        removalPolicy: RemovalPolicy.RETAIN,
      });
    const clientKey = signingKey("OpenfeedClientKey", "openfeed private_key_jwt client assertion");
    const dpopKey = signingKey("OpenfeedDpopKey", "openfeed DPoP proofs");

    // S3 server access logs can only be delivered to an SSE-S3 bucket, so the log bucket uses it.
    const logs = new Bucket(this, "AccessLogs", {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ expiration: Duration.days(400) }],
    });

    // One bucket per store, and the control bucket (the revocation queue, connections in progress).
    // No versioning: a deleted record is gone at once. Writes must name the bucket's key.
    const store = (id: string, key: Key, expireDays?: number) => {
      const b = new Bucket(this, id, {
        encryption: BucketEncryption.KMS,
        encryptionKey: key,
        bucketKeyEnabled: true,
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        serverAccessLogsBucket: logs as unknown as IBucket,
        serverAccessLogsPrefix: `${id}/`,
        removalPolicy: RemovalPolicy.RETAIN,
        ...(expireDays
          ? { lifecycleRules: [{ prefix: "connect/", expiration: Duration.days(expireDays) }] }
          : {}),
      });
      b.addToResourcePolicy(
        new PolicyStatement({
          effect: Effect.DENY,
          principals: [new AnyPrincipal()],
          actions: ["s3:PutObject"],
          resources: [b.arnForObjects("*")],
          conditions: {
            StringNotEquals: { "s3:x-amz-server-side-encryption-aws-kms-key-id": key.keyArn },
          },
        }),
      );
      return b;
    };
    const buckets: Record<StoreName | "control", Bucket> = {
      raw_grant_data: store("RawGrantData", dataKey),
      derived_features: store("DerivedFeatures", dataKey),
      truth_capture: store("TruthCapture", truthKey),
      run_inputs: store("RunInputs", dataKey),
      openfeed_grants: store("OpenfeedGrants", dataKey),
      control: store("Control", dataKey, 1),
    };
    const keyOf = (n: StoreName | "control") => (n === "truth_capture" ? truthKey : dataKey);

    const trail = new Trail(this, "Trail", {
      // Bucket satisfies IBucket; the cast only bridges exactOptionalPropertyTypes in CDK's types.
      bucket: logs as unknown as IBucket,
      enableFileValidation: true,
      isMultiRegionTrail: false,
      includeGlobalServiceEvents: false,
    });
    (trail.node.defaultChild as CfnTrail).addPropertyOverride("AdvancedEventSelectors", [
      {
        Name: "Management events, including every KMS use",
        FieldSelectors: [{ Field: "eventCategory", Equals: ["Management"] }],
      },
      {
        Name: "Data events on the secure store buckets",
        FieldSelectors: [
          { Field: "eventCategory", Equals: ["Data"] },
          { Field: "resources.type", Equals: ["AWS::S3::Object"] },
          {
            Field: "resources.ARN",
            StartsWith: Object.values(buckets).map((b) => `${b.bucketArn}/`),
          },
        ],
      },
    ]);

    const openfeed = props.openfeed ?? {
      clientId: "app-not-registered",
      issuer: "https://auth.openfeed.au",
      api: "https://api.openfeed.au",
    };
    const api = new HttpApi(this, "ConnectApi", { apiName: "moroku-signals-realdata-connect" });
    const fn = (name: string, handler: string) => {
      const logGroup = new LogGroup(this, `${name}Logs`, { retention: RetentionDays.ONE_MONTH });
      const f = new LambdaFunction(this, name, {
        runtime: Runtime.NODEJS_22_X,
        handler: `index.${handler}`,
        code: Code.fromAsset(props.assetPath),
        memorySize: 512,
        timeout: Duration.minutes(handler === "poll" ? 4 : 1),
        logGroup,
        environment: {
          ...Object.fromEntries(
            Object.entries(buckets).map(([n, b]) => [`BUCKET_${n.toUpperCase()}`, b.bucketName]),
          ),
          DATA_KEY: dataKey.keyArn,
          TRUTH_KEY: truthKey.keyArn,
          CLIENT_SIGNING_KEY: clientKey.keyArn,
          DPOP_SIGNING_KEY: dpopKey.keyArn,
          OPENFEED_CLIENT_ID: openfeed.clientId,
          OPENFEED_ISSUER: openfeed.issuer,
          OPENFEED_API: openfeed.api,
          OPENFEED_REDIRECT_URI: `${api.apiEndpoint}/v1/openfeed/callback`,
        },
      });
      for (const [n, b] of Object.entries(buckets) as [StoreName | "control", Bucket][]) {
        b.grantReadWrite(f);
        b.grantDelete(f);
        keyOf(n).grantEncryptDecrypt(f);
      }
      for (const k of [clientKey, dpopKey]) k.grant(f, "kms:Sign", "kms:GetPublicKey");
      return { f, logGroup };
    };

    const poller = fn("RevocationPoller", "poll");
    const start = fn("ConnectStart", "start");
    const callback = fn("ConnectCallback", "callback");
    api.addRoutes({
      path: "/connect/start",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("StartIntegration", start.f),
    });
    api.addRoutes({
      path: "/v1/openfeed/callback",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("CallbackIntegration", callback.f),
    });

    new Schedule(this, "PollEvery5Minutes", {
      schedule: ScheduleExpression.rate(Duration.minutes(5)),
      target: new LambdaInvoke(poller.f, {}),
    });

    const alerts = new Topic(this, "RealDataAlerts");
    const alarm = (metricName: string, field: string, missing: TreatMissingData) => {
      new MetricFilter(this, `${metricName}Filter`, {
        logGroup: poller.logGroup,
        filterPattern: FilterPattern.stringValue("$.event", "=", "revocation_poll"),
        metricNamespace: NAMESPACE,
        metricName,
        metricValue: `$.${field}`,
      });
      new Alarm(this, `${metricName}Alarm`, {
        metric: new Metric({
          namespace: NAMESPACE,
          metricName,
          statistic: "Maximum",
          period: Duration.minutes(15),
        }),
        threshold: 0,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: missing,
      }).addAlarmAction(new SnsAction(alerts));
    };
    alarm("PurgeOverdue", "overdue", TreatMissingData.NOT_BREACHING);
    alarm("DetectionAtRisk", "at_risk", TreatMissingData.BREACHING);

    Tags.of(this).add("project", "moroku-signals");
    Tags.of(this).add("stage", "realdata");
    Tags.of(this).add("data", "real-consented");
  }
}
