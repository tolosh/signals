// Synthetic set v2.3 (SIG-63): set v2.2's label-blind generation, with the fixes of review 11 and
// SIG-63 section 5. See generate.ts for the design rule.
import { SET_V22_MINIMUMS } from "../v22/index.js";

export {
  generateSetV23,
  GENERATOR_VERSION_V23,
  GROUND_TRUTH_SCHEMA_VERSION_V23,
  HOLDERS,
  SET_V23_SEED,
  SET_V23_SIZE,
  UNDISCLOSED_SHARE,
} from "./generate.js";
export { UNSEEN_PROVIDERS_V23 } from "./catalog.js";

/** Set v2.2's minimums, carried forward unchanged. */
export const SET_V23_MINIMUMS: Readonly<Record<string, number>> = Object.freeze({
  ...SET_V22_MINIMUMS,
});
