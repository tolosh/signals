// Synthetic applicant generator v1 (SIG-12). See research/schemas/ for the output schemas.
export { generateApplicant, serialise } from "./generate.js";
export { population, scenario } from "./population.js";
export {
  populationV2,
  SET_V2_MINIMUMS,
  SET_V2_SEED,
  SET_V21_MINIMUMS,
  SET_V21_SEED,
} from "./population-v2.js";
export {
  AS_OF_DATE,
  GENERATOR_VERSION,
  GENERATOR_VERSION_V2,
  GENERATOR_VERSION_V21,
  GROUND_TRUTH_SCHEMA_VERSION,
  GROUND_TRUTH_SCHEMA_VERSION_V2,
  GROUND_TRUTH_SCHEMA_VERSION_V21,
  type ApplicantSpec,
  type GeneratedApplicant,
  type GroundTruth,
  type SpecOverrides,
  type Transaction,
} from "./types.js";
