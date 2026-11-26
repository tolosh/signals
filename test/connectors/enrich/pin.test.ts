// SIG-70, second part: the pinned Enrich build (ruling 40719, 2; Colin, 27 November 2026: the
// ENR-28 build, 1.8.0 at moroku-enrich 8cdb0d9, published on ENR-28 comment 40724). Written before
// the packaging. The engine is packaged into the Signals build by commit and hash, never imported
// from a sibling checkout at run time; research/enrich stays the CI fixture, a new build is a new
// fixture (recorded, never an overwrite), and runtime categories equal it for the same build.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { generateApplicant, population } from "../../../src/research/generator/index.js";
import { generateSetV22 } from "../../../src/research/generator/v22/index.js";

const PIN = "vendor/moroku-enrich/pin.json";
const PUBLISHED = {
  commit: "8cdb0d926f7a9473051655fdeed5d69c1ceffaeb",
  engine_version: "1.8.0",
  taxonomy_version: "1.4",
  dist_index_sha256: "134909daf5c246ae76104bd653dfdfc68814d112f14b2ebbb335cef92ce9e421",
  dist_tree_sha256: "151430cb2c42aa316c6c2dce3bbf20f1fa7aed83737536fa9c3e09c7ae735284",
};
const FIXTURES = {
  "synthetic-v1": "research/enrich/synthetic-v1-categories-engine-1.8.0.json",
  "synthetic-v2.2": "research/enrich/synthetic-v2.2-categories-no-biller-code-engine-1.8.0.json",
} as const;

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const PINNED = "../../../src/connectors/enrich/pinned.js";
const load = async (): Promise<Mod> => {
  try {
    return (await import(/* @vite-ignore */ PINNED)) as Mod;
  } catch {
    return {};
  }
};
const json = (p: string): Mod =>
  existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Mod) : {};
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

let m: Mod;
beforeAll(async () => {
  m = await load();
});

describe("the pin records the published ENR-28 build", () => {
  it("commit, versions and the published dist hashes, as ENR-28 40724 gives them", () => {
    const pin = json(PIN);
    expect(pin.moroku_enrich_commit).toBe(PUBLISHED.commit);
    expect(pin.engine_version).toBe(PUBLISHED.engine_version);
    expect(pin.taxonomy_version).toBe(PUBLISHED.taxonomy_version);
    expect(pin.dist_index_sha256).toBe(PUBLISHED.dist_index_sha256);
    expect(pin.dist_tree_sha256_published).toBe(PUBLISHED.dist_tree_sha256);
    expect(Object.keys(pin.dist_files ?? {})).toHaveLength(12);
    expect(pin.dist_files?.["index.js"]).toBe(PUBLISHED.dist_index_sha256);
  });
  it("the packaged bundle is in the repo, and its SHA-256 is the pin's", () => {
    const pin = json(PIN);
    const bundle = `vendor/moroku-enrich/${String(pin.bundle)}`;
    expect(existsSync(bundle)).toBe(true);
    expect(sha(bundle)).toBe(pin.bundle_sha256);
  });
});

describe("LocalEnrich runs the pinned build", () => {
  it("pinnedLocalEnrich carries the pin as its build, and the engine reports 1.8.0 / 1.4", async () => {
    expect(typeof m.pinnedLocalEnrich).toBe("function");
    const local = m.pinnedLocalEnrich?.();
    expect(local?.build).toEqual({
      commit: PUBLISHED.commit,
      version: PUBLISHED.engine_version,
      dist_sha256: PUBLISHED.dist_index_sha256,
    });
    const r = await local?.categorise([
      {
        transactionId: "t1",
        description: "WOOLWORTHS 1234 SYDNEY",
        amount: "-85.40",
        merchantCategoryCode: "5411",
      },
    ]);
    expect(r?.engine_version).toBe("1.8.0");
    expect(r?.taxonomy_version).toBe("1.4");
    expect((await local?.taxonomy())?.taxonomy_version).toBe("1.4");
  });
  it("ENR-28 is fixed in it: a BPAY bill payment is an expense, not a transfer", async () => {
    const local = m.pinnedLocalEnrich?.();
    expect(local).toBeDefined();
    const r = await local?.categorise([
      {
        transactionId: "t1",
        description: "BPAY ORIGIN ENERGY 123456",
        amount: "-182.30",
        billerName: "ORIGIN ENERGY RETAIL",
        billerCode: "5476",
      },
    ]);
    const result = r?.results[0] as Record<string, unknown> | undefined;
    expect(result?.category).not.toBe("transfer");
    expect(result?.excluded).toBe(false);
  });
  it("nothing in src/ imports the engine from a sibling checkout", () => {
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
      });
    const offenders = walk("src").filter((f) =>
      /moroku-enrich\/packages|packages\/engine\/dist/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

/** Debits as scripts/enrich-categorise-set.ts reads them, for one set. */
function debitsOf(set: keyof typeof FIXTURES) {
  const manifest = json(`research/datasets/${set}.manifest.json`) as { seed: number };
  const applicants =
    set === "synthetic-v2.2"
      ? generateSetV22(manifest.seed)
      : population(manifest.seed).map((spec) => generateApplicant(spec, manifest.seed));
  type T = {
    transactionId: string;
    description: string;
    amount: string;
    merchantCategoryCode?: string;
    merchantName?: string;
    billerCode?: string;
    billerName?: string;
    reference?: string;
  };
  return (applicants as unknown as { feed: { accounts: { transactions: T[] }[] } }[])
    .flatMap((a) => a.feed.accounts.flatMap((acc) => acc.transactions))
    .filter((t) => Number(t.amount) < 0)
    .map((t) => (set === "synthetic-v2.2" ? { ...t, billerCode: undefined } : t));
}

describe("the 1.8.0 fixtures: new files, never an overwrite, equal to runtime categories", () => {
  it.each(Object.entries(FIXTURES))("%s: recorded with the pinned build", (_set, path) => {
    const f = json(path);
    expect(f.enrich?.engine_version).toBe("1.8.0");
    expect(f.enrich?.taxonomy_version).toBe("1.4");
    expect(f.enrich_build?.moroku_enrich_commit).toBe(PUBLISHED.commit);
    expect(f.enrich_build?.bundle_sha256).toBe(json(PIN).bundle_sha256);
  });
  it.each(Object.entries(FIXTURES))(
    "%s: the pinned build's runtime categories equal the fixture",
    async (set, path) => {
      const local = m.pinnedLocalEnrich?.();
      expect(local).toBeDefined();
      const debits = debitsOf(set as keyof typeof FIXTURES);
      const r = await local?.categorise(debits);
      const runtime = Object.fromEntries(
        (r?.results ?? []).map((x: { transaction_id: string; category: string }) => [
          x.transaction_id,
          x.category,
        ]),
      );
      expect(runtime).toEqual(json(path).categories);
    },
    300_000,
  );
  it("the 1.7.0 fixtures are kept as they were", () => {
    expect(json("research/enrich/synthetic-v1-categories.json").enrich?.engine_version).toBe(
      "1.7.0",
    );
    expect(
      json("research/enrich/synthetic-v2.2-categories-no-biller-code.json").enrich?.engine_version,
    ).toBe("1.7.0");
  });
});
