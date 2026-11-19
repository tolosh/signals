// SIG-60 ruling 2 of 16 November 2026 (comment 40386), on review 11's T3 finding: on set v2.2,
// drift is scored per applicant only, and the drift-tagged applicants with no drift line are
// excluded by a pre-registered list. Written before the list. The list must be exactly the
// applicants the regenerated truths show, and match the three ID prefixes the review gives.
import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { generateSetV22, SET_V22_SEED } from "../../../src/research/generator/v22/index.js";

const LIST = "research/datasets/synthetic-v2.2.drift-exclusions.json";
const REVIEW_PREFIXES = ["syn-v22-7620cc69", "syn-v22-ceb6a90a", "syn-v22-e5410aea"];
type Drift = { mode: string; transaction_ids: string[] } | null;
type Row = { id: string; tags: string[]; drift: Drift };

let rows: Row[] = [];
beforeAll(() => {
  rows = generateSetV22(SET_V22_SEED).map((a) => ({
    id: a.truth.applicant_id,
    tags: a.truth.tags as string[],
    drift: (a.truth as unknown as { v2: { drift: Drift } }).v2.drift,
  }));
}, 300_000);

const MODES = ["drift-over-time", "drift-across-banks"] as const;
const tagged = (r: Row) => MODES.some((m) => r.tags.includes(m));
const observable = (r: Row) => (r.drift?.transaction_ids.length ?? 0) > 0;
type List = {
  set_sha256: string;
  ruling: string;
  excluded: { applicant_id: string; mode: string }[];
  observable: Record<string, number>;
};
// A missing list reads as empty, so every check below fails on its assertion.
const read = (): List =>
  existsSync(LIST)
    ? (JSON.parse(readFileSync(LIST, "utf8")) as List)
    : { set_sha256: "", ruling: "", excluded: [], observable: {} };

describe("set v2.2 drift exclusions (SIG-60 ruling 2, comment 40386)", () => {
  it("the list is committed", () => {
    expect(existsSync(LIST)).toBe(true);
  });
  it("lists exactly the drift-tagged applicants with no drift line, with their modes", () => {
    const expected = rows
      .filter((r) => tagged(r) && !observable(r))
      .map((r) => ({ applicant_id: r.id, mode: MODES.find((m) => r.tags.includes(m)) as string }))
      .sort((a, b) => a.applicant_id.localeCompare(b.applicant_id));
    expect(read().excluded).toEqual(expected);
  });
  it("matches the three applicants review 11 found, by their prefixes", () => {
    const ids = read().excluded.map((e) => e.applicant_id);
    expect(ids).toHaveLength(3);
    for (const p of REVIEW_PREFIXES) expect(ids.filter((id) => id.startsWith(p))).toHaveLength(1);
  });
  it("records the observable counts: 23 over time and 22 across banks, both at least 20", () => {
    const counts = Object.fromEntries(
      MODES.map((m) => [m, rows.filter((r) => r.tags.includes(m) && observable(r)).length]),
    );
    expect(read().observable).toEqual(counts);
    expect(counts).toEqual({ "drift-over-time": 23, "drift-across-banks": 22 });
  });
  it("names the set and the ruling", () => {
    const manifest = JSON.parse(
      readFileSync("research/datasets/synthetic-v2.2.manifest.json", "utf8"),
    ) as { set_sha256: string };
    expect(read().set_sha256).toBe(manifest.set_sha256);
    expect(read().ruling).toContain("40386");
  });
});
