// SIG-82 (mandate 40777, "The interface"): the only way the demo application reaches the
// composition. Thread 2 calls assessApplicant through this port and maps its result to the
// contract's Assessment in src/api/; it never reshapes a figure or a state. Candidate 0 has no
// composition wired (NOT_WIRED): the assessment endpoints return a labelled 501, never a fixture
// (SIG-76 T4). Candidate 1 wires assessApplicant here, after Colin rules on the mapping (40805).
import type { ScenarioKey } from "./seed.js";

export type AssessRequest = {
  workspace_id: string;
  applicant_id: string;
  scenario: ScenarioKey;
};
export type AssessmentPort = {
  readonly wired: boolean;
  /** Runs one assessment; null when this build has none wired. */
  assess(r: AssessRequest): Promise<unknown>;
};

export const NOT_WIRED: AssessmentPort = Object.freeze({
  wired: false,
  assess: () => Promise.resolve(null),
});

export const NOT_WIRED_MESSAGE =
  "Assessments are not wired in this build (SIG-82 candidate 0). The real assessment, assessApplicant on the seeded scenario, arrives in candidate 1; nothing here returns a sample result.";
