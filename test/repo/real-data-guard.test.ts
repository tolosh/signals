// SIG-61 T2: real consented data never enters the repository, fixtures or run records (ADR 0008).
// 1. A scan of the committed research outputs and test fixtures: no file declares a real source; no
//    file holds an email, card number, TFN, phone number, CDR token, masked number or base64 token
//    anywhere; and every JSON file either belongs to a synthetic set, has a listed provenance (the
//    synthetic and specification shapes below), or passes the T2 guard in full.
// 2. scripts/lib/run-record.ts writes a real-data record only through the guard, only under
//    realdata/, which git ignores. Synthetic records are written as before.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { writeNew, writeRunRecord } from "../../scripts/lib/run-record.js";
import {
  classify,
  declaresRealSource,
  guardRunRecord,
  mentionsRealSource,
  SYNTHETIC_SOURCES,
  type Reason,
} from "../../src/research/realdata/guard.js";

/** Never allowed in a committed file, synthetic or not. */
const HARD: Reason[] = [
  "email",
  "card_number",
  "tfn",
  "phone",
  "cdr_token",
  "masked_number",
  "base64_token",
];

/**
 * JSON files that name no synthetic set but are not consumer data, with where they come from. Any
 * other file that names no synthetic set must pass the T2 guard in full.
 */
const PROVENANCE: Record<string, string> = {
  "test/fixtures/af-t1.json": "AF-T1, Build Specification 3.4",
  "test/fixtures/af-t1-assessment.json": "AF-T1 assessment, Build Specification 3.4",
  "test/fixtures/af-t1-build-spec-original.json": "AF-T1 as first published in the Build Spec",
  "test/fixtures/sig41-random-mismatches.json": "SIG-41 review sample of synthetic set v1",
  "research/runs/2026-11-07-sig15-rulings.json": "AF-T1 rulings run (SIG-15)",
  "research/runs/2026-11-05-sig12-t3-enrich-sample.json": "SIG-12 sample of synthetic set v1",
  "research/reviews/sig41-2026-11-08/random-mismatches.json": "SIG-41 review of synthetic set v1",
};

const walk = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((n) => {
        const p = join(dir, n).replaceAll("\\", "/");
        return statSync(p).isDirectory() ? walk(p) : [p];
      })
    : [];

/** The committed research outputs and fixtures the scan covers. */
function scannedFiles(root = "."): string[] {
  const at = (p: string) => join(root, p).replaceAll("\\", "/");
  const topLevel = (dir: string) =>
    existsSync(at(dir))
      ? readdirSync(at(dir))
          .map((n) => `${at(dir)}/${n}`)
          .filter((p) => statSync(p).isFile())
      : [];
  return [
    ...walk(at("research/runs")),
    ...topLevel("research/datasets"), // the sets themselves (research/datasets/*/) are not committed
    ...walk(at("research/preregistrations")),
    ...walk(at("research/reviews")),
    ...walk(at("research/enrich")),
    ...walk(at("test/fixtures")),
  ];
}

const namesSyntheticSet = (value: unknown): boolean =>
  typeof value === "string"
    ? (SYNTHETIC_SOURCES as readonly string[]).includes(value) || /synthetic-v\d/.test(value)
    : Array.isArray(value)
      ? value.some(namesSyntheticSet)
      : value !== null && typeof value === "object"
        ? Object.entries(value).some(([k, v]) => /synthetic-v\d/.test(k) || namesSyntheticSet(v))
        : false;

/** Problems in one file, as "path: reason" (never the offending value). */
function scanFile(file: string, rel = file): string[] {
  const text = readFileSync(file, "utf8");
  const problems: string[] = [];
  if (mentionsRealSource(text)) problems.push(`${rel}: declares a real source`);
  if (!file.endsWith(".json")) {
    text.split("\n").forEach((line, i) => {
      const r = classify(line);
      if (r && HARD.includes(r)) problems.push(`${rel}:${i + 1}: ${r}`);
    });
    return problems;
  }
  const json = JSON.parse(text) as unknown;
  if (declaresRealSource(json)) problems.push(`${rel}: declares a real source`);
  const hard = new Set<string>();
  const visit = (v: unknown): void => {
    if (typeof v === "string") {
      const r = classify(v);
      if (r && HARD.includes(r)) hard.add(r);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v !== null && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        const r = classify(k);
        if (r && HARD.includes(r)) hard.add(r);
        visit(x);
      }
  };
  visit(json);
  for (const r of hard) problems.push(`${rel}: ${r}`);
  const accounted = namesSyntheticSet(json) || rel in PROVENANCE;
  if (!accounted) {
    const reasons = new Set(guardRunRecord(json).violations.map((v) => v.reason));
    if (reasons.size)
      problems.push(`${rel}: names no synthetic set and fails the guard (${[...reasons]})`);
  }
  return problems;
}

describe("SIG-61 T2: repo scan of research outputs and fixtures", () => {
  const files = scannedFiles();

  it("covers the run records, manifests and fixtures", () => {
    expect(files.filter((f) => f.startsWith("research/runs/")).length).toBeGreaterThan(40);
    expect(files.filter((f) => /^research\/datasets\/.*\.manifest\.json$/.test(f)).length).toBe(3);
    expect(files).toContain("test/fixtures/af-t1.json");
  });

  it("no committed file declares a real source or holds a value the guard rejects", () => {
    expect(files.flatMap((f) => scanFile(f))).toEqual([]);
  });

  it("every listed provenance is still a file the scan sees", () => {
    expect(Object.keys(PROVENANCE).filter((p) => !files.includes(p))).toEqual([]);
  });

  describe("negative control: the scan catches planted files", () => {
    const root = mkdtempSync(join(tmpdir(), "sig61-scan-"));
    mkdirSync(join(root, "research/runs"), { recursive: true });
    mkdirSync(join(root, "test/fixtures"), { recursive: true });
    const plant = (rel: string, content: unknown) => {
      writeFileSync(
        join(root, rel),
        typeof content === "string" ? content : JSON.stringify(content),
      );
      return scanFile(join(root, rel), rel);
    };

    it("a run record that declares a real source", () => {
      expect(plant("research/runs/r1.json", { data_source: "openfeed-production", n: 3 })).toEqual(
        expect.arrayContaining(["research/runs/r1.json: declares a real source"]),
      );
    });
    it("a synthetic record holding an email or a card number", () => {
      expect(
        plant("research/runs/r2.json", { set: "synthetic-v1", who: "jane.citizen@example.com" }),
      ).toEqual(["research/runs/r2.json: email"]);
      expect(
        plant("test/fixtures/f.json", { set: "synthetic-v1", pan: "4111 1111 1111 1111" }),
      ).toEqual(["test/fixtures/f.json: card_number"]);
    });
    it("an unaccounted file with a narrative or an account number", () => {
      expect(plant("research/runs/r3.json", { rows: ["PAYMENT TO 062-000 12345678"] })).toEqual([
        "research/runs/r3.json: names no synthetic set and fails the guard (bsb)",
      ]);
    });
    it("a markdown summary naming a real source or holding a TFN", () => {
      expect(plant("research/runs/r4.md", "Run on openfeed-production data\n")).toHaveLength(1);
      expect(plant("research/runs/r5.md", "| a | 123 456 782 |\n")).toEqual([
        "research/runs/r5.md:1: tfn",
      ]);
    });
    it("an unaccounted file of counts and rates passes", () => {
      expect(plant("research/runs/r6.json", { ticket: "SIG-61", n: 4, rate: 0.5 })).toEqual([]);
    });
  });
});

describe("SIG-61 T2: the local realdata folder is git-ignored", () => {
  it(".gitignore lists realdata/ and git ignores a file there", () => {
    expect(readFileSync(".gitignore", "utf8").split(/\r?\n/)).toContain("realdata/");
    const out = execFileSync("git", ["check-ignore", "realdata/runs/x.json"], { encoding: "utf8" });
    expect(out.trim()).toBe("realdata/runs/x.json");
  });
});

describe("SIG-61 T2: run records from a real-data run go through the guard", () => {
  const dir = `realdata/test-${process.pid}`;
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const real = { data_source: "openfeed-production", ticket: "SIG-61", applicants: 4 };

  it("a clean real-data record of counts and rates is written under realdata/", () => {
    writeRunRecord(`${dir}/ok.json`, { ...real, rate: 0.75, as_of: "2026-10-31" });
    expect(JSON.parse(readFileSync(`${dir}/ok.json`, "utf8")).rate).toBe(0.75);
  });

  it("a real-data record holding a rejected value is refused and nothing is written", () => {
    expect(() =>
      writeRunRecord(`${dir}/bad.json`, { ...real, rows: ["PAYMENT TO WOOLWORTHS"] }),
    ).toThrow(/T2 guard/);
    expect(existsSync(`${dir}/bad.json`)).toBe(false);
  });

  it("a real-data record is never written into the repository's folders", () => {
    const path = `research/runs/sig61-should-not-exist-${process.pid}.json`;
    expect(() => writeRunRecord(path, real)).toThrow(/realdata/);
    expect(existsSync(path)).toBe(false);
  });

  it("writeNew refuses content naming a real source, so the guard can't be bypassed", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sig61-"));
    expect(() => writeNew(join(tmp, "x.json"), JSON.stringify(real))).toThrow(/T2 guard/);
    expect(() => writeNew(join(tmp, "x.md"), "on openfeed-production data")).toThrow(/T2 guard/);
    expect(existsSync(join(tmp, "x.json"))).toBe(false);
  });

  it("a synthetic record is written unchanged, free text and all", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sig61-"));
    const record = { dataset: { set: "synthetic-v1" }, note: "PAYMENT TO WOOLWORTHS 1043" };
    writeRunRecord(join(tmp, "s.json"), record);
    expect(JSON.parse(readFileSync(join(tmp, "s.json"), "utf8"))).toEqual(record);
  });
});
