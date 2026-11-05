// Synthetic applicant generator (SIG-12): one ApplicantSpec and a seed in, openfeed-shaped feed
// data and a ground-truth file out. Deterministic: no clock, and every draw is from a named stream.
import {
  BILLERS,
  DINING,
  EMPLOYERS,
  FUEL,
  GAMBLING,
  GROCERY,
  PROVIDERS,
  STATES,
  SUBSCRIPTIONS,
  SUBURBS,
  TELCO,
  type Merchant,
} from "./catalog.js";
import { stream, type Rng } from "./rng.js";
import {
  AS_OF_DATE,
  GENERATOR_VERSION,
  GROUND_TRUTH_SCHEMA_VERSION,
  type ApplicantSpec,
  type Cadence,
  type FeedAccount,
  type GeneratedApplicant,
  type GroundTruth,
  type LiabilitySpec,
  type LiabilityType,
  type Transaction,
} from "./types.js";

const MONTHLY_FACTOR: Record<Cadence, number> = {
  weekly: 52 / 12,
  fortnightly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
};
const PROFILE = { lean: 0.75, typical: 1, high: 1.4 } as const;
const round2 = (n: number) => Math.round(n * 100) / 100;
const toCents = (dollars: number) => Math.round(dollars * 100);
const money = (cents: number) => {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
};

// --- dates, in whole UTC days -------------------------------------------------------------
const DAY = 86_400_000;
const toDay = (iso: string) =>
  Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY;
const toIso = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
const ymd = (day: number) => {
  const d = new Date(day * DAY);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
};

function window(months: number) {
  const end = toDay(AS_OF_DATE);
  const { y, m, d } = ymd(end);
  const start = Date.UTC(y, m - months, d) / DAY + 1;
  return { start, end };
}

/** Days on which an item with this cadence falls inside the window. */
function schedule(rng: Rng, cadence: Cadence, start: number, end: number): number[] {
  const days: number[] = [];
  if (cadence === "weekly" || cadence === "fortnightly") {
    const step = cadence === "weekly" ? 7 : 14;
    for (let day = start + rng.int(0, step - 1); day <= end; day += step) days.push(day);
    return days;
  }
  const dom = rng.int(1, 28);
  const every = cadence === "monthly" ? 1 : cadence === "quarterly" ? 3 : 12;
  const anchor = rng.int(0, every - 1);
  const first = ymd(start);
  for (let i = -1; i <= 13; i++) {
    const monthIndex = first.y * 12 + first.m + i;
    if (((monthIndex % every) + every) % every !== anchor) continue;
    const day = Date.UTC(Math.floor(monthIndex / 12), monthIndex % 12, dom) / DAY;
    if (day >= start && day <= end) days.push(day);
  }
  return days;
}

// --- ledger ----------------------------------------------------------------------------------
type Entry = {
  account: string;
  day: number;
  cents: number;
  type: Transaction["type"];
  description: string;
  reference?: string;
  merchant?: Merchant;
  biller?: { name: string; code: string };
};

type Account = {
  id: string;
  shared: boolean;
  category: string;
  product: string;
  display: string;
  openingCents: number;
  limitCents?: number;
};

const LIABILITY_DEFAULTS: Record<
  LiabilityType,
  Required<Omit<LiabilitySpec, "type" | "provider" | "declared" | "account_shared">>
> = {
  credit_card: { limit: 6000, balance: 2400, repayment: 180, cadence: "monthly" },
  personal_loan: { limit: 0, balance: 15000, repayment: 450, cadence: "monthly" },
  car_loan: { limit: 0, balance: 25000, repayment: 260, cadence: "fortnightly" },
  mortgage: { limit: 0, balance: 450000, repayment: 2600, cadence: "monthly" },
  bnpl: { limit: 1000, balance: 320, repayment: 60, cadence: "fortnightly" },
  sacc: { limit: 0, balance: 600, repayment: 95, cadence: "fortnightly" },
  wage_advance: { limit: 0, balance: 150, repayment: 150, cadence: "fortnightly" },
};

export function generateApplicant(spec: ApplicantSpec, seed: number): GeneratedApplicant {
  const id = spec.id;
  const r = (key: string) => stream(seed, `${id}:${key}`);
  const { start, end } = window(spec.history_months);
  const entries: Entry[] = [];
  const add = (e: Entry) => entries.push(e);
  const cdr = spec.feed === "cdr";
  const suburb = r("suburb").pick(SUBURBS);
  const pos = (m: Merchant, store: number) =>
    `${m.descriptor} ${store} ${suburb} ${STATES[suburb]} AUS`;

  // Accounts. The everyday account is always shared.
  const everyday = `${id}-evd`;
  const accounts: Account[] = [
    {
      id: everyday,
      shared: true,
      category: "TRANS_AND_SAVINGS_ACCOUNTS",
      product: "Everyday Account",
      display: "Everyday",
      openingCents: toCents(r("open").int(800, 4000)),
    },
  ];
  let incomeAccount = everyday;
  if (!spec.coverage.salary_account_shared) {
    incomeAccount = `${id}-sal`;
    accounts.push({
      id: incomeAccount,
      shared: false,
      category: "TRANS_AND_SAVINGS_ACCOUNTS",
      product: "Salary Account",
      display: "Salary",
      openingCents: 50_000,
    });
  }
  const savingsMonthly = spec.behaviours.positive.savings_monthly;
  const savingsAccount = `${id}-sav`;
  if (savingsMonthly > 0) {
    accounts.push({
      id: savingsAccount,
      shared: true,
      category: "TRANS_AND_SAVINGS_ACCOUNTS",
      product: "Online Saver",
      display: "Savings",
      openingCents: toCents(r("savings-open").int(1000, 20000)),
    });
  }
  const external = Array.from({ length: spec.coverage.unshared_transfer_accounts }, (_, i) => {
    const acc: Account = {
      id: `${id}-ext${i + 1}`,
      shared: false,
      category: "TRANS_AND_SAVINGS_ACCOUNTS",
      product: "Other Bank Account",
      display: `External ${i + 1}`,
      openingCents: 0,
    };
    accounts.push(acc);
    return acc;
  });

  // Income.
  const typeOf = {
    salaried: "salary",
    variable: "variable",
    gig: "gig",
    benefits: "benefit",
  } as const;
  const streamType = typeOf[spec.archetype];
  const payDays = schedule(r("pay"), spec.income.cadence, start, end);
  const sweepNumber = `${r("sweep").int(10, 99)}${r("sweep-number").int(1000, 9999)}`;
  const payRng = r("pay-amount");
  for (const day of payDays) {
    const cents = toCents(payRng.jitter(spec.income.net_per_pay, spec.income.variability));
    const description =
      streamType === "benefit"
        ? "SERVICES AUSTRALIA CENTRELINK"
        : streamType === "gig"
          ? `${spec.income.payer} PAYOUT`
          : `SALARY ${spec.income.payer}`;
    add({
      account: incomeAccount,
      day,
      cents,
      type: "TRANSFER_INCOMING",
      description,
      reference: `PAY ${toIso(day)}`,
    });
    // An unshared salary account sweeps to the everyday account the next day. The lender sees
    // only an own-account transfer, identified by BSB and number, never the word salary.
    if (incomeAccount !== everyday && day + 1 <= end) {
      const moved = Math.round(cents * 0.9);
      add({
        account: incomeAccount,
        day: day + 1,
        cents: -moved,
        type: "TRANSFER_OUTGOING",
        description: "TRANSFER TO EVERYDAY ACCOUNT",
        reference: "SWEEP",
      });
      add({
        account: everyday,
        day: day + 1,
        cents: moved,
        type: "TRANSFER_INCOMING",
        description: `TRANSFER FROM 062-000 ${sweepNumber}`,
        reference: "SWEEP",
      });
    }
  }

  // Expenses. Monthly equivalents are expected values: mean amount x cadence factor.
  const scale = PROFILE[spec.expenses.profile];
  const items: GroundTruth["expenses"]["items"] = [];
  const spend = (
    name: string,
    group: "committed" | "basic" | "discretionary",
    cadence: Cadence,
    mean: number,
    emit: (day: number, cents: number, rng: Rng) => void,
    spread = 0.25,
  ) => {
    items.push({
      name,
      group,
      cadence,
      monthly_equivalent: round2(mean * MONTHLY_FACTOR[cadence]),
    });
    const rng = r(`spend:${name}`);
    for (const day of schedule(rng, cadence, start, end))
      emit(day, -toCents(rng.jitter(mean, spread)), rng);
  };
  const card = spec.liabilities.find((l) => l.type === "credit_card");
  const cardShared = card?.account_shared ?? false;
  const cardAccount = `${id}-ccd`;
  const shop =
    (list: Merchant[], account = everyday) =>
    (day: number, cents: number, rng: Rng) => {
      const m = rng.pick(list);
      add({
        account,
        day,
        cents,
        type: "PAYMENT",
        description: pos(m, rng.int(1000, 9999)),
        merchant: m,
      });
    };

  spend("groceries", "basic", "weekly", 180 * scale, shop(GROCERY));
  spend("fuel", "basic", "fortnightly", 75 * scale, shop(FUEL));
  spend(
    "dining",
    "discretionary",
    "weekly",
    45 * scale,
    shop(DINING, cardShared ? cardAccount : everyday),
  );
  for (const s of SUBSCRIPTIONS) {
    const mean = s.name === "Netflix" ? 18.99 : 13.99;
    spend(
      `subscription:${s.name}`,
      "discretionary",
      "monthly",
      mean,
      (day, cents) =>
        add({
          account: everyday,
          day,
          cents,
          type: "PAYMENT",
          description: `${s.descriptor} SYDNEY AUS`,
          merchant: s,
        }),
      0,
    );
  }
  if (spec.expenses.rent_monthly > 0) {
    const onTime = spec.behaviours.positive.rent_on_time;
    const agent = r("agent").pick(["RAY WHITE", "LJ HOOKER", "BELLE PROPERTY"]);
    spend(
      "rent",
      "committed",
      "monthly",
      spec.expenses.rent_monthly,
      (day, cents, rng) => {
        const late = onTime ? 0 : rng.int(0, 9);
        add({
          account: everyday,
          day: Math.min(day + late, end),
          cents,
          type: "PAYMENT",
          description: `RENT ${agent} REAL ESTATE`,
          reference: "RENT",
        });
      },
      0,
    );
  }
  if (spec.behaviours.gambling_weekly > 0) {
    spend(
      "gambling",
      "discretionary",
      "weekly",
      spec.behaviours.gambling_weekly,
      shop(GAMBLING),
      0.5,
    );
  }

  // Commitments, including quarterly and annual items.
  const commitments: GroundTruth["commitments"] = spec.commitments.map((c) => {
    const rng = r(`commitment:${c.kind}`);
    const days = schedule(rng, c.cadence, start, end);
    const telco = c.kind === "telco" ? rng.pick(TELCO) : undefined;
    const biller = BILLERS[c.kind];
    for (const day of days) {
      if (telco)
        add({
          account: everyday,
          day,
          cents: -toCents(c.amount),
          type: "PAYMENT",
          description: `${telco.descriptor} ${suburb} AUS`,
          merchant: telco,
        });
      else if (biller)
        add({
          account: everyday,
          day,
          cents: -toCents(c.amount),
          type: "PAYMENT",
          description: `BPAY ${biller.name}`,
          biller,
        });
      else
        add({
          account: everyday,
          day,
          cents: -toCents(c.amount),
          type: "DIRECT_DEBIT",
          description: c.kind.toUpperCase().replaceAll("_", " "),
        });
    }
    items.push({
      name: `commitment:${c.kind}`,
      group: "committed",
      cadence: c.cadence,
      monthly_equivalent: round2(c.amount * MONTHLY_FACTOR[c.cadence]),
    });
    return {
      kind: c.kind,
      cadence: c.cadence,
      amount: c.amount,
      monthly_equivalent: round2(c.amount * MONTHLY_FACTOR[c.cadence]),
      occurrences_in_window: days.length,
      account_id: everyday,
    };
  });

  // Liabilities.
  const cleared = spec.behaviours.positive.cards_cleared_in_full;
  const liabilityItems: GroundTruth["liabilities"]["items"] = spec.liabilities.map((l, i) => {
    const d = LIABILITY_DEFAULTS[l.type];
    const provider = l.provider ?? r(`provider:${i}`).pick(PROVIDERS[l.type] ?? ["LENDER"]);
    const limit = l.limit ?? (d.limit || null);
    const balance = l.balance ?? d.balance;
    const repayment =
      l.type === "credit_card"
        ? (l.repayment ?? Math.max(d.repayment, 0.03 * (limit ?? 0)))
        : (l.repayment ?? d.repayment);
    const cadence: Cadence =
      l.type === "wage_advance" ? spec.income.cadence : (l.cadence ?? d.cadence);
    const shared = l.account_shared ?? false;
    const loanAccount = `${id}-l${i + 1}`;
    if (shared) {
      accounts.push({
        id: l.type === "credit_card" ? cardAccount : loanAccount,
        shared: true,
        category:
          l.type === "credit_card"
            ? "CRED_AND_CHRG_CARDS"
            : l.type === "mortgage"
              ? "RESIDENTIAL_MORTGAGES"
              : "PERS_LOANS",
        product:
          l.type === "credit_card"
            ? `${provider} Credit Card`
            : `${provider} ${l.type.replace("_", " ")}`,
        display: l.type,
        openingCents: -toCents(balance),
        ...(limit ? { limitCents: toCents(limit) } : {}),
      });
    }
    const rng = r(`liability:${i}`);
    const days = l.type === "wage_advance" ? payDays : schedule(rng, cadence, start, end);
    for (const day of days) {
      const cents = toCents(repayment);
      if (l.type === "credit_card") {
        const b = BILLERS.credit_card ?? { name: "CREDIT CARD PAYMENT", code: "613711" };
        add({
          account: everyday,
          day,
          cents: -cents,
          type: "PAYMENT",
          description: `BPAY ${provider} CREDIT CARD PAYMENT`,
          biller: { name: `${provider} ${b.name}`, code: b.code },
        });
        if (shared)
          add({
            account: cardAccount,
            day,
            cents,
            type: "TRANSFER_INCOMING",
            description: "PAYMENT RECEIVED THANK YOU",
          });
      } else if (l.type === "bnpl") {
        add({
          account: everyday,
          day,
          cents: -cents,
          type: "DIRECT_DEBIT",
          description: `${provider} INSTALMENT`,
        });
      } else if (l.type === "wage_advance") {
        add({
          account: everyday,
          day: Math.max(day - 3, start),
          cents,
          type: "TRANSFER_INCOMING",
          description: `${provider} ADVANCE`,
        });
        add({
          account: everyday,
          day,
          cents: -cents,
          type: "DIRECT_DEBIT",
          description: `${provider} REPAYMENT`,
        });
      } else {
        add({
          account: everyday,
          day,
          cents: -cents,
          type: "DIRECT_DEBIT",
          description: `${provider} LOAN REPAYMENT`,
        });
        if (shared)
          add({
            account: loanAccount,
            day,
            cents,
            type: "TRANSFER_INCOMING",
            description: "REPAYMENT RECEIVED",
          });
      }
    }
    if (l.type === "sacc") {
      add({
        account: everyday,
        day: start + rng.int(0, 10),
        cents: toCents(800),
        type: "TRANSFER_INCOMING",
        description: `${provider} LOAN ADVANCE`,
      });
    }
    const revolvingCleared = l.type === "credit_card" && cleared;
    return {
      id: `liab-${i + 1}`,
      type: l.type,
      provider,
      declared: l.declared ?? true,
      account_shared: shared,
      limit,
      balance: revolvingCleared ? 0 : balance,
      repayment: round2(repayment),
      cadence,
      monthly_commitment: revolvingCleared ? 0 : round2(repayment * MONTHLY_FACTOR[cadence]),
    };
  });

  // Savings and transfers to accounts that are not shared.
  let transfersToUnshared = 0;
  if (savingsMonthly > 0) {
    for (const day of schedule(r("savings"), "monthly", start, end)) {
      add({
        account: everyday,
        day,
        cents: -toCents(savingsMonthly),
        type: "TRANSFER_OUTGOING",
        description: "INTERNET TRANSFER SAVINGS",
      });
      add({
        account: savingsAccount,
        day,
        cents: toCents(savingsMonthly),
        type: "TRANSFER_INCOMING",
        description: "INTERNET TRANSFER FROM EVERYDAY",
      });
    }
  }
  for (const acc of external) {
    const rng = r(`external:${acc.id}`);
    const number = `${rng.int(10, 99)}${rng.int(1000, 9999)}`;
    for (const day of schedule(rng, "monthly", start, end)) {
      add({
        account: everyday,
        day,
        cents: -toCents(rng.int(200, 600)),
        type: "TRANSFER_OUTGOING",
        description: `TRANSFER TO 062-000 ${number}`,
      });
      transfersToUnshared++;
    }
  }

  // Dishonours.
  const dishonourRng = r("dishonours");
  for (let i = 0; i < spec.behaviours.dishonours; i++) {
    add({
      account: everyday,
      day: start + dishonourRng.int(0, end - start),
      cents: -1500,
      type: "FEE",
      description: "DISHONOUR FEE",
    });
  }

  // Ground truth.
  const streamMonthly = round2(spec.income.net_per_pay * MONTHLY_FACTOR[spec.income.cadence]);
  const group = (g: "committed" | "basic" | "discretionary") =>
    round2(items.filter((i) => i.group === g).reduce((s, i) => s + i.monthly_equivalent, 0));
  const committed = group("committed");
  const basic = group("basic");
  const discretionary = group("discretionary");
  const total = round2(committed + basic + discretionary);
  const repayments = round2(liabilityItems.reduce((s, l) => s + l.monthly_commitment, 0));
  const gambling = items.find((i) => i.name === "gambling");

  const truth: GroundTruth = {
    schema_version: GROUND_TRUTH_SCHEMA_VERSION,
    generator_version: GENERATOR_VERSION,
    applicant_id: id,
    seed,
    tags: [...spec.tags],
    archetype: spec.archetype,
    feed_type: spec.feed,
    history: { months: spec.history_months, start_date: toIso(start), end_date: toIso(end) },
    coverage: {
      salary_account_shared: spec.coverage.salary_account_shared,
      unshared_transfer_accounts: spec.coverage.unshared_transfer_accounts,
      transfers_to_unshared_count: transfersToUnshared,
      shared_account_ids: accounts.filter((a) => a.shared).map((a) => a.id),
      unshared_account_ids: accounts.filter((a) => !a.shared).map((a) => a.id),
    },
    income: {
      net_monthly: streamMonthly,
      gross_annual: spec.income.gross_annual,
      streams: [
        {
          type: streamType,
          payer: spec.income.payer,
          cadence: spec.income.cadence,
          net_per_pay: spec.income.net_per_pay,
          variability: spec.income.variability,
          net_monthly: streamMonthly,
          account_id: incomeAccount,
          account_shared: incomeAccount === everyday,
        },
      ],
    },
    expenses: {
      committed_monthly: committed,
      basic_monthly: basic,
      discretionary_monthly: discretionary,
      total_monthly: total,
      items,
    },
    commitments,
    liabilities: { repayments_monthly: repayments, items: liabilityItems },
    behaviours: {
      gambling_monthly: gambling ? gambling.monthly_equivalent : null,
      dishonours: spec.behaviours.dishonours,
      positive: {
        rent_on_time: spec.expenses.rent_monthly > 0 && spec.behaviours.positive.rent_on_time,
        cards_cleared_in_full: cleared,
        savings_growing: savingsMonthly > 0,
        savings_monthly: savingsMonthly,
        no_dishonours: spec.behaviours.dishonours === 0,
      },
    },
    surplus_monthly: round2(streamMonthly - total - repayments),
  };

  return {
    truth,
    application: {
      stated_gross_annual: spec.income.gross_annual,
      declared_liabilities: liabilityItems
        .filter((l) => l.declared)
        .map((l) => ({
          type: l.type,
          provider: l.provider,
          repayment_monthly: l.monthly_commitment,
        })),
    },
    feed: buildFeed(
      accounts.filter((a) => a.shared),
      entries,
      cdr,
      r("feed"),
    ),
  };
}

// --- CDR response shapes -------------------------------------------------------------------
const BASE = "https://openfeed.invalid/v1/banking/accounts";

function buildFeed(
  accounts: Account[],
  entries: Entry[],
  cdr: boolean,
  rng: Rng,
): GeneratedApplicant["feed"] {
  const feedAccounts: FeedAccount[] = accounts.map((acc) => {
    const own = entries
      .filter((e) => e.account === acc.id)
      .sort(
        (a, b) => a.day - b.day || a.description.localeCompare(b.description) || a.cents - b.cents,
      );
    const transactions: Transaction[] = own.map((e, i) =>
      toTransaction(e, `${acc.id}-t${String(i + 1).padStart(5, "0")}`, cdr),
    );
    const number = `${rng.int(1000, 9999)}`;
    const account = {
      accountId: acc.id,
      creationDate: `20${rng.int(10, 23)}-0${rng.int(1, 9)}-1${rng.int(0, 9)}`,
      displayName: acc.display,
      openStatus: "OPEN",
      isOwned: true,
      accountOwnership: "ONE_PARTY",
      maskedNumber: `xxxx xxxx xxxx ${number}`,
      productCategory: acc.category,
      productName: acc.product,
    };
    const currentCents = acc.openingCents + own.reduce((s, e) => s + e.cents, 0);
    const balance = {
      accountId: acc.id,
      currentBalance: money(currentCents),
      availableBalance: money(
        acc.limitCents ? acc.limitCents + currentCents : Math.max(currentCents, 0),
      ),
      ...(acc.limitCents ? { creditLimit: money(acc.limitCents) } : {}),
      currency: "AUD",
    };
    return {
      account,
      detail: {
        data: { ...account, bsb: "062000", accountNumber: `1${rng.int(1000000, 9999999)}` },
        links: { self: `${BASE}/${acc.id}` },
        meta: {},
      },
      balance: { data: balance, links: { self: `${BASE}/${acc.id}/balance` }, meta: {} },
      transactions,
      transactionList: {
        data: { transactions },
        links: { self: `${BASE}/${acc.id}/transactions` },
        meta: { totalRecords: transactions.length, totalPages: 1 },
      },
    };
  });
  return {
    accountList: {
      data: { accounts: feedAccounts.map((a) => a.account) },
      links: { self: BASE },
      meta: { totalRecords: feedAccounts.length, totalPages: 1 },
    },
    accounts: feedAccounts,
  };
}

function toTransaction(e: Entry, transactionId: string, cdr: boolean): Transaction {
  const date = `${toIso(e.day)}T00:00:00Z`;
  const base: Transaction = {
    accountId: e.account,
    transactionId,
    isDetailAvailable: false,
    type: e.type,
    status: "POSTED",
    description: cdr ? e.description : statementDescription(e),
    postingDateTime: date,
    valueDateTime: date,
    amount: money(e.cents),
    currency: "AUD",
    reference: e.reference ?? "",
  };
  if (!cdr) return base;
  return {
    ...base,
    ...(e.merchant ? { merchantName: e.merchant.name, merchantCategoryCode: e.merchant.mcc } : {}),
    ...(e.biller ? { billerCode: e.biller.code, billerName: e.biller.name } : {}),
  };
}

/** Uploaded statements carry a truncated narrative with the card prefix and no structured fields. */
function statementDescription(e: Entry): string {
  const prefix = e.merchant ? "EFTPOS " : "";
  return `${prefix}${e.description}`.toUpperCase().slice(0, 40);
}

export function serialise(a: GeneratedApplicant): string {
  return JSON.stringify(a);
}

export { EMPLOYERS };
