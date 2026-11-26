// SIG-70 (ruling 40719, 2; Colin, 27 November 2026): LocalEnrich on the pinned Enrich build, the
// ENR-28 build (engine 1.8.0, taxonomy 1.4, moroku-enrich 8cdb0d9, ENR-28 comment 40724). The
// build is packaged in vendor/moroku-enrich/ by scripts/enrich-package.ts, by commit and hash, and
// imported from there; never from a sibling checkout at run time. vendor/moroku-enrich/pin.json
// names it; a new build is a new bundle and pin, and a new research/enrich fixture.
//
// The build's identity is written here, not imported from pin.json: esbuild and tsx turn a JSON
// import into a module of named exports, and pin.json's provenance field "arguments" is not a name
// strict mode allows. test/connectors/enrich/pin.test.ts asserts it equals pin.json.
import * as engine from "../../../vendor/moroku-enrich/engine-1.8.0-8cdb0d9.mjs";
import { makeLocalEnrich, type EngineModule } from "./local.js";
import type { Categoriser, EngineBuild } from "./types.js";

/** The pinned build, as each assessment's Enrich record names it (pin.json). */
export const PINNED_BUILD: EngineBuild = {
  commit: "8cdb0d926f7a9473051655fdeed5d69c1ceffaeb",
  version: "1.8.0",
  dist_sha256: "134909daf5c246ae76104bd653dfdfc68814d112f14b2ebbb335cef92ce9e421",
};

/** LocalEnrich on the pinned build. */
export function pinnedLocalEnrich(): Categoriser {
  if (engine.ENGINE_VERSION !== PINNED_BUILD.version)
    throw new Error(
      `the packaged engine is ${engine.ENGINE_VERSION}, not the pin's ${PINNED_BUILD.version}`,
    );
  return makeLocalEnrich(engine as unknown as EngineModule, PINNED_BUILD);
}
