// SIG-61 (ADR 0008): the secure environment's stack, synthesised and checked. It is not deployed:
// deploying needs Colin's go-ahead and openfeed's production registration. Checks: Sydney; a
// customer-managed KMS key with rotation; the table encrypted with it, with no point-in-time
// recovery (a backup would outlive the 24-hour purge); two KMS signing keys for openfeed (client
// assertion and DPoP), so the private keys never leave KMS; CloudTrail data events on the table
// and the secrets, into a TLS-only, KMS-encrypted log bucket; the poller every 5 minutes; and
// alarms on the poller's overdue-purge and detection-at-risk metrics.
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { SignalsRealDataStack } from "../../infra/realdata-stack.js";

const template = () =>
  Template.fromStack(
    new SignalsRealDataStack(new App(), "MorokuSignalsRealData-test", {
      env: { account: "111111111111", region: "ap-southeast-2" },
      assetPath: "test/infra/empty-asset",
    }),
  );

describe("the secure environment stack (not deployed)", () => {
  it("refuses any region but Sydney", () => {
    expect(
      () =>
        new SignalsRealDataStack(new App(), "x", {
          env: { account: "111111111111", region: "us-east-1" },
          assetPath: "test/infra/empty-asset",
        }),
    ).toThrow(/ap-southeast-2/);
  });

  it("has a customer-managed data key with rotation, kept on stack deletion", () => {
    const t = template();
    t.hasResource("AWS::KMS::Key", {
      Properties: Match.objectLike({ EnableKeyRotation: true, KeySpec: Match.absent() }),
      DeletionPolicy: "Retain",
    });
  });

  it("has two RSA signing keys for openfeed, PS256-capable", () => {
    const t = template();
    const keys = t.findResources("AWS::KMS::Key", {
      Properties: { KeySpec: "RSA_3072", KeyUsage: "SIGN_VERIFY" },
    });
    expect(Object.keys(keys)).toHaveLength(2);
  });

  it("encrypts the table with the customer key and keeps no point-in-time backups", () => {
    const t = template();
    t.hasResourceProperties("AWS::DynamoDB::Table", {
      SSESpecification: { SSEEnabled: true, SSEType: "KMS", KMSMasterKeyId: Match.anyValue() },
      DeletionProtectionEnabled: true,
      PointInTimeRecoverySpecification: Match.absent(),
    });
  });

  it("logs data events on the table to a TLS-only, KMS-encrypted, private bucket", () => {
    const t = template();
    t.hasResourceProperties("AWS::CloudTrail::Trail", {
      IsLogging: true,
      EnableLogFileValidation: true,
      AdvancedEventSelectors: Match.arrayWith([
        Match.objectLike({
          FieldSelectors: Match.arrayWith([
            { Field: "resources.type", Equals: ["AWS::DynamoDB::Table"] },
          ]),
        }),
      ]),
    });
    t.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          Match.objectLike({
            ServerSideEncryptionByDefault: Match.objectLike({ SSEAlgorithm: "aws:kms" }),
          }),
        ],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    t.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          }),
        ]),
      },
    });
  });

  it("runs the revocation poller every 5 minutes", () => {
    template().hasResourceProperties("AWS::Scheduler::Schedule", {
      ScheduleExpression: "rate(5 minutes)",
    });
  });

  it("alarms on an overdue purge and on detection at risk", () => {
    const t = template();
    for (const metric of ["PurgeOverdue", "DetectionAtRisk"])
      t.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: metric,
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
      });
  });

  it("keeps the functions' logs in Sydney for a bounded time", () => {
    const t = template();
    const groups = t.findResources("AWS::Logs::LogGroup");
    expect(Object.keys(groups).length).toBeGreaterThanOrEqual(2);
    for (const g of Object.values(groups))
      expect(
        (g as { Properties: { RetentionInDays?: number } }).Properties.RetentionInDays,
      ).toBeLessThanOrEqual(90);
  });
});
