/* global process, console */
// SIG-82: bundles the demo stage's Lambda (src/api/lambda.ts) with the files it reads at run time,
// and records the commit it was built from in build-info.json. The stack passes that commit to the
// Lambda and /health reads it back (T4). It refuses a dirty tree, so the recorded commit is the
// code that runs.   node infra/build-demo-lambda.mjs [--allow-dirty]
import { execFileSync } from "node:child_process";
import { cpSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD");
const dirty = git("status", "--porcelain");
if (dirty && !process.argv.includes("--allow-dirty")) {
  console.error(
    "The working tree has changes; commit them first, so the recorded commit is what runs.",
  );
  process.exit(1);
}

const out = "dist/demo-lambda";
rmSync(out, { recursive: true, force: true });
await build({
  entryPoints: ["src/api/lambda.ts"],
  outfile: `${out}/index.mjs`,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
cpSync("openapi.yaml", `${out}/openapi.yaml`);
// Candidate 1: SIG-76's five scenario inputs, built as its in-process runs built them, each feed
// in its seeded order (src/api/scenario-inputs.ts). Synthetic data only.
execFileSync(
  process.execPath,
  ["--import", "tsx", "src/api/write-scenario-inputs.ts", `${out}/scenario-inputs.json`],
  { stdio: "inherit" },
);
writeFileSync(
  `${out}/build-info.json`,
  JSON.stringify({ commit, dirty: Boolean(dirty), built_at: new Date().toISOString() }, null, 2) +
    "\n",
);
console.log(`Built ${out} at ${commit}${dirty ? " (dirty)" : ""}`);
