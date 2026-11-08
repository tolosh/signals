// Synthetic set v2 (SIG-54): the populations set v1 could not measure, each at a minimum count
// (SIG-54 section 5, the 7 November comment on the request, and the 8 November comment from the
// SIG-18 review). Every applicant is generated at 2.0.0 (a v2 block), with gross as the input
// where there is an employer, and a requested lookback drawn from its own stream, independent of
// the history held.
import {
  EMPLOYER_ALIASES,
  EMPLOYERS,
  GIG_PAYERS,
  NATURAL_NAMES,
  NATURAL_SUFFIX,
  PROVIDERS,
  UNSEEN_PROVIDERS,
} from "./catalog.js";
import { merge, scenario } from "./population.js";
import { stream } from "./rng.js";
import { netFromGross, taxTable } from "./tax.js";
import type { ApplicantSpec, LiabilitySpec, LiabilityType, SpecOverrides } from "./types.js";

/** Set v2's seed. Set v1 keeps 42. */
export const SET_V2_SEED = 54;
const TAX_YEAR = "2026-27";

/** Minimum count per tag. The manifest records the final counts. */
export const SET_V2_MINIMUMS: Readonly<Record<string, number>> = Object.freeze({
  salaried: 200,
  "salaried-irregular": 100,
  "salaried-payer-drift": 40,
  "salaried-fixed": 1,
  "variable-income": 60,
  gig: 60,
  "dishonour-one-recent": 20,
  "dishonour-two-plus-recent": 20,
  "dishonour-old-only": 20,
  "dishonour-clean": 20,
  "statement-feed": 40,
  "history-1-month": 20,
  mortgage: 40,
  "mortgage-undisclosed": 1,
  benefits: 20,
  "undisclosed-card": 20,
  bnpl: 20,
  sacc: 20,
  "wage-advance": 20,
  gambling: 20,
  "coverage-gap": 20,
  "undisclosed-personal-loan": 20,
  "undisclosed-car-loan": 20,
  "repaid-from-unshared": 20,
  "natural-declarations": 20,
  "unseen-lenders": 20,
  "reference-noise": 20,
  "no-card-biller-cue": 20,
});

type R = ReturnType<typeof stream>;
const PAYS = { weekly: 52, fortnightly: 26, monthly: 12 } as const;
const natural = (type: LiabilityType, provider: string) =>
  `${NATURAL_NAMES[provider] ?? provider}${NATURAL_SUFFIX[type] ?? ""}`;
/** Net per pay for a gross salary, through the generator's tax table. */
const netPerPay = (gross: number, cadence: keyof typeof PAYS) =>
  Math.round((netFromGross(gross, taxTable(TAX_YEAR)).net_annual / PAYS[cadence]) * 100) / 100;
/** `count` distinct days before as-of, drawn from [from, to]. */
const daysAgo = (rng: R, count: number, from: number, to: number) => {
  const out = new Set<number>();
  while (out.size < count) out.add(rng.int(from, to));
  return [...out].sort((a, b) => a - b);
};
const liabilitiesOf = (b: SpecOverrides) => (b.liabilities ?? []) as LiabilitySpec[];

/** A salaried applicant with gross as the input: the base every v2 group builds on. */
function salaried(rng: R): SpecOverrides {
  const cadence = rng.pick(["weekly", "fortnightly", "monthly"] as const);
  const liabilities: LiabilitySpec[] = [];
  if (rng.chance(0.4))
    liabilities.push({ type: "credit_card", declared: true, account_shared: rng.chance(0.7) });
  if (rng.chance(0.25))
    liabilities.push({ type: "car_loan", declared: true, account_shared: rng.chance(0.5) });
  if (rng.chance(0.15))
    liabilities.push({ type: "personal_loan", declared: true, account_shared: false });
  // BPAY bills to utilities, insurers and councils (SIG-17, ENR-28).
  const commitments: ApplicantSpec["commitments"] = [
    { kind: "telco", cadence: "monthly", amount: 65 },
    { kind: "utilities", cadence: "quarterly", amount: rng.int(30, 70) * 10 },
    { kind: "insurance", cadence: "annual", amount: rng.int(80, 160) * 10 },
  ];
  if (rng.chance(0.4))
    commitments.push({ kind: "council_rates", cadence: "quarterly", amount: rng.int(40, 80) * 10 });
  if (rng.chance(0.3))
    commitments.push({
      kind: "car_registration",
      cadence: "annual",
      amount: rng.int(70, 95) * 10,
    });
  const gross = rng.int(55, 200) * 1000;
  return {
    income: {
      cadence,
      net_per_pay: netPerPay(gross, cadence),
      gross_annual: gross,
      variability: 0,
      payer: rng.pick(EMPLOYERS),
    },
    history_months: rng.pick([3, 6, 12] as const),
    expenses: {
      profile: rng.pick(["lean", "typical", "high"] as const),
      rent_monthly: rng.chance(0.6) ? rng.int(14, 32) * 100 : 0,
    },
    commitments,
    liabilities,
    behaviours: {
      positive: {
        rent_on_time: rng.chance(0.8),
        cards_cleared_in_full: rng.chance(0.3),
        savings_monthly: rng.chance(0.4) ? rng.int(2, 10) * 100 : 0,
      },
    },
    v2: { requested_lookback: 6, gross_primary: true, tax_year: TAX_YEAR },
  };
}

export function populationV2(seed: number): ApplicantSpec[] {
  const specs: ApplicantSpec[] = [];
  let n = 0;
  /** Adds `count` applicants: the salaried base merged with `extra` (arrays replace). */
  const group = (
    tags: string[],
    count: number,
    extra: (rng: R, base: SpecOverrides, i: number) => SpecOverrides = () => ({}),
  ) => {
    for (let i = 0; i < count; i++) {
      n += 1;
      const id = `syn-v2-${String(n).padStart(4, "0")}`;
      const rng = stream(seed, `population-v2:${id}`);
      const base = salaried(rng);
      const over = merge(base, extra(rng, base, i));
      // The lender's request: its own stream, never derived from the history (SIG-39 ruling).
      const requested_lookback = stream(seed, `request:${id}`).pick([3, 6, 6, 6, 12] as const);
      specs.push(scenario(merge(over, { v2: { requested_lookback } }), id, tags));
    }
  };
  const changeAt = (rng: R, base: SpecOverrides, payer?: string): SpecOverrides => {
    const cadence = base.income?.cadence ?? "fortnightly";
    const gross = (base.income?.gross_annual ?? 0) * (1 + rng.int(5, 15) / 100);
    return {
      history_months: rng.pick([6, 12] as const),
      v2: {
        pay: {
          change: {
            after_days: rng.int(45, 150),
            net_per_pay: netPerPay(Math.round(gross), cadence),
            ...(payer ? { payer } : {}),
          },
        },
      },
    };
  };

  // Salaried, 200: a fixed-pay control, irregular pay (at least 100), payer drift (at least 40).
  group(["salaried", "salaried-fixed"], 60);
  group(["salaried", "salaried-irregular", "overtime"], 34, (rng) => ({
    v2: { pay: { overtime: { share: rng.int(3, 7) / 10, amount: rng.int(15, 60) * 10 } } },
  }));
  group(["salaried", "salaried-irregular", "bonus"], 33, (rng) => ({
    v2: { pay: { bonus: { amount: rng.int(10, 80) * 100 } } },
  }));
  group(["salaried", "salaried-irregular", "pay-rise"], 17, (rng, base) => changeAt(rng, base));
  group(["salaried", "salaried-irregular", "new-employer"], 16, (rng, base) =>
    changeAt(rng, base, rng.pick(EMPLOYERS.filter((e) => e !== base.income?.payer))),
  );
  for (const mode of ["over_time", "across_banks"] as const)
    group(
      [
        "salaried",
        "salaried-payer-drift",
        mode === "over_time" ? "drift-over-time" : "drift-across-banks",
      ],
      20,
      (_rng, base) => ({
        v2: {
          payer_drift: { mode, alias: EMPLOYER_ALIASES[base.income?.payer ?? ""] ?? "PAYROLL" },
        },
      }),
    );

  // Variable income and gig, 60 each (SIG-16). Gig earners have no employer gross.
  group(["variable-income"], 60, () => ({ archetype: "variable", income: { variability: 0.2 } }));
  group(["gig"], 60, (rng) => ({
    archetype: "gig",
    income: {
      cadence: "weekly",
      net_per_pay: rng.int(300, 900),
      gross_annual: 0,
      variability: 0.35,
      payer: rng.pick(GIG_PAYERS),
    },
    v2: { gross_primary: false },
  }));

  // Dishonours, four tagged groups (SIG-13).
  group(["dishonour-one-recent"], 20, (rng) => ({
    v2: { dishonours: { days_ago: daysAgo(rng, 1, 1, 90) } },
  }));
  group(["dishonour-two-plus-recent"], 20, (rng) => ({
    v2: { dishonours: { days_ago: daysAgo(rng, rng.int(2, 4), 1, 90) } },
  }));
  group(["dishonour-old-only"], 20, (rng) => {
    const months = rng.pick([6, 12] as const);
    return {
      history_months: months,
      v2: { dishonours: { days_ago: daysAgo(rng, rng.int(1, 3), 91, months * 30 - 5) } },
    };
  });
  group(["dishonour-clean"], 20, () => ({ v2: { dishonours: { days_ago: [] } } }));

  // Statement feeds, 1-month histories and mortgage holders (SIG-12).
  group(["statement-feed"], 40, () => ({ feed: "uploaded_statement" }));
  group(["history-1-month"], 20, () => ({ history_months: 1 }));
  group(["mortgage"], 40, (rng, base, i) => {
    const purpose = rng.pick(["owner_occupier", "investor"] as const);
    const declared = i >= 10;
    return {
      tags: declared ? [] : ["mortgage-undisclosed"],
      ...(purpose === "owner_occupier" ? { expenses: { rent_monthly: 0 } } : {}),
      liabilities: [
        ...liabilitiesOf(base),
        {
          type: "mortgage",
          declared,
          account_shared: rng.chance(0.5),
          balance: rng.int(150, 900) * 1000,
          repayment: rng.int(15, 55) * 100,
          mortgage: { purpose, feature: rng.pick(["offset", "redraw", "none"] as const) },
        },
      ],
    };
  });

  // The v1 variant groups, 20 each.
  group(["benefits"], 20, (rng) => ({
    archetype: "benefits",
    income: {
      cadence: "fortnightly",
      net_per_pay: rng.int(700, 1100),
      gross_annual: 0,
      payer: "SERVICES AUSTRALIA",
    },
    v2: { gross_primary: false },
  }));
  group(["undisclosed-card"], 20, (rng, base) => ({
    liabilities: [
      ...liabilitiesOf(base).filter((l) => l.type !== "credit_card"),
      {
        type: "credit_card",
        declared: false,
        account_shared: rng.chance(0.5),
        limit: rng.int(2, 15) * 1000,
      },
    ],
  }));
  for (const [tag, type, p] of [
    ["bnpl", "bnpl", 0.3],
    ["sacc", "sacc", 0.2],
    ["wage-advance", "wage_advance", 0.1],
  ] as const)
    group([tag], 20, (rng, base) => ({
      liabilities: [
        ...liabilitiesOf(base),
        { type, declared: rng.chance(p), account_shared: false },
      ],
    }));
  group(["gambling"], 20, (rng) => ({ behaviours: { gambling_weekly: rng.int(20, 250) } }));
  group(["coverage-gap"], 20, (rng) =>
    rng.chance(0.5)
      ? { coverage: { salary_account_shared: false } }
      : { coverage: { unshared_transfer_accounts: rng.int(1, 2) } },
  );

  // H2 groups (SIG-18 review, 8 November 2026).
  for (const [tag, type] of [
    ["undisclosed-personal-loan", "personal_loan"],
    ["undisclosed-car-loan", "car_loan"],
  ] as const)
    group([tag], 20, (_rng, base, i) => ({
      tags: [i < 10 ? "account-in-grant" : "account-not-in-grant"],
      liabilities: [
        ...liabilitiesOf(base).filter((l) => l.type !== type),
        { type, declared: false, account_shared: i < 10 },
      ],
    }));
  group(["repaid-from-unshared"], 20, (rng, base) => {
    const type = rng.pick(["personal_loan", "bnpl", "sacc"] as const);
    return {
      liabilities: [
        ...liabilitiesOf(base).filter((l) => l.type !== type),
        { type, declared: rng.chance(0.3), account_shared: false, paid_from_unshared: true },
      ],
    };
  });
  group(["natural-declarations"], 20, (rng, base) => {
    const second = rng.pick(["car_loan", "bnpl", "personal_loan"] as const);
    const own = liabilitiesOf(base).filter((l) => l.type !== "credit_card" && l.type !== second);
    const declared: LiabilitySpec[] = [
      { type: "credit_card", declared: true, account_shared: rng.chance(0.5) },
      { type: second, declared: true, account_shared: false },
    ];
    return {
      liabilities: [...own, ...declared].map((l) => {
        const provider = l.provider ?? rng.pick(PROVIDERS[l.type] ?? ["LENDER"]);
        return {
          ...l,
          provider,
          ...(l.declared !== false ? { declared_as: natural(l.type, provider) } : {}),
        };
      }),
    };
  });
  group(["unseen-lenders"], 20, (rng, base) => {
    const type = rng.pick([
      "credit_card",
      "personal_loan",
      "car_loan",
      "bnpl",
      "sacc",
      "wage_advance",
    ] as const);
    const provider = rng.pick(UNSEEN_PROVIDERS[type] ?? ["LENDER"]);
    const declared = rng.chance(0.3);
    return {
      liabilities: [
        ...liabilitiesOf(base).filter((l) => l.type !== type),
        {
          type,
          provider,
          declared,
          account_shared: type === "credit_card" ? rng.chance(0.5) : false,
          unseen_lender: true,
          ...(declared ? { declared_as: natural(type, provider) } : {}),
        },
      ],
    };
  });
  group(["reference-noise"], 20, (rng, base) => {
    const type = rng.pick(["bnpl", "personal_loan", "car_loan", "sacc"] as const);
    return {
      liabilities: [
        ...liabilitiesOf(base).filter((l) => l.type !== type),
        { type, declared: false, account_shared: false, narrative_ref: true },
      ],
    };
  });
  group(["no-card-biller-cue"], 20, (rng, base) => ({
    liabilities: [
      ...liabilitiesOf(base).filter((l) => l.type !== "credit_card"),
      {
        type: "credit_card",
        declared: false,
        account_shared: false,
        biller_cue: false,
        limit: rng.int(2, 15) * 1000,
      },
    ],
  }));
  return specs;
}
