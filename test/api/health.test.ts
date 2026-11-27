// SIG-82 T4 (section 5, Health): GET /health returns the commit, the stage, the Enrich build
// (commit, version, dist SHA-256), the taxonomy and the engine versions, and they match the build.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ASSESSMENT_COMPOSITION_VERSION } from "../../src/assessment/assess.js";
import { healthBody } from "../../src/api/health.js";
import { OBSERVED_EXPENSES_METHOD_VERSION } from "../../src/engines/affordability/observed-expenses.js";
import { DEFAULT_THRESHOLDS } from "../../src/engines/affordability/thresholds.js";
import { EQ_METHOD_VERSION } from "../../src/engines/evidence/checks.js";
import { INC_VERSION } from "../../src/engines/families/inc/index.js";
import { LIA_VERSION } from "../../src/engines/families/lia/index.js";
import { DEFINITIONS_VERSION } from "../../src/engines/signals/definitions.js";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const pin = JSON.parse(readFileSync("vendor/moroku-enrich/pin.json", "utf8")) as {
  moroku_enrich_commit: string;
  engine_version: string;
  taxonomy_version: string;
  dist_tree_sha256_published: string;
};
const contract = (parse(readFileSync("openapi.yaml", "utf8")) as { info: { version: string } }).info
  .version;

describe("T4: /health reports the commit and the pinned versions", () => {
  it("reads back the commit and the stage", async () => {
    const h = await healthBody(COMMIT);
    expect(h.commit).toBe(COMMIT);
    expect(h.stage).toBe("demo");
    expect(h.data).toBe("synthetic");
    expect(h.real_data_path).toBe("off");
  });

  it("names the pinned Enrich build, local only, as pin.json records it", async () => {
    const h = await healthBody(COMMIT);
    expect(h.enrich).toEqual({
      path: "local",
      commit: pin.moroku_enrich_commit,
      version: pin.engine_version,
      dist_sha256: pin.dist_tree_sha256_published,
      taxonomy_version: pin.taxonomy_version,
    });
  });

  it("names the engine versions the build contains", async () => {
    const h = await healthBody(COMMIT);
    expect(h.engines).toEqual({
      composition: ASSESSMENT_COMPOSITION_VERSION,
      inc: INC_VERSION,
      lia: LIA_VERSION,
      eq_method: EQ_METHOD_VERSION,
      observed_expenses: OBSERVED_EXPENSES_METHOD_VERSION,
      definitions: DEFINITIONS_VERSION,
      thresholds: DEFAULT_THRESHOLDS.version,
    });
    expect(h.contract_version).toBe(contract);
  });

  it("says whether the assessment is wired (candidate 0: not yet)", async () => {
    const h = await healthBody(COMMIT);
    expect(typeof h.assessment_wired).toBe("boolean");
  });
});
