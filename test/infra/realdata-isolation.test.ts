// SIG-61 ruling N-4 (Colin, 9 November 2026, comment 40198): the secure environment deploys into
// the existing Signals account, so separation is by IAM, KMS and resource policy (ADR 0008 as
// amended). Checked on the synthesised template:
// - the real-data roles are exactly three named roles, one per function, each under a permissions
//   boundary that allows only the real-data buckets, keys and log groups;
// - every store bucket denies its data to every principal except those roles, and denies non-TLS
//   access to everyone, the roles included;
// - every real-data key denies its use to every principal except those roles; the account keeps
//   key administration, not use;
// - the mock, dev and CI roles can't reach any of it (an evaluator over the policies, below), and
//   the mock stack names none of it.
// The evaluator covers the policy shapes this stack uses and throws on any other, so a change of
// shape fails here rather than passing unexamined.
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { SignalsMockStack } from "../../infra/mock-stack.js";
import { REAL_DATA_ROLES, SignalsRealDataStack } from "../../infra/realdata-stack.js";

const ACCOUNT = "111111111111";
const ROLE = (n: string) => `arn:aws:iam::${ACCOUNT}:role/${n}`;
const REAL = REAL_DATA_ROLES.map(ROLE);
/** Principals in the same account that must never reach real data. */
const OUTSIDERS = [
  ROLE("MorokuSignalsMock-dev-MockFunctionServiceRoleABC123-XYZ"), // the hosted mock's Lambda
  ROLE("aws-reserved/sso.amazonaws.com/ap-southeast-2/AWSReservedSSO_AdministratorAccess_abc"), // dev
  ROLE("cdk-hnb659fds-deploy-role-111111111111-ap-southeast-2"), // CDK deploy
  ROLE("cdk-hnb659fds-cfn-exec-role-111111111111-ap-southeast-2"), // CloudFormation
  ROLE("github-actions-signals-ci"), // a CI role
  ROLE("moroku-signals-realdata-poll-copy"), // a look-alike name
  `arn:aws:iam::${ACCOUNT}:user/developer`,
  `arn:aws:iam::${ACCOUNT}:root`,
];

let synthesised: Template | null = null;
const template = () =>
  (synthesised ??= Template.fromStack(
    new SignalsRealDataStack(new App(), "MorokuSignalsRealData-iso", {
      env: { account: ACCOUNT, region: "ap-southeast-2" },
      assetPath: "test/infra/empty-asset",
    }),
  ));

type Json = Record<string, unknown>;
type Statement = {
  Effect: "Allow" | "Deny";
  Action: string | string[];
  Principal?: unknown;
  Resource?: unknown;
  Condition?: Record<string, Record<string, string | string[]>>;
};
type Request = { principal: string; action: string; secure: boolean; kmsKeyMatches?: boolean };

const list = (x: string | string[]) => (Array.isArray(x) ? x : [x]);
const glob = (pattern: string, s: string) =>
  new RegExp(
    `^${pattern
      .split("*")
      .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  ).test(s);
const actionMatches = (st: Statement, action: string) =>
  list(st.Action).some((a) => glob(a, action));

/** Whether every condition of a statement holds for the request. */
function conditionsHold(st: Statement, r: Request): boolean {
  for (const [op, kv] of Object.entries(st.Condition ?? {}))
    for (const [key, raw] of Object.entries(kv)) {
      const values = list(raw);
      if (key === "aws:PrincipalArn" && (op === "ArnNotLike" || op === "ArnNotEquals")) {
        if (values.some((v) => glob(v, r.principal))) return false;
      } else if (key === "aws:PrincipalArn" && (op === "ArnLike" || op === "ArnEquals")) {
        if (!values.some((v) => glob(v, r.principal))) return false;
      } else if (key === "aws:SecureTransport" && op === "Bool") {
        // { Bool: { aws:SecureTransport: "false" } } holds for a request without TLS.
        if (String(r.secure) !== String(values[0])) return false;
      } else if (
        key === "s3:x-amz-server-side-encryption-aws-kms-key-id" &&
        op === "StringNotEquals"
      ) {
        if (r.kmsKeyMatches !== false) return false;
      } else throw new Error(`the evaluator doesn't know ${op} on ${key}`);
    }
  return true;
}
const denied = (statements: Statement[], r: Request) =>
  statements.some(
    (st) => st.Effect === "Deny" && actionMatches(st, r.action) && conditionsHold(st, r),
  );

const bucketPolicies = () =>
  Object.values(template().findResources("AWS::S3::BucketPolicy")).map((p) => ({
    bucket: JSON.stringify((p as Json & { Properties: Json }).Properties.Bucket),
    statements: (p as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties
      .PolicyDocument.Statement as Statement[],
  }));
const storeBucketIds = () =>
  Object.entries(template().findResources("AWS::S3::Bucket"))
    .filter(([, b]) => JSON.stringify(b).includes("aws:kms"))
    .map(([id]) => id);
const storePolicies = () =>
  bucketPolicies().filter((p) => storeBucketIds().some((id) => p.bucket.includes(`"${id}"`)));
const keyPolicies = () =>
  Object.entries(template().findResources("AWS::KMS::Key")).map(([id, k]) => ({
    id,
    statements: (k as { Properties: { KeyPolicy: { Statement: Statement[] } } }).Properties
      .KeyPolicy.Statement,
  }));

const S3_DATA = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"];
const KMS_USE = [
  "kms:Decrypt",
  "kms:Encrypt",
  "kms:GenerateDataKey",
  "kms:ReEncryptFrom",
  "kms:Sign",
];

describe("N-4: the real-data roles", () => {
  beforeAll(() => void template(), 120_000);

  it("are exactly three named roles, one per function", () => {
    expect(REAL_DATA_ROLES).toEqual([
      "moroku-signals-realdata-poll",
      "moroku-signals-realdata-start",
      "moroku-signals-realdata-callback",
    ]);
    const roles = Object.values(template().findResources("AWS::IAM::Role")).map(
      (r) => (r as { Properties: { RoleName?: string } }).Properties.RoleName,
    );
    expect(roles.sort()).toEqual([...REAL_DATA_ROLES].sort());
  });

  it("each sits under the real-data permissions boundary", () => {
    const boundaries = template().findResources("AWS::IAM::ManagedPolicy");
    const ids = Object.entries(boundaries)
      .filter(([, p]) => JSON.stringify(p).includes("moroku-signals-realdata-boundary"))
      .map(([id]) => id);
    expect(ids).toHaveLength(1);
    for (const r of Object.values(template().findResources("AWS::IAM::Role")))
      expect(JSON.stringify((r as { Properties: Json }).Properties.PermissionsBoundary)).toContain(
        ids[0],
      );
  });

  it("the boundary allows only the real-data buckets, keys and log groups, and no IAM or STS", () => {
    const [boundary] = Object.values(template().findResources("AWS::IAM::ManagedPolicy")) as {
      Properties: { PolicyDocument: { Statement: Statement[] } };
    }[];
    const statements = boundary!.Properties.PolicyDocument.Statement;
    for (const st of statements) {
      expect(st.Effect).toBe("Allow");
      for (const a of list(st.Action)) expect(a).toMatch(/^(s3|kms|logs):/);
      expect(JSON.stringify(st.Resource)).not.toBe('"*"');
      for (const res of list(st.Resource as string | string[])) expect(res).not.toBe("*");
    }
    const text = JSON.stringify(statements);
    for (const id of storeBucketIds()) expect(text).toContain(id);
    for (const { id } of keyPolicies()) expect(text).toContain(id);
    expect(text).toContain("log-group:/moroku-signals/realdata/");
  });
});

describe("N-4: every store bucket denies all but the real-data roles, and non-TLS to everyone", () => {
  beforeAll(() => void template(), 120_000);

  it("covers the six store and control buckets", () => {
    expect(storePolicies()).toHaveLength(6);
  });

  it("names exactly the three real-data roles as the exception", () => {
    for (const p of storePolicies()) {
      const exceptions = p.statements
        .filter((s) => s.Effect === "Deny" && s.Condition?.ArnNotLike)
        .map((s) => list(s.Condition!.ArnNotLike!["aws:PrincipalArn"]!));
      expect(exceptions).toHaveLength(1);
      expect([...exceptions[0]!].sort()).toEqual([...REAL].sort());
    }
  });

  it.each(OUTSIDERS)("denies %s every data action on every store bucket", (principal) => {
    for (const p of storePolicies())
      for (const action of S3_DATA)
        expect(denied(p.statements, { principal, action, secure: true }), action).toBe(true);
  });

  it("lets the real-data roles through over TLS, writing under the store's key", () => {
    for (const p of storePolicies())
      for (const principal of REAL)
        for (const action of S3_DATA)
          expect(
            denied(p.statements, { principal, action, secure: true, kmsKeyMatches: true }),
            `${principal} ${action}`,
          ).toBe(false);
  });

  it("denies non-TLS access to the real-data roles too", () => {
    for (const p of storePolicies())
      for (const principal of REAL)
        expect(denied(p.statements, { principal, action: "s3:GetObject", secure: false })).toBe(
          true,
        );
  });
});

describe("N-4: every real-data key denies its use to all but the real-data roles", () => {
  beforeAll(() => void template(), 120_000);

  it("covers the data, truth and two signing keys", () => {
    expect(keyPolicies()).toHaveLength(4);
  });

  it.each(OUTSIDERS)("denies %s every use of every key", (principal) => {
    for (const k of keyPolicies())
      for (const action of KMS_USE)
        expect(denied(k.statements, { principal, action, secure: true }), `${k.id} ${action}`).toBe(
          true,
        );
  });

  it("doesn't deny the real-data roles, and allows them only through the named-role condition", () => {
    for (const k of keyPolicies())
      for (const principal of REAL) {
        for (const action of KMS_USE)
          expect(denied(k.statements, { principal, action, secure: true })).toBe(false);
        const allows = k.statements.filter(
          (s) =>
            s.Effect === "Allow" && list(s.Action).some((a) => KMS_USE.some((u) => glob(a, u))),
        );
        expect(allows.length).toBeGreaterThan(0);
        for (const s of allows)
          expect([...list(s.Condition!.ArnLike!["aws:PrincipalArn"]!)].sort()).toEqual(
            [...REAL].sort(),
          );
      }
  });

  it("leaves the account key administration, not use", () => {
    for (const k of keyPolicies()) {
      const admin = k.statements.filter((s) => s.Effect === "Allow" && !s.Condition);
      expect(admin).toHaveLength(1);
      const actions = list(admin[0]!.Action);
      expect(actions).toContain("kms:PutKeyPolicy");
      expect(actions).not.toContain("kms:*");
      for (const a of actions) for (const u of KMS_USE) expect(glob(a, u), a).toBe(false);
    }
  });
});

describe("N-4: the mock stack names nothing of the secure environment", () => {
  it("has no policy, role or variable mentioning real data", () => {
    const mock = Template.fromStack(
      new SignalsMockStack(new App(), "MorokuSignalsMock-iso", {
        env: { account: ACCOUNT, region: "ap-southeast-2" },
        assetPath: "test/infra/empty-asset",
      }),
    ).toJSON();
    expect(JSON.stringify(mock)).not.toMatch(/realdata|RealData|moroku-signals-realdata/);
  });
});
