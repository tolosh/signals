// SIG-61: bundles the secure environment's Lambda (infra/realdata-lambda.ts) for
// infra/realdata-stack.ts. Building is local; deploying the stack needs Colin's go-ahead.
import { rmSync } from "node:fs";
import { build } from "esbuild";

const out = "dist/realdata-lambda";
rmSync(out, { recursive: true, force: true });
await build({
  entryPoints: ["infra/realdata-lambda.ts"],
  outfile: `${out}/index.mjs`,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
