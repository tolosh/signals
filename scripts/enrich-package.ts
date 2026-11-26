// SIG-70 (ruling 40719, 2): packages a published Enrich engine build into the Signals repo, by
// moroku-enrich commit and hash, so Signals never imports the engine from a sibling checkout at run
// time. It refuses unless the moroku-enrich checkout is at the named commit with packages/engine and
// packages/taxonomy clean, and its built dist/index.js has the published SHA-256. It bundles the
// engine's dist with the taxonomy's (one ES module, paths relative to the checkout, so the bundle
// doesn't depend on where the checkout is) and writes the bundle and vendor/moroku-enrich/pin.json.
// Usage: npx tsx scripts/enrich-package.ts --repo <moroku-enrich> --commit <sha>
//        --dist-sha <published dist/index.js SHA-256> --tree-sha <published dist tree SHA-256>
//        --published <where it was published> [--out vendor/moroku-enrich] [--allow-dirty]
// Never overwrites: a new build is a new bundle and a new pin.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { build, version as esbuildVersion } from "esbuild";
import {
  gitState,
  parseRunArgs,
  provenance,
  requireCleanTree,
  writeNew,
} from "./lib/run-record.js";

const args = parseRunArgs(process.argv.slice(2), "vendor/moroku-enrich");
const git = gitState();
requireCleanTree(git.status, args.allowDirty);
const need = (name: string) => {
  const v = args.values[name];
  if (!v) throw new Error(`--${name} is required`);
  return v;
};
const repo = need("repo");
const commit = need("commit");
const distSha = need("dist-sha");
const treeSha = need("tree-sha");
const published = need("published");

const g = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();
if (g("rev-parse", "HEAD") !== commit)
  throw new Error(`moroku-enrich is at ${g("rev-parse", "HEAD")}, not ${commit}`);
const dirty = g("status", "--porcelain", "--", "packages/engine", "packages/taxonomy");
if (dirty !== "") throw new Error(`moroku-enrich's engine or taxonomy has changes:\n${dirty}`);

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const filesOf = (dir: string) =>
  Object.fromEntries(
    readdirSync(join(repo, dir))
      .filter((f) => f.endsWith(".js"))
      .sort()
      .map((f) => [f, sha(join(repo, dir, f))]),
  );
const engineDist = filesOf("packages/engine/dist");
const taxonomyDist = filesOf("packages/taxonomy/dist");
if (engineDist["index.js"] !== distSha)
  throw new Error(`dist/index.js is ${engineDist["index.js"]}, not the published ${distSha}`);

const bundled = await build({
  stdin: {
    contents: [
      'export * from "./packages/engine/dist/index.js";',
      'export { taxonomyDocument } from "./packages/taxonomy/dist/index.js";',
    ].join("\n"),
    resolveDir: repo,
    sourcefile: "signals-pin-entry.js",
  },
  absWorkingDir: repo,
  bundle: true,
  format: "esm",
  platform: "neutral",
  legalComments: "none",
  write: false,
});
const code = bundled.outputFiles[0]?.text ?? "";
const engine = (await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
)) as {
  ENGINE_VERSION: string;
  TAXONOMY_VERSION: string;
};
const name = `engine-${engine.ENGINE_VERSION}-${commit.slice(0, 7)}.mjs`;
const header = `// Moroku Enrich engine ${engine.ENGINE_VERSION} (taxonomy ${engine.TAXONOMY_VERSION}), moroku-enrich ${commit}.\n// Packaged by scripts/enrich-package.ts (SIG-70); do not edit. See pin.json.\n`;
const bundle = header + code;
mkdirSync(args.out, { recursive: true });
writeNew(join(args.out, name), bundle);
const pin = {
  ticket: "SIG-70",
  ruling:
    "40719, 2: packaged by commit and hash, never imported from a sibling checkout at run time",
  published,
  moroku_enrich_commit: commit,
  engine_version: engine.ENGINE_VERSION,
  taxonomy_version: engine.TAXONOMY_VERSION,
  dist_index_sha256: distSha,
  dist_tree_sha256_published: treeSha,
  dist_files: engineDist,
  taxonomy_dist_files: taxonomyDist,
  bundle: name,
  bundle_sha256: createHash("sha256").update(bundle).digest("hex"),
  bundler: { esbuild: esbuildVersion, format: "esm", platform: "neutral" },
  ...provenance("scripts/enrich-package.ts", args, git),
};
writeNew(join(args.out, "pin.json"), `${JSON.stringify(pin, null, 2)}\n`);
console.log(JSON.stringify({ bundle: name, bundle_sha256: pin.bundle_sha256 }));
