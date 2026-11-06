// Synthetic set v1 (SIG-12 section 4) and the scenario builder later tickets script cases with.
import { EMPLOYERS, GIG_PAYERS } from "./catalog.js";
import { stream } from "./rng.js";
import type { ApplicantSpec, LiabilitySpec, SpecOverrides } from "./types.js";

const DEFAULT_COMMITMENTS: ApplicantSpec["commitments"] = [
  { kind: "telco", cadence: "monthly", amount: 65 },
  { kind: "utilities", cadence: "quarterly", amount: 450 },
  { kind: "insurance", cadence: "annual", amount: 1100 },
];

/** A plain salaried applicant: the starting point every scenario overrides. */
function baseSpec(id: string): ApplicantSpec {
  return {
    id,
    tags: [],
    archetype: "salaried",
    income: {
      cadence: "fortnightly",
      net_per_pay: 3200,
      gross_annual: 112000,
      variability: 0,
      payer: EMPLOYERS[0],
    },
    history_months: 6,
    feed: "cdr",
    coverage: { salary_account_shared: true, unshared_transfer_accounts: 0 },
    expenses: { profile: "typical", rent_monthly: 2400 },
    commitments: DEFAULT_COMMITMENTS.map((c) => ({ ...c })),
    liabilities: [],
    behaviours: {
      gambling_weekly: 0,
      dishonours: 0,
      positive: { rent_on_time: true, cards_cleared_in_full: false, savings_monthly: 0 },
    },
  };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep merge for specs; arrays are replaced, not merged. */
function merge<T>(base: T, over: unknown): T {
  if (!isObject(over) || !isObject(base)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(out[k], v);
  return out as T;
}

/**
 * A single scripted applicant: the base salaried profile with the given overrides. This is the
 * extension point for SIG-39 to SIG-45: a coverage gap, a history length, a statement feed,
 * labelled liabilities and commitments, or positive behaviours are all overrides.
 */
export function scenario(overrides: SpecOverrides, id: string, tags: string[] = []): ApplicantSpec {
  const spec = merge(baseSpec(id), overrides);
  return { ...spec, id, tags: [...(overrides.tags ?? []), ...tags] };
}

/** Synthetic set v1: 200 salaried profiles, then 20 of each listed variant. */
export function population(seed: number): ApplicantSpec[] {
  const specs: ApplicantSpec[] = [];
  let n = 0;
  const next = (tags: string[], build: (rng: ReturnType<typeof stream>) => SpecOverrides) => {
    n += 1;
    const id = `syn-v1-${String(n).padStart(4, "0")}`;
    specs.push(scenario(build(stream(seed, `population:${id}`)), id, tags));
  };

  const salaried = (rng: ReturnType<typeof stream>): SpecOverrides => {
    const cadence = rng.pick(["weekly", "fortnightly", "monthly"] as const);
    const annualNet = rng.int(45, 140) * 1000;
    const perPay = Math.round(annualNet / { weekly: 52, fortnightly: 26, monthly: 12 }[cadence]);
    const liabilities: LiabilitySpec[] = [];
    if (rng.chance(0.4))
      liabilities.push({ type: "credit_card", declared: true, account_shared: rng.chance(0.7) });
    if (rng.chance(0.25))
      liabilities.push({ type: "car_loan", declared: true, account_shared: rng.chance(0.5) });
    if (rng.chance(0.15))
      liabilities.push({ type: "personal_loan", declared: true, account_shared: false });
    return {
      income: {
        cadence,
        net_per_pay: perPay,
        gross_annual: Math.round(annualNet * 1.32),
        variability: 0,
        payer: rng.pick(EMPLOYERS),
      },
      history_months: rng.pick([3, 6, 12] as const),
      expenses: {
        profile: rng.pick(["lean", "typical", "high"] as const),
        rent_monthly: rng.chance(0.6) ? rng.int(14, 32) * 100 : 0,
      },
      liabilities,
      behaviours: {
        positive: {
          rent_on_time: rng.chance(0.8),
          cards_cleared_in_full: rng.chance(0.3),
          savings_monthly: rng.chance(0.4) ? rng.int(2, 10) * 100 : 0,
        },
      },
    };
  };
  const withSalaried =
    (extra: (rng: ReturnType<typeof stream>, base: SpecOverrides) => SpecOverrides) =>
    (rng: ReturnType<typeof stream>) => {
      const base = salaried(rng);
      return merge(base, extra(rng, base));
    };

  for (let i = 0; i < 200; i++) next(["salaried-base"], salaried);
  const variants: [string, (rng: ReturnType<typeof stream>) => SpecOverrides][] = [
    [
      "variable-income",
      withSalaried(() => ({ archetype: "variable", income: { variability: 0.2 } })),
    ],
    [
      "gig",
      withSalaried((rng) => ({
        archetype: "gig",
        income: {
          cadence: "weekly",
          net_per_pay: rng.int(300, 900),
          gross_annual: 0,
          variability: 0.35,
          payer: rng.pick(GIG_PAYERS),
        },
      })),
    ],
    [
      "benefits",
      withSalaried((rng) => ({
        archetype: "benefits",
        income: {
          cadence: "fortnightly",
          net_per_pay: rng.int(700, 1100),
          gross_annual: 0,
          variability: 0,
          payer: "SERVICES AUSTRALIA",
        },
      })),
    ],
    [
      "undisclosed-card",
      withSalaried((rng, base) => ({
        liabilities: [
          ...(base.liabilities ?? []).filter((l) => l?.type !== "credit_card"),
          {
            type: "credit_card",
            declared: false,
            account_shared: rng.chance(0.5),
            limit: rng.int(2, 15) * 1000,
          },
        ],
      })),
    ],
    [
      "bnpl",
      withSalaried((rng, base) => ({
        liabilities: [
          ...(base.liabilities ?? []),
          { type: "bnpl", declared: rng.chance(0.3), account_shared: false },
        ],
      })),
    ],
    [
      "sacc",
      withSalaried((rng, base) => ({
        liabilities: [
          ...(base.liabilities ?? []),
          { type: "sacc", declared: rng.chance(0.2), account_shared: false },
        ],
      })),
    ],
    [
      "wage-advance",
      withSalaried((rng, base) => ({
        liabilities: [
          ...(base.liabilities ?? []),
          { type: "wage_advance", declared: rng.chance(0.1), account_shared: false },
        ],
      })),
    ],
    ["gambling", withSalaried((rng) => ({ behaviours: { gambling_weekly: rng.int(20, 250) } }))],
    [
      "coverage-gap",
      withSalaried((rng) =>
        rng.chance(0.5)
          ? { coverage: { salary_account_shared: false } }
          : { coverage: { unshared_transfer_accounts: rng.int(1, 2) } },
      ),
    ],
  ];
  for (const [tag, build] of variants) for (let i = 0; i < 20; i++) next([tag], build);
  return specs;
}
