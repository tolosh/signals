// SIG-82 review 23 (40821) on the demo stage's synthesis, written before the change:
//   - G4: infra/app.ts refuses an enrichPath context, or an ENRICH_PATH value, other than local.
//     It fails the build rather than overriding the value.
//   - A build recorded as dirty (--allow-dirty) refuses to synthesise, so it can't be deployed.
//   - The HS256 fallback (40820, 2) is set on the Lambda explicitly: on until Lovable's ES256 switch
//     is confirmed, then off with -c hs256Fallback=off; any other value refuses.
import { spawnSync } from "node:child_process";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import * as stack from "../../infra/demo-stack.js";

const { SignalsDemoStack } = stack;
const demoSettings = (stack as Record<string, unknown>).demoSettings as
  | ((
      context: Record<string, unknown>,
      env: Record<string, string | undefined>,
    ) => {
      enrichPath: "local";
      hs256Fallback: boolean;
    })
  | undefined;

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
type Props = ConstructorParameters<typeof SignalsDemoStack>[2];
const synth = (over: Partial<Props> = {}) =>
  Template.fromStack(
    new SignalsDemoStack(new App(), "MorokuSignalsDemo-r23", {
      env: { account: "111111111111", region: "ap-southeast-2" },
      assetPath: "test/infra/empty-asset",
      build: { commit: COMMIT },
      supabaseUrl: "https://abcdefgh.supabase.co",
      supabasePublishableKey: "sb_publishable_test",
      demoMembers: "a@demo.test:A,b@demo.test:B",
      enrichPath: "local",
      ...over,
    } as Props),
  );
const lambdaEnv = (t: Template) =>
  Object.values(t.findResources("AWS::Lambda::Function"))
    .map(
      (f) =>
        (f as { Properties: { Environment?: { Variables?: Record<string, unknown> } } }).Properties
          .Environment?.Variables ?? {},
    )
    .find((v) => "DEMO_TABLE" in v) ?? {};

/** Runs infra/app.ts as `cdk synth` would, with the given context and environment. */
const synthApp = (context: Record<string, string>, env: Record<string, string> = {}) =>
  spawnSync(process.execPath, ["--import", "tsx", "infra/app.ts"], {
    encoding: "utf8",
    env: { ...process.env, ENRICH_PATH: "", ...env, CDK_CONTEXT_JSON: JSON.stringify(context) },
  });

describe("G4: infra/app.ts refuses any Enrich path but local", () => {
  it("demoSettings accepts local, or nothing, and refuses anything else", () => {
    expect(typeof demoSettings).toBe("function");
    const s = demoSettings ?? (() => ({ enrichPath: "local", hs256Fallback: true }));
    expect(s({}, {}).enrichPath).toBe("local");
    expect(s({ enrichPath: "local" }, { ENRICH_PATH: "local" }).enrichPath).toBe("local");
    for (const [ctx, env] of [
      [{ enrichPath: "api" }, {}],
      [{ enrichPath: "" }, {}],
      [{ enrichPath: "LOCAL" }, {}],
      [{}, { ENRICH_PATH: "api" }],
      [{ enrichPath: "local" }, { ENRICH_PATH: "api" }],
    ] as [Record<string, unknown>, Record<string, string>][])
      expect(() => s(ctx, env), JSON.stringify([ctx, env])).toThrow(/local/);
  });

  it.each([
    ["-c enrichPath=api", { demo: "true", enrichPath: "api" }, {}],
    ["ENRICH_PATH=api", { demo: "true" }, { ENRICH_PATH: "api" }],
  ])(
    "`cdk synth %s` fails the build",
    (_, context, env) => {
      const r = synthApp(context, env);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/Enrich path/);
    },
    60_000,
  );
});

describe("a dirty build refuses to synthesise", () => {
  it("refuses a build-info recorded dirty, and accepts a clean one", () => {
    expect(() => synth({ build: { commit: COMMIT, dirty: true } as Props["build"] })).toThrow(
      /dirty/,
    );
    expect(() =>
      synth({ build: { commit: COMMIT, dirty: false } as Props["build"] }),
    ).not.toThrow();
  }, 60_000);
});

describe("40820, 2: the HS256 fallback is set on the Lambda explicitly", () => {
  it("on by default, until the ES256 switch is confirmed; off when asked", () => {
    expect(lambdaEnv(synth()).SUPABASE_HS256_FALLBACK).toBe("on");
    expect(
      lambdaEnv(synth({ hs256Fallback: false } as Partial<Props>)).SUPABASE_HS256_FALLBACK,
    ).toBe("off");
  }, 60_000);

  it("-c hs256Fallback takes on or off only", () => {
    const s = demoSettings ?? (() => ({ enrichPath: "local", hs256Fallback: true }));
    expect(s({}, {}).hs256Fallback).toBe(true);
    expect(s({ hs256Fallback: "on" }, {}).hs256Fallback).toBe(true);
    expect(s({ hs256Fallback: "off" }, {}).hs256Fallback).toBe(false);
    expect(() => s({ hs256Fallback: "yes" }, {})).toThrow(/hs256Fallback/);
  });
});
