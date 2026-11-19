// SIG-57 T6: the alias table, compiled by a separate agent from public sources (ruling 40434),
// cites a source for every alias and leaves every reserved unseen-lender name alone. Failures
// print table lender IDs only, never a reserved name, so the table's author doesn't learn them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UNSEEN_PROVIDERS, UNSEEN_PROVIDERS_V21 } from "../../src/research/generator/catalog.js";
import { UNSEEN_PROVIDERS_V22 } from "../../src/research/generator/v22/catalog.js";

type Alias = { text: string; kind: string; source_url: string };
type Lender = { id: string; canonical: string; families: string[]; aliases: Alias[] };
const table = JSON.parse(readFileSync("research/aliases/lender-aliases-1.0.0.json", "utf8")) as {
  version: string;
  lenders: Lender[];
};

const words = (s: string) =>
  ` ${s
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
// Each catalogue maps a family to its reserved names (as in lender-names.test.ts).
const reserved = [UNSEEN_PROVIDERS, UNSEEN_PROVIDERS_V21, UNSEEN_PROVIDERS_V22]
  .flatMap((m) => Object.values(m).flat())
  .map((n) => words(String(n)));

describe("SIG-57 alias table", () => {
  it("is version 1.0.0 and lists lenders", () => {
    expect(table.version).toBe("1.0.0");
    expect(table.lenders.length).toBeGreaterThan(0);
  });

  it("cites an https source for every alias", () => {
    const uncited = table.lenders
      .filter((l) => l.aliases.some((a) => !/^https:\/\/\S+$/.test(a.source_url ?? "")))
      .map((l) => l.id);
    expect(uncited).toEqual([]);
  });

  it("has no alias that is, contains or is contained in a reserved unseen-lender name", () => {
    expect(reserved.length).toBeGreaterThan(0);
    const hits = table.lenders
      .filter((l) =>
        [l.canonical, ...l.aliases.map((a) => a.text)].some((t) => {
          const w = words(t);
          return reserved.some((r) => w.includes(r) || r.includes(w));
        }),
      )
      .map((l) => l.id);
    expect(hits).toEqual([]);
  });
});
