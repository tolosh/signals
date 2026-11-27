// SIG-82 (40822, 1): the demo stack after the HS256 fallback's removal, written before the change.
//   - The Lambda carries no SUPABASE_HS256_FALLBACK.
//   - -c hs256Fallback, with any value, fails the build: the setting no longer exists, so a deploy
//     command that still passes it is stopped rather than silently ignored.
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { demoSettings, SignalsDemoStack } from "../../infra/demo-stack.js";

type Props = ConstructorParameters<typeof SignalsDemoStack>[2];
const synth = () =>
  Template.fromStack(
    new SignalsDemoStack(new App(), "MorokuSignalsDemo-es256", {
      env: { account: "111111111111", region: "ap-southeast-2" },
      assetPath: "test/infra/empty-asset",
      build: { commit: "0123456789abcdef0123456789abcdef01234567" },
      supabaseUrl: "https://abcdefgh.supabase.co",
      supabasePublishableKey: "sb_publishable_test",
      demoMembers: "a@demo.test:A,b@demo.test:B",
      enrichPath: "local",
    } as Props),
  );

describe("40822, 1: the demo stack has no HS256 fallback", () => {
  it("the Lambda's environment has no SUPABASE_HS256_FALLBACK", () => {
    const vars = Object.values(synth().findResources("AWS::Lambda::Function")).map(
      (f) =>
        (f as { Properties: { Environment?: { Variables?: Record<string, unknown> } } }).Properties
          .Environment?.Variables ?? {},
    );
    expect(vars.some((v) => "DEMO_TABLE" in v)).toBe(true);
    for (const v of vars) expect(v).not.toHaveProperty("SUPABASE_HS256_FALLBACK");
  }, 60_000);

  it("-c hs256Fallback, with any value, fails the build", () => {
    expect(demoSettings({}, {})).toEqual({ enrichPath: "local" });
    for (const v of ["on", "off", "", true, false])
      expect(() => demoSettings({ hs256Fallback: v }, {}), String(v)).toThrow(/40822/);
  });
});
