// SIG-82 (40782; SIG-76 40738 and 40745, 1): the demo's seeded workspaces, product and policy.
// The lender UI has no rate field, so the 11.5% product rate, the AF-T1 policy and the observed
// expense method come from here, as SIG-76's pre-registration records the request. Synthetic data
// only: the workspaces are labelled demo, and their credits are seeded so the app is never stuck
// behind checkout (billing is out of scope, 40775).
import type { WorkspaceKey } from "./config.js";

export type DemoWorkspace = { id: string; name: string; credits: number };
export const DEMO_WORKSPACES: Readonly<Record<WorkspaceKey, DemoWorkspace>> = Object.freeze({
  A: { id: "wks_demo_a", name: "Demo Lender A (synthetic data)", credits: 100 },
  B: { id: "wks_demo_b", name: "Demo Lender B (synthetic data)", credits: 100 },
});

/** INC's default shading (SIG-76.json's request). */
export const DEMO_SHADING: Readonly<Record<string, number>> = Object.freeze({
  salary: 1,
  overtime_bonus: 0.8,
  commission: 0.8,
  rental: 0.8,
  gig_platform: 0.8,
  government_benefit: 0,
  other: 1,
});

/** The product every demo assessment is run on: SIG-76's request, the same for every scenario. */
export const DEMO_PRODUCT = Object.freeze({
  product_type: "personal" as const,
  product_rate_pct: 11.5,
  policy: "AF-T1" as const,
  policy_detail: Object.freeze({
    buffer_pct: 3,
    floor_rate_pct: 5.5,
    card_commitment_factor: 0.03,
    shading: DEMO_SHADING,
    expense_method: "observed" as const,
  }),
  lookback_months: 6,
});

/** The policy as the contract's Policy shows it (6.6), for every product of a demo workspace. */
export const demoPolicy = (product: string) => ({
  product,
  version: 1,
  buffer: DEMO_PRODUCT.policy_detail.buffer_pct,
  floor_rate: DEMO_PRODUCT.policy_detail.floor_rate_pct,
  income_shading: { ...DEMO_SHADING },
  card_factor: DEMO_PRODUCT.policy_detail.card_commitment_factor,
  expense_method: DEMO_PRODUCT.policy_detail.expense_method,
  // The default thresholds (Product Specification 6.1), as the engine applies them.
  ratio_thresholds: {
    dsr: { amber: 0.5, red: 0.7 },
    ndi: { amber: 1.25, red: 1 },
    lvr: { amber: 0.7, red: 0.9 },
    benchmark_gle: { amber: 1 },
    lti: { amber: 3.5, red: 6 },
    dti: { amber: 3.5, red: 6 },
  },
  expense_method_options: [
    {
      key: "observed",
      label: "Observed in the bank data",
      description: "Committed plus basic spending observed in the shared accounts (AF-E1, AF-E2)",
      requires: ["observed_expenses"],
      available: true,
      unavailable_reason: null,
    },
  ],
});

/**
 * The scenarios the sandbox consent offers: SIG-76's pre-registered applicants (set v2.3), shown
 * by their pre-registered story only. Choosing one selects that seeded feed; nothing else.
 */
export const SANDBOX_SCENARIOS: readonly { key: "A" | "B" | "C" | "D" | "D2"; story: string }[] =
  Object.freeze([
    { key: "A", story: "Regular salary, affordable, one declared loan" },
    { key: "B", story: "A hidden credit liability and affordability pressure" },
    { key: "C", story: "Missing income: the salary account is not shared" },
    { key: "D", story: "An undisclosed wage advance from a lender outside the engine's list" },
    { key: "D2", story: "An undisclosed BNPL liability" },
  ]);
export type ScenarioKey = (typeof SANDBOX_SCENARIOS)[number]["key"];
