// SIG-60 section 5, "fix the gaps from both reviews", written before the fixes: the README's
// regeneration commands work against the committed manifests, sets v2 and v2.1 are marked
// withdrawn in their own manifests, and the generator script checks its outputs before writing.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readme = readFileSync("README.md", "utf8");
const commands = [...readme.matchAll(/^npx tsx scripts\/generate-synthetic[^\n]*$/gm)].map(
  (m) => m[0],
);
const PLAN = "../../../scripts/lib/synthetic-outputs.js";

describe("README regeneration commands (v2.1 review, G4)", () => {
  it("lists a command for every set, v1 to v2.2", () => {
    for (const v of ["synthetic-v1", "2.0", "2.1", "2.2"])
      expect(
        commands.some((c) => c.includes(v)),
        v,
      ).toBe(true);
  });
  it("every command checks against the committed manifest (--check) and writes nothing", () => {
    expect(commands.length).toBeGreaterThanOrEqual(4);
    for (const c of commands) expect(c, c).toMatch(/--check\b/);
  });
});

describe("the generator script checks its outputs before writing anything", () => {
  it("an existing manifest or folder stops the run before the first applicant file", async () => {
    let plan: ((out: string) => { folder: string; manifest: string }) | null = null;
    try {
      plan = (
        (await import(/* @vite-ignore */ PLAN)) as {
          planOutputs: (out: string) => { folder: string; manifest: string };
        }
      ).planOutputs;
    } catch {
      plan = null;
    }
    expect(plan, "scripts/lib/synthetic-outputs.ts exports planOutputs").not.toBeNull();
    if (!plan) return;
    // The committed manifest sits beside the default output folder: refused, naming the path.
    expect(() => plan?.("research/datasets/synthetic-v2.1")).toThrow(/synthetic-v2\.1\.manifest/);
    expect(plan("research/datasets/not-yet-a-set")).toEqual({
      folder: "research/datasets/not-yet-a-set",
      manifest: "research/datasets/not-yet-a-set.manifest.json",
    });
  });
});

describe("sets v2 and v2.1 are withdrawn in their manifests (v2.1 review, G4)", () => {
  for (const [set, path] of [
    ["v2", "research/datasets/synthetic-v2.manifest.json"],
    ["v2.1", "research/datasets/synthetic-v2.1.manifest.json"],
  ] as const)
    it(`set ${set}`, () => {
      expect(existsSync(path)).toBe(true);
      const m = JSON.parse(readFileSync(path, "utf8")) as {
        withdrawn?: { from_experiments: boolean; date: string; reason: string; by: string };
      };
      expect(m.withdrawn?.from_experiments).toBe(true);
      expect(m.withdrawn?.date).toMatch(/^2026-11-0[89]$/);
      expect(m.withdrawn?.reason).toMatch(/leak/i);
      expect(m.withdrawn?.by).toMatch(/SIG-54/);
    });
});
