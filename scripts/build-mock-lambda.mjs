// SIG-11: bundles the mock Lambda with the two files it reads at start-up.
import { cpSync, rmSync } from "node:fs";
import { build } from "esbuild";

const out = "dist/mock-lambda";
rmSync(out, { recursive: true, force: true });
await build({
  entryPoints: ["src/mock/lambda.ts"],
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
for (const f of [
  "af-t1-assessment.json",
  "af-t1.json",
  "benchmark-valid.csv",
  "benchmark-invalid.csv",
])
  cpSync(`test/fixtures/${f}`, `${out}/test/fixtures/${f}`);
