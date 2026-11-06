// Synthetic applicant generator v1 (SIG-12). See research/schemas/ for the output schemas.
export { generateApplicant, serialise } from "./generate.js";
export { population, scenario } from "./population.js";
export {
  AS_OF_DATE,
  GENERATOR_VERSION,
  GROUND_TRUTH_SCHEMA_VERSION,
  type ApplicantSpec,
  type GeneratedApplicant,
  type GroundTruth,
  type SpecOverrides,
} from "./types.js";
