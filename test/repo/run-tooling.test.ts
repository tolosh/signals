// SIG-56: every run script writes a record that names its exact command and a clean commit, never
// overwrites a committed record, and reads its seed from the manifest (H0). The shared helpers are
// in scripts/lib/run-record.ts; scripts/eq-unverified.ts (SIG-39) was the model.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  manifestSeed,
  parseRunArgs,
  provenance,
  requireCleanTree,
  writeNew,
} from "../../scripts/lib/run-record.js";

/** Scripts that write run records or committed research outputs, and so must use the helpers. */
const RECORD_SCRIPTS = [
  "score.ts",
  "eq-distribution.ts",
  "af-rulings-run.ts",
  "sig17-miss-analysis.ts",
  "sig17-bpay-exploratory.ts",
  "enrich-sample.ts",
  "enrich-categorise-set.ts",
];
/**
 * Already meet the standard with their own code, and belong to runs under independent review at
 * 7a25f34 (SIG-18, SIG-41), so they are left as they are until those reviews are posted.
 * generate-synthetic.ts writes the set itself, checked by its hash, not a run record.
 */
const OWN_EQUIVALENT = ["eq-unverified.ts", "inc-distribution.ts", "lia-detect.ts"];
const EXEMPT = ["generate-synthetic.ts", "build-mock-lambda.mjs", "check-pr-title.mjs"];

describe("SIG-56 T1: a run never overwrites a record", () => {
  it("writeNew refuses an existing file and writes nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "sig56-"));
    const path = join(dir, "record.json");
    writeFileSync(path, "committed\n");
    expect(() => writeNew(path, "new\n")).toThrow(/exists/);
    expect(readFileSync(path, "utf8")).toBe("committed\n");
  });

  it("writes a new file, creating the output folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "sig56-"));
    const path = join(dir, "nested", "record.json");
    writeNew(path, "new\n");
    expect(readFileSync(path, "utf8")).toBe("new\n");
  });

  it("--out picks the folder; research/runs/ is the default", () => {
    expect(parseRunArgs(["--engine", "x"]).out).toBe("research/runs");
    expect(parseRunArgs(["--out", "research/runs/rerun", "--engine", "x"]).out).toBe(
      "research/runs/rerun",
    );
  });
});

describe("SIG-56 T2: uncommitted changes refuse the run", () => {
  it("refuses a dirty tree without --allow-dirty", () => {
    expect(() => requireCleanTree(" M src/engines/x.ts", false)).toThrow(/Uncommitted/);
  });
  it("runs on a clean tree, or a dirty one when --allow-dirty is given", () => {
    expect(() => requireCleanTree("", false)).not.toThrow();
    expect(() => requireCleanTree(" M src/engines/x.ts", true)).not.toThrow();
    expect(parseRunArgs(["--allow-dirty"]).allowDirty).toBe(true);
  });
});

describe("SIG-56 T3: a record carries its command, its arguments and its commit", () => {
  it("provenance has the command, the parsed arguments, the commit and the tree state", () => {
    const args = parseRunArgs(["--engine", "expenses-v1", "--lookback", "6"]);
    const p = provenance("scripts/score.ts", args, { commit: "abc123", status: "" });
    expect(p).toEqual({
      command: "npx tsx scripts/score.ts --engine expenses-v1 --lookback 6",
      arguments: { engine: "expenses-v1", lookback: "6" },
      engine_commit: "abc123",
      tree: "clean",
    });
  });
  it("a run allowed on a dirty tree says so in its record", () => {
    const args = parseRunArgs(["--allow-dirty"]);
    const p = provenance("scripts/score.ts", args, { commit: "abc123", status: " M x.ts" });
    expect(p.tree).toBe("dirty (--allow-dirty)");
  });

  it("every record-writing script uses the helpers, and none writes a file directly", () => {
    const listed = execFileSync("git", ["ls-files", "scripts"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => /^scripts\/[^/]+\.(ts|mjs)$/.test(f))
      .map((f) => f.slice("scripts/".length));
    expect([...listed].sort()).toEqual([...RECORD_SCRIPTS, ...OWN_EQUIVALENT, ...EXEMPT].sort());
    for (const f of RECORD_SCRIPTS) {
      const text = readFileSync(`scripts/${f}`, "utf8");
      expect(text, f).toMatch(/from "\.\/lib\/run-record\.js"/);
      expect(text, f).not.toMatch(/writeFileSync\(/);
      expect(text, f).toMatch(/requireCleanTree\(/);
    }
  });
});

describe("SIG-56 T4: seeds come from the manifest", () => {
  it("manifestSeed reads the manifest, so a changed seed changes the run", () => {
    const dir = mkdtempSync(join(tmpdir(), "sig56-"));
    const path = join(dir, "manifest.json");
    writeFileSync(path, JSON.stringify({ set: "x", seed: 7, set_sha256: "abc" }));
    expect(manifestSeed(path).seed).toBe(7);
    expect(manifestSeed().seed).toBe(42);
  });
  it("no run script hard-codes a seed the manifest holds", () => {
    for (const f of RECORD_SCRIPTS) {
      const text = readFileSync(`scripts/${f}`, "utf8");
      expect(text, f).not.toMatch(/population\(\s*\d+\s*\)|generateApplicant\([^)]*,\s*\d+\s*\)/);
      expect(text, f).not.toMatch(/"seed",\s*"\d+"/);
    }
  });
});

describe("SIG-56 T5: the script behind SIG-17's 96.9% (exploratory, not pre-registered)", () => {
  it("counting non-card BPAY bills as committed reproduces 349 of 360 (96.9%)", async () => {
    const { bpayBillsAsCommitted } = await import("../../src/research/sig17-bpay-exploratory.js");
    const r = bpayBillsAsCommitted();
    expect(r.applicants).toBe(360);
    expect(r.within).toBe(349);
    expect(Math.round(r.share * 1000) / 10).toBe(96.9);
  }, 120_000);
});

describe("SIG-56 T6 (negative control): committed run records are untouched", () => {
  it("no committed file under research/ differs from HEAD", () => {
    const diff = execFileSync("git", ["diff", "--name-status", "HEAD", "--", "research"], {
      encoding: "utf8",
    }).trim();
    expect(diff).toBe("");
  });
});
