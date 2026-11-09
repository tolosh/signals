// SIG-61 ruling N-1 (Colin, 9 November 2026, comment 40198): nothing Moroku shows may say or imply
// that Moroku is accredited or acting under the CDR (openfeed terms cl 4.4(a)). This sweeps every
// surface in the repo that reaches a user: the contract (which Lovable renders), the mock and its
// fixtures (served by the hosted mock), the engines (whose reasons and resolve text are shown), and
// the secure environment's connect pages. Lovable's own UI copy is outside this repo;
// the Lovable ticket for N-6 asks for the same sweep there.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findCdrClaims } from "../../src/research/realdata/notice.js";

const SURFACES = [
  "openapi.yaml",
  "src/mock",
  "src/engines",
  "test/fixtures",
  "infra/realdata-lambda.ts",
];
// The collection notice's own text is checked as rendered, in test/research/realdata/notice.test.ts
// (its source holds the claim patterns themselves).

function files(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((f) => files(join(path, f)));
}

describe("no CDR claims anywhere a user sees", () => {
  it("covers a real set of files", () => {
    // Every surface holds files (42 in all on 9 November 2026).
    for (const s of SURFACES) expect(files(s).length, s).toBeGreaterThan(0);
    expect(SURFACES.flatMap(files).length).toBeGreaterThan(30);
  });

  it.each(SURFACES.flatMap(files).map((f) => [f]))("%s makes no CDR claim", (f) => {
    expect(findCdrClaims(readFileSync(f, "utf8"))).toEqual([]);
  });

  it("negative control: a planted claim in a surface's text is caught", () => {
    const text = `${readFileSync("openapi.yaml", "utf8")}\n# Moroku is an accredited data recipient.`;
    expect(findCdrClaims(text)).not.toEqual([]);
  });
});
