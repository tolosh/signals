// Default ratio thresholds, Product Specification 6.1 and 6.6. A published threshold set is
// immutable: a change is a new version, never an edit to this one.

export type Comparison = "gt" | "gte" | "lt" | "lte";
export type Bound = { op: Comparison; value: number };
export type RatioRule = { amber: Bound; red?: Bound } | null;

export type ThresholdSet = {
  version: number;
  ratios: Record<"dsr" | "ndi" | "lvr" | "benchmark_gle" | "lti" | "dti", RatioRule>;
};

export const DEFAULT_THRESHOLDS: ThresholdSet = Object.freeze({
  version: 1,
  ratios: {
    // Red above 0.70; amber 0.50 to 0.70.
    dsr: { amber: { op: "gte", value: 0.5 }, red: { op: "gt", value: 0.7 } },
    // Red below 1.00; amber 1.00 to 1.25.
    ndi: { amber: { op: "lte", value: 1.25 }, red: { op: "lt", value: 1 } },
    // Amber above 0.70; red above 0.90.
    lvr: { amber: { op: "gt", value: 0.7 }, red: { op: "gt", value: 0.9 } },
    // Amber above 1.00: expenses are below benchmark and the benchmark is being used.
    benchmark_gle: { amber: { op: "gt", value: 1 } },
    // Amber from 3.5; red from 6.0.
    lti: { amber: { op: "gte", value: 3.5 }, red: { op: "gte", value: 6 } },
    dti: { amber: { op: "gte", value: 3.5 }, red: { op: "gte", value: 6 } },
  },
} as const);
