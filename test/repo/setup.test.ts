// SIG-9 section 6 tests. T2 (clean clone) and T4 (push to main rejected) are
// observed in CI and GitHub, not here; results are recorded on the ticket.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasSigKey } from "../../scripts/check-pr-title.mjs";

describe("T1 PR title must carry a SIG key", () => {
  it.each(["SIG-9: Repository setup", "SIG-123: x"])("accepts %s", (title) => {
    expect(hasSigKey(title)).toBe(true);
  });

  it.each([
    "Repository setup",
    "",
    "sig-9: lower case",
    "SIG-: no number",
    "SIG-9 no colon",
    "Fix SIG-9: key not at start",
  ])("rejects %j", (title) => {
    expect(hasSigKey(title)).toBe(false);
  });
});

describe("T3 CLAUDE.md", () => {
  it("is present at the root with the Kickoff page's sections", () => {
    const text = readFileSync("CLAUDE.md", "utf8");
    expect(text.startsWith("# Moroku Signals API\n")).toBe(true);
    for (const heading of ["## This is a science experiment", "## Engineering rules", "## Stack"]) {
      expect(text).toContain(heading);
    }
  });
});

describe("layout (Build Specification 5.2, plus research/ and docs/adr/)", () => {
  it.each([
    "infra",
    "src/api",
    "src/portal",
    "src/auth",
    "src/connectors/openfeed",
    "src/connectors/enrich",
    "src/connectors/stripe",
    "src/connectors/messaging",
    "src/sync",
    "src/engines/affordability",
    "src/engines/signals",
    "src/engines/rollup",
    "src/engines/decisioning",
    "definitions",
    "src/report",
    "src/jobs",
    "src/watch",
    "db/migrations",
    "test/fixtures",
    "research/datasets",
    "research/runs",
    "docs/adr",
  ])("%s exists", (path) => {
    expect(existsSync(path)).toBe(true);
  });
});
