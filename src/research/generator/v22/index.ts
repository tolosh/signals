// Synthetic set v2.2 (SIG-60): label-blind generation. See generate.ts for the design rule.
import { SET_V21_MINIMUMS } from "../population-v2.js";

export {
  generateSetV22,
  GENERATOR_VERSION_V22,
  GROUND_TRUTH_SCHEMA_VERSION_V22,
  HOLDERS,
  SET_V22_SEED,
  SET_V22_SIZE,
  UNDISCLOSED_SHARE,
} from "./generate.js";
export { UNSEEN_PROVIDERS_V22 } from "./catalog.js";

/** Set v2.1's minimums carried forward, plus the drift modes and the loan-account split. */
export const SET_V22_MINIMUMS: Readonly<Record<string, number>> = Object.freeze({
  ...SET_V21_MINIMUMS,
  "drift-over-time": 20,
  "drift-across-banks": 20,
  "account-in-grant": 10,
  "account-not-in-grant": 10,
});
