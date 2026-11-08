// SIG-60 T8: the pre-registration (features, classifiers, margins, intended evidence per label,
// and the channels the controls must be caught on) is frozen, and was committed before any
// change to the generator for set v2.2.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadPreregistration, PREREGISTRATION } from "../../../src/research/leakage/index.js";

const pre = loadPreregistration() as ReturnType<typeof loadPreregistration> & {
  status: string;
  channels: {
    set: string;
    caught_by: ({ label: string; family: string } | { check: string })[];
  }[];
  validity_checks: Record<string, string>;
};
const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" }).trim();

describe("T8 pre-registration", () => {
  it("is frozen", () => {
    expect(pre.status).toMatch(/^FROZEN/);
  });
  it("names an intended evidence for every label, from the registered families", () => {
    for (const l of pre.labels)
      for (const f of l.intended_evidence) expect(Object.keys(pre.families)).toContain(f);
  });
  it("every channel names a registered label and family, or a registered check", () => {
    const families = new Set([...Object.keys(pre.families), "twins"]);
    const labels = new Set(pre.labels.map((l) => l.id));
    for (const c of pre.channels)
      for (const e of c.caught_by)
        if ("check" in e) expect(Object.keys(pre.validity_checks)).toContain(e.check);
        else {
          expect(labels.has(e.label), e.label).toBe(true);
          expect(families.has(e.family), e.family).toBe(true);
        }
  });
  it("every run record was made under this pre-registration", () => {
    const sha = createHash("sha256").update(readFileSync(PREREGISTRATION)).digest("hex");
    for (const set of ["v2", "v2.1", "v2.2"]) {
      const r = JSON.parse(
        readFileSync(`research/runs/2026-11-09-sig60-leakage-${set}.json`, "utf8"),
      ) as { preregistration_sha256: string };
      expect(r.preregistration_sha256, set).toBe(sha);
    }
  });
  it("was committed, frozen, before the first commit of the set v2.2 generator", () => {
    // CI checks out the full history (fetch-depth 0), so this is checked there too.
    if (git("rev-parse", "--is-shallow-repository") === "true") return;
    const added = git("log", "--diff-filter=A", "--format=%H", "--", PREREGISTRATION)
      .split("\n")
      .filter(Boolean)
      .pop();
    const generator = git("log", "--reverse", "--format=%H", "--", "src/research/generator/v22")
      .split("\n")
      .filter(Boolean)[0];
    expect(added, "the pre-registration is committed").toBeTruthy();
    expect(generator, "the set v2.2 generator is committed").toBeTruthy();
    expect(added).not.toBe(generator);
    // The pre-registration's commit is an ancestor of the generator's first commit.
    expect(() => git("merge-base", "--is-ancestor", added ?? "", generator ?? "")).not.toThrow();
  });
});
