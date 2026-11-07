// Evidence-quality layer (SIG-39): the EQ checks, the per-signal block, capping and the roll-up
// gate. Product Specification Amendment 2 §2 and §3; Decision Record D12, D13, D20.
export { assessEvidence, EQ_METHOD_VERSION, EQ_THRESHOLDS } from "./checks.js";
export { applyEvidence, evidenceRollup } from "./apply.js";
export {
  ALIASES,
  DEFINITIONS,
  DEFINITIONS_VERSION,
  EQ_CHECKS,
  definition,
  type SignalDefinition,
} from "../signals/definitions.js";
export type * from "./types.js";
