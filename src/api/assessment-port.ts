// SIG-82 (mandate 40777, "The interface"): the only way the demo application reaches the
// composition. Thread 2 calls assessApplicant(input) through this port and never reshapes a figure
// or a state. Candidate 0 had none wired (NOT_WIRED: a labelled 501, never a fixture; SIG-76 T4).
// Candidate 1 wires the real assessApplicant (composition 1.2.0) on the scenario the applicant
// chose at the sandbox consent, with that scenario's pre-registered input passed unchanged, so its
// feed goes in its seeded order (SIG-76 T3). The output is mapped to the contract's Assessment in
// ./mapping.ts (contract 1.11.0; D65, SIG-82 40818).
import { assessApplicant, type Assessment } from "../assessment/assess.js";
import type { ScenarioInputs } from "./scenario-inputs.js";
import type { ScenarioKey } from "./seed.js";

export type AssessRequest = {
  workspace_id: string;
  applicant_id: string;
  scenario: ScenarioKey;
};
export type AssessmentPort = {
  readonly wired: boolean;
  /** Runs one assessment; null when this build has none wired. */
  assess(r: AssessRequest): Promise<{
    set_applicant_id: string;
    request: { product_type: string; as_of: string };
    output: Assessment;
  } | null>;
};

export const NOT_WIRED: AssessmentPort = Object.freeze({
  wired: false,
  assess: () => Promise.resolve(null),
});

export const NOT_WIRED_MESSAGE =
  "Assessments are not wired in this build (SIG-82 candidate 0). The real assessment, assessApplicant on the seeded scenario, arrives in candidate 1; nothing here returns a sample result.";

/** The real composition, on the pre-registered input of the chosen scenario. */
export function wiredPort(
  inputs: ScenarioInputs,
  assess: typeof assessApplicant = assessApplicant,
): AssessmentPort {
  return Object.freeze({
    wired: true,
    async assess(r: AssessRequest) {
      const input = inputs[r.scenario];
      // A fresh copy each run: the stored input is never handed to the engines to hold.
      const output = await assess(JSON.parse(JSON.stringify(input)) as typeof input);
      const { product_type, as_of } = input.request;
      return {
        set_applicant_id: input.applicant_id ?? "",
        request: { product_type, as_of },
        output,
      };
    },
  });
}
