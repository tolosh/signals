// Synthetic applicant generator v1 (SIG-12). See research/schemas/ for the output schemas.
export { generateApplicant, serialise } from "./generate.js";
export { population, scenario } from "./population.js";
export { populationV2, SET_V2_MINIMUMS, SET_V2_SEED } from "./population-v2.js";
export {
  AS_OF_DATE,
  GENERATOR_VERSION,
  GENERATOR_VERSION_V2,
  GROUND_TRUTH_SCHEMA_VERSION,
  GROUND_TRUTH_SCHEMA_VERSION_V2,
  type ApplicantSpec,
  type GeneratedApplicant,
  type GroundTruth,
  type SpecOverrides,
} from "./types.js";
