// SIG-61 (ADR 0008): the secure environment's stack, synthesised and checked. It is not deployed:
// deploying needs Colin's go-ahead and openfeed's production registration. Checks: Sydney; the
// data key and the truth key, customer-managed and rotated; two KMS signing keys for openfeed
// (client assertion and DPoP), so the private keys never leave KMS; one S3 bucket per store plus
// the control bucket, SSE-KMS with the store's key, private, TLS-only, refusing writes under any
// other key, and keeping no versions (a version would outlive the 24-hour purge); no DynamoDB
// (ADR 0008; ADR 0005 keeps it for the mock); CloudTrail data events on the store buckets into a
// private log bucket; the poller every 5 minutes; alarms on the poller's metrics.
// (Corrected before push: the first version used one DynamoDB table.)
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { SignalsRealDataStack } from "../../infra/realdata-stack.js";

let synthesised: Template | null = null;
const template = () =>
  (synthesised ??= Template.fromStack(
    new SignalsRealDataStack(new App(), "MorokuSignalsRealData-test", {
      env: { account: "111111111111", region: "ap-southeast-2" },
      assetPath: "test/infra/empty-asset",
    }),
  ));
/** The five stores and the control bucket. */
const STORE_BUCKETS = 6;
type Statement = { Effect?: string; Action?: unknown; Condition?: unknown };

describe("the secure environment stack (not deployed)", () => {
  // The first synthesis bundles nothing but still takes about 15 seconds.
  beforeAll(() => void template(), 120_000);

  it("refuses any region but Sydney", () => {
    expect(
      () =>
        new SignalsRealDataStack(new App(), "x", {
          env: { account: "111111111111", region: "us-east-1" },
          assetPath: "test/infra/empty-asset",
        }),
    ).toThrow(/ap-southeast-2/);
  });

  it("has a data key and a truth key, customer-managed, rotated, kept on stack deletion", () => {
    const keys = template().findResources("AWS::KMS::Key", {
      Properties: Match.objectLike({ EnableKeyRotation: true, KeySpec: Match.absent() }),
      DeletionPolicy: "Retain",
    });
    expect(Object.keys(keys)).toHaveLength(2);
  });

  it("has two RSA signing keys for openfeed, PS256-capable", () => {
    const keys = template().findResources("AWS::KMS::Key", {
      Properties: { KeySpec: "RSA_3072", KeyUsage: "SIGN_VERIFY" },
    });
    expect(Object.keys(keys)).toHaveLength(2);
  });

  it("puts nothing in DynamoDB", () => {
    template().resourceCountIs("AWS::DynamoDB::Table", 0);
  });

  it("has one private bucket per store, SSE-KMS with a customer key, keeping no versions", () => {
    const buckets = template().findResources("AWS::S3::Bucket", {
      Properties: Match.objectLike({
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              BucketKeyEnabled: true,
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: "aws:kms",
                KMSMasterKeyID: Match.anyValue(),
              },
            },
          ],
        },
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      }),
    });
    expect(Object.keys(buckets)).toHaveLength(STORE_BUCKETS);
    for (const b of Object.values(buckets))
      expect(
        (b as { Properties: Record<string, unknown> }).Properties.VersioningConfiguration,
      ).toBeUndefined();
  });

  it("refuses non-TLS requests everywhere, and writes under any other key on store buckets", () => {
    const statements = Object.values(template().findResources("AWS::S3::BucketPolicy")).map(
      (p) =>
        (p as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties
          .PolicyDocument.Statement,
    );
    const tls = statements.filter((st) =>
      st.some(
        (x) =>
          x.Effect === "Deny" &&
          JSON.stringify(x.Condition) ===
            JSON.stringify({ Bool: { "aws:SecureTransport": "false" } }),
      ),
    );
    expect(tls.length).toBeGreaterThanOrEqual(STORE_BUCKETS + 1);
    const wrongKey = statements.filter((st) =>
      st.some(
        (x) =>
          x.Effect === "Deny" &&
          x.Action === "s3:PutObject" &&
          JSON.stringify(x.Condition).includes("s3:x-amz-server-side-encryption-aws-kms-key-id"),
      ),
    );
    expect(wrongKey).toHaveLength(STORE_BUCKETS);
  });

  it("logs every KMS use and data events on the store buckets, with file validation", () => {
    template().hasResourceProperties("AWS::CloudTrail::Trail", {
      IsLogging: true,
      EnableLogFileValidation: true,
      AdvancedEventSelectors: Match.arrayWith([
        Match.objectLike({ FieldSelectors: [{ Field: "eventCategory", Equals: ["Management"] }] }),
        Match.objectLike({
          FieldSelectors: Match.arrayWith([
            { Field: "resources.type", Equals: ["AWS::S3::Object"] },
          ]),
        }),
      ]),
    });
  });

  it("runs the revocation poller every 5 minutes", () => {
    template().hasResourceProperties("AWS::Scheduler::Schedule", {
      ScheduleExpression: "rate(5 minutes)",
    });
  });

  it("alarms on an overdue purge and on detection at risk", () => {
    for (const metric of ["PurgeOverdue", "DetectionAtRisk"])
      template().hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: metric,
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
      });
  });

  it("keeps the functions' logs for a bounded time", () => {
    const groups = template().findResources("AWS::Logs::LogGroup");
    expect(Object.keys(groups).length).toBeGreaterThanOrEqual(3);
    for (const g of Object.values(groups))
      expect(
        (g as { Properties: { RetentionInDays?: number } }).Properties.RetentionInDays,
      ).toBeLessThanOrEqual(90);
  });
});
