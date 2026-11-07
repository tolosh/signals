// SIG-56, from the SIG-18 review (follow-up 5, 8 November 2026): `npm test` ran the hosted-mock
// test files, which would hit the hosted mock whenever MOCK_BASE_URL happened to be set. Now only
// `npm run test:hosted` (vitest --mode hosted) reads it; `npm test` runs the same files against an
// in-process server, whatever the environment holds.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hostedBase } from "../mock/target.js";

const testFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? testFiles(join(dir, e.name))
      : e.name.endsWith(".ts")
        ? [join(dir, e.name)]
        : [],
  );

describe("npm test never reaches the hosted mock", () => {
  it("runs in the local target, which the config sets", () => {
    expect(process.env.MOCK_TARGET).toBe("local");
  });

  it("ignores MOCK_BASE_URL unless the run is in hosted mode", () => {
    expect(hostedBase({ MOCK_BASE_URL: "https://example.invalid" })).toBeUndefined();
    expect(
      hostedBase({ MOCK_TARGET: "local", MOCK_BASE_URL: "https://example.invalid" }),
    ).toBeUndefined();
  });

  it("hosted mode uses MOCK_BASE_URL, and refuses to run without it", () => {
    expect(hostedBase({ MOCK_TARGET: "hosted", MOCK_BASE_URL: "https://example.invalid" })).toBe(
      "https://example.invalid",
    );
    expect(() => hostedBase({ MOCK_TARGET: "hosted" })).toThrow(/MOCK_BASE_URL/);
  });

  it("no test file reads MOCK_BASE_URL except through hostedBase", () => {
    const readers = testFiles("test")
      .filter((f) => /process\.env\.MOCK_BASE_URL|env\.MOCK_BASE_URL/.test(readFileSync(f, "utf8")))
      .map((f) => f.replaceAll("\\", "/"));
    expect(readers).toEqual(["test/mock/target.ts"]);
  });

  it("test:hosted runs in hosted mode, on exactly the files that can target the hosted mock", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const hosted = pkg.scripts["test:hosted"] ?? "";
    expect(hosted).toMatch(/--mode hosted/);
    expect(pkg.scripts.test).not.toMatch(/--mode hosted/);
    const listed = [...hosted.matchAll(/test\/mock\/\S+\.test\.ts/g)].map((m) => m[0]).sort();
    const users = testFiles("test")
      .map((f) => f.replaceAll("\\", "/"))
      .filter((f) => f.endsWith(".test.ts") && /hostedBase\(/.test(readFileSync(f, "utf8")))
      .filter((f) => f !== "test/repo/hosted-isolation.test.ts")
      .sort();
    expect(listed).toEqual(users);
    expect(users).toHaveLength(4);
  });
});
