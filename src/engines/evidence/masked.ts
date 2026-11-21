// SIG-64: every text a signal shows a lender goes through the shared masker (D29;
// display-mask.ts): the value, the reason, and the evidence layer's review reason and
// resolve-with list. States, figures, counts and evidence are untouched. Pure (D3).
import { maskText } from "../display-mask.js";
import type { Signal } from "./types.js";

export function maskSignal(s: Signal): Signal {
  const eq = s.evidence_quality;
  return {
    ...s,
    value: s.value === null ? null : maskText(s.value),
    reason: maskText(s.reason),
    evidence_quality: {
      ...eq,
      resolve_with: eq.resolve_with.map(maskText),
      review_reason: eq.review_reason === null ? null : maskText(eq.review_reason),
    },
  };
}
