// CLAUDE.md engineering rule (Decision Record D3): engines import no network, AWS, database or
// AI SDKs. Only relative imports are allowed under src/engines.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );

describe("engine purity", () => {
  it("every import under src/engines is relative", () => {
    const bad = files("src/engines").flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)]
        .map((m) => m[1] ?? "")
        .filter((spec) => !spec.startsWith("."))
        .map((spec) => `${file}: ${spec}`),
    );
    expect(bad).toEqual([]);
  });

  it("no engine reads the clock or randomness", () => {
    const bad = files("src/engines").filter((file) =>
      /Date\.now|new Date\(|Math\.random|performance\.now/.test(readFileSync(file, "utf8")),
    );
    expect(bad).toEqual([]);
  });
});
