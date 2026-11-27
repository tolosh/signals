// SIG-82 T4 (section 5, Health): GET /health returns the commit, the stage, the Enrich build
// (commit, version, dist SHA-256), the taxonomy and the engine versions. The commit is the one the
// build recorded (infra/build-demo-lambda.mjs), passed to the Lambda by the stack.
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { ASSESSMENT_COMPOSITION_VERSION } from "../assessment/assess.js";
import { pinnedLocalEnrich, PINNED_BUILD } from "../connectors/enrich/pinned.js";
import { OBSERVED_EXPENSES_METHOD_VERSION } from "../engines/affordability/observed-expenses.js";
import { DEFAULT_THRESHOLDS } from "../engines/affordability/thresholds.js";
import { EQ_METHOD_VERSION } from "../engines/evidence/checks.js";
import { INC_VERSION } from "../engines/families/inc/index.js";
import { LIA_VERSION } from "../engines/families/lia/index.js";
import { DEFINITIONS_VERSION } from "../engines/signals/definitions.js";

let contractVersion: string | null = null;
const contract = () =>
  (contractVersion ??= (
    parse(readFileSync("openapi.yaml", "utf8")) as { info: { version: string } }
  ).info.version);

export async function healthBody(
  commit: string,
  o: { assessmentWired?: boolean; hs256Fallback?: boolean } = {},
) {
  const taxonomy = await pinnedLocalEnrich().taxonomy();
  return {
    status: "ok" as const,
    stage: "demo" as const,
    commit,
    data: "synthetic" as const,
    real_data_path: "off" as const,
    contract_version: contract(),
    enrich: {
      path: "local" as const,
      commit: PINNED_BUILD.commit,
      version: PINNED_BUILD.version,
      dist_sha256: PINNED_BUILD.dist_sha256,
      taxonomy_version: taxonomy.taxonomy_version,
    },
    engines: {
      composition: ASSESSMENT_COMPOSITION_VERSION,
      inc: INC_VERSION,
      lia: LIA_VERSION,
      eq_method: EQ_METHOD_VERSION,
      observed_expenses: OBSERVED_EXPENSES_METHOD_VERSION,
      definitions: DEFINITIONS_VERSION,
      thresholds: DEFAULT_THRESHOLDS.version,
    },
    assessment_wired: o.assessmentWired ?? false,
    // Review 23 (40821): whether HS256 tokens still go to /auth/v1/user (40820, 2).
    auth: { hs256_fallback: o.hs256Fallback ?? false },
  };
}
