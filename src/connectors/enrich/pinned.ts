// SIG-70 (ruling 40719, 2; Colin, 27 November 2026): LocalEnrich on the pinned Enrich build, the
// ENR-28 build (engine 1.8.0, taxonomy 1.4, moroku-enrich 8cdb0d9, ENR-28 comment 40724). The
// build is packaged in vendor/moroku-enrich/ by scripts/enrich-package.ts, by commit and hash, and
// imported from there; never from a sibling checkout at run time. pin.json names it; a new build
// is a new bundle and pin, and a new research/enrich fixture.
import pin from "../../../vendor/moroku-enrich/pin.json" with { type: "json" };
import * as engine from "../../../vendor/moroku-enrich/engine-1.8.0-8cdb0d9.mjs";
import { makeLocalEnrich, type EngineModule } from "./local.js";
import type { Categoriser, EngineBuild } from "./types.js";

/** The pinned build, as each assessment's Enrich record names it. */
export const PINNED_BUILD: EngineBuild = {
  commit: pin.moroku_enrich_commit,
  version: pin.engine_version,
  dist_sha256: pin.dist_index_sha256,
};

/** LocalEnrich on the pinned build. */
export function pinnedLocalEnrich(): Categoriser {
  if (engine.ENGINE_VERSION !== pin.engine_version)
    throw new Error(
      `the packaged engine is ${engine.ENGINE_VERSION}, not the pin's ${pin.engine_version}`,
    );
  return makeLocalEnrich(engine as unknown as EngineModule, PINNED_BUILD);
}
