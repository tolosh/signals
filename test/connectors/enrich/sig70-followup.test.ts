// SIG-70 follow-up (ruling 40740, 2, as amended by 40749): O2, O3 and O4 from review 18 (comment
// 40739), written before the change. O1 is fixed on main by d660de9 (40749).
//
// O2: pin.json records no absolute local path; the moroku-enrich checkout is described, not named.
// O3: the packaging script checks the taxonomy build against a recorded hash, and refuses another.
// O4: synthetic feeds fail closed. The API path refuses unless a feed is positively marked as real,
//     consented data; a missing or false mark never reaches the API client.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (name: string): Promise<Mod> => {
  try {
    return (await import(/* @vite-ignore */ `../../../src/connectors/enrich/${name}.js`)) as Mod;
  } catch {
    return {};
  }
};

const TXS = [{ transactionId: "t1", description: "NEW KIND OF THING", amount: "-12.00" }];
const BUILD = { commit: "c".repeat(40), version: "0.0.0-standin", dist_sha256: "d".repeat(64) };

function standInEngine() {
  return {
    ENGINE_VERSION: "0.0.0-standin",
    TAXONOMY_VERSION: "9.9-standin",
    categorise(input: Record<string, unknown>) {
      return {
        category: "other_expenses",
        classification: "essential",
        confidence: 0.3,
        source: "fallback",
        excluded: false,
        flags: [],
        merchant: { name: String(input.description) },
        engine_version: "0.0.0-standin",
        taxonomy_version: "9.9-standin",
        direction: "out",
      };
    },
    taxonomyDocument() {
      return { taxonomy_version: "9.9-standin", categories: [] };
    },
  };
}

/** An API stand-in that records every call; it is never the live API. */
function standInApi() {
  const calls: unknown[] = [];
  return {
    calls,
    path: "api" as const,
    async categorise(txs: readonly unknown[]) {
      calls.push(txs);
      return {
        engine_version: "api-standin",
        taxonomy_version: "9.9-standin",
        results: txs.map(() => ({ category: "other_expenses" })),
      };
    },
    async taxonomy() {
      calls.push("taxonomy");
      return { taxonomy_version: "9.9-standin", categories: [] };
    },
  };
}

async function categorise(feed: Record<string, unknown>) {
  const local = await load("local");
  const path = await load("path");
  const api = standInApi();
  const record = await path.categoriseForAssessment?.({
    tenant: { status: "active" },
    txs: TXS,
    local: local.makeLocalEnrich?.(standInEngine(), BUILD),
    api,
    ...feed,
  });
  return { api, record };
}

describe("O4: synthetic feeds fail closed; only a feed marked real and consented reaches the API", () => {
  it("a feed with the mark omitted is refused: the API client is never called", async () => {
    const { api, record } = await categorise({});
    expect(api.calls).toHaveLength(0);
    expect(record?.path).toBe("local");
    expect(record?.api_refused).toBe("not_marked_real");
  });
  it("a feed marked false is refused", async () => {
    const { api, record } = await categorise({ realConsented: false });
    expect(api.calls).toHaveLength(0);
    expect(record?.api_refused).toBe("not_marked_real");
  });
  it.each([["true"], [1], [{}]])("a mark that isn't exactly true (%j) is refused", async (mark) => {
    const { api, record } = await categorise({ realConsented: mark });
    expect(api.calls).toHaveLength(0);
    expect(record?.api_refused).toBe("not_marked_real");
  });
  it("the old flag means nothing: synthetic false, with no mark, is refused", async () => {
    const { api, record } = await categorise({ synthetic: false });
    expect(api.calls).toHaveLength(0);
    expect(record?.api_refused).toBe("not_marked_real");
  });
  it("only a feed marked real and consented (true) goes to the API (here a stand-in)", async () => {
    const { api, record } = await categorise({ realConsented: true });
    expect(api.calls.length).toBeGreaterThan(0);
    expect(record?.path).toBe("api");
    expect(record?.api_refused).toBeUndefined();
  });
  it("forceLocal still wins over the mark (D58)", async () => {
    const { api, record } = await categorise({ realConsented: true, forceLocal: true });
    expect(api.calls).toHaveLength(0);
    expect(record?.path).toBe("local");
  });
});

const ABSOLUTE = /[A-Za-z]:[\\/]|\/Users\/|\/home\/|\\Users\\/;

describe("O2: pin.json records no absolute local path", () => {
  const raw = readFileSync("vendor/moroku-enrich/pin.json", "utf8");
  const pin = JSON.parse(raw) as Mod;
  it("no absolute path anywhere in pin.json", () => {
    expect(raw).not.toMatch(ABSOLUTE);
  });
  it("the checkout is described, not named, in the command and the arguments", () => {
    expect(pin.command).toContain("--repo <moroku-enrich checkout at moroku_enrich_commit>");
    expect(pin.arguments?.repo).toBe("<moroku-enrich checkout at moroku_enrich_commit>");
  });
  it("the bundle and the build's identity are unchanged", () => {
    expect(pin.bundle_sha256).toBe(
      "f843b882d5d7b028e3c437f87870f82ee8f0d0e4eaee9b98efce6b43799bbdbd",
    );
    expect(pin.moroku_enrich_commit).toBe("8cdb0d926f7a9473051655fdeed5d69c1ceffaeb");
  });
});

describe("O3: the taxonomy build is checked against a recorded hash", () => {
  it("pin.json records the taxonomy build's hash, as the taxonomy dist file's", () => {
    const pin = JSON.parse(readFileSync("vendor/moroku-enrich/pin.json", "utf8")) as Mod;
    expect(pin.taxonomy_dist_sha256).toBe(
      "bf0f5b289ec0db8003e540b12b191dbe1b83a13d4f8e6c98fdc00fc51b770f70",
    );
    expect(pin.taxonomy_dist_sha256).toBe(pin.taxonomy_dist_files?.["index.js"]);
    expect(pin.arguments?.["taxonomy-sha"]).toBe(pin.taxonomy_dist_sha256);
  });

  // The packaging script, run on a throwaway moroku-enrich stand-in (no real Enrich checkout).
  let repo: string;
  let outRoot: string;
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const ENGINE =
    'export const ENGINE_VERSION = "0.0.1";\nexport const TAXONOMY_VERSION = "0.1";\nexport function categorise() { return null; }\n';
  const TAXONOMY = 'export function taxonomyDocument() { return { taxonomy_version: "0.1" }; }\n';
  const tree = `${sha(ENGINE)} *packages/engine/dist/index.js\n`;
  let commit: string;
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "sig70-enrich-standin-"));
    outRoot = mkdtempSync(join(tmpdir(), "sig70-enrich-out-"));
    mkdirSync(join(repo, "packages/engine/dist"), { recursive: true });
    mkdirSync(join(repo, "packages/taxonomy/dist"), { recursive: true });
    writeFileSync(join(repo, "packages/engine/dist/index.js"), ENGINE);
    writeFileSync(join(repo, "packages/taxonomy/dist/index.js"), TAXONOMY);
    const git = (...a: string[]) =>
      execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();
    git("init", "-q");
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "standin");
    commit = git("rev-parse", "HEAD");
  });
  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(outRoot, { recursive: true, force: true });
  });
  const run = (out: string, extra: string[]) => {
    try {
      const stdout = execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/enrich-package.ts",
          "--repo",
          repo,
          "--commit",
          commit,
          "--dist-sha",
          sha(ENGINE),
          "--tree-sha",
          sha(tree),
          "--published",
          "a test",
          "--out",
          join(outRoot, out),
          "--allow-dirty",
          ...extra,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      return { ok: true, out: stdout };
    } catch (e) {
      return { ok: false, out: String((e as { stderr?: unknown }).stderr ?? e) };
    }
  };
  it("refuses without a recorded taxonomy hash (--taxonomy-sha)", () => {
    const r = run("missing", []);
    expect(r.ok).toBe(false);
    expect(r.out).toContain("--taxonomy-sha is required");
  }, 60_000);
  it("refuses a taxonomy build whose hash isn't the recorded one", () => {
    const r = run("wrong", ["--taxonomy-sha", "0".repeat(64)]);
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/taxonomy/);
    expect(readdirSync(outRoot)).not.toContain("wrong");
  }, 60_000);
  it("packages with the recorded hash, records it, and writes no absolute path (O2)", () => {
    const r = run("right", ["--taxonomy-sha", sha(TAXONOMY)]);
    expect(r.ok, r.out).toBe(true);
    const raw = readFileSync(join(outRoot, "right", "pin.json"), "utf8");
    const pin = JSON.parse(raw) as Mod;
    expect(pin.taxonomy_dist_sha256).toBe(sha(TAXONOMY));
    expect(raw).not.toContain(repo.replace(/\\/g, "/"));
    expect(raw).not.toContain(repo);
    expect(raw).not.toContain(outRoot);
    expect(pin.arguments?.repo).toBe("<moroku-enrich checkout at moroku_enrich_commit>");
  }, 60_000);
});
