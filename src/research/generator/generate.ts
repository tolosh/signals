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
  SECOND_BANKS_V21,
  DISHONOUR_FEES_V21,
  NATURAL_NAMES_V21,
  SUBURBS,
  TELCO,
  type Merchant,
} from "./catalog.js";
import { stream, type Rng } from "./rng.js";
import { netFromGross, taxTable } from "./tax.js";
import {
  AS_OF_DATE,
  GENERATOR_VERSION,
  GENERATOR_VERSION_V2,
  GENERATOR_VERSION_V21,
  GROUND_TRUTH_SCHEMA_VERSION,
  GROUND_TRUTH_SCHEMA_VERSION_V2,
  GROUND_TRUTH_SCHEMA_VERSION_V21,
  type ApplicantSpec,
  type Cadence,
  type FeedAccount,
  type GeneratedApplicant,
  type GroundTruth,
  type LiabilitySpec,
  type LiabilityType,
  type Transaction,
  type V2Truth,
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
  /** The transaction ID, set when the feed is built (shared accounts only). */
  id?: string;
};

type Account = {
  id: string;
  shared: boolean;
  category: string;
  product: string;
  display: string;
  openingCents: number;
  limitCents?: number;
  /** Set v2: a second data holder's BSB (payer drift across banks). */
  bsb?: string;
};

const LIABILITY_DEFAULTS: Record<
  LiabilityType,
  Required<Pick<LiabilitySpec, "limit" | "balance" | "repayment" | "cadence">>
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
  // Set v2 (SIG-54). Every v2 branch below is guarded, and every v2 draw comes from its own
  // "v2:" stream, so a spec without a v2 block generates exactly as in v1.
  const v2 = spec.v2;
  // Set v2.1 (generator 2.1.0; SIG-54 review direction). Every 2.1 branch is guarded by v21 and
  // draws from "v21:" streams, so set v2 regenerates unchanged.
  const v21 = v2?.variant === "2.1";
  const q = (key: string) => r(`v21:${key}`);
  const v2Tax =
    v2?.gross_primary && spec.income.gross_annual > 0
      ? netFromGross(spec.income.gross_annual, taxTable(v2.tax_year ?? "2026-27"))
      : null;
  const PAYS = { weekly: 52, fortnightly: 26, monthly: 12 } as const;
  const basePerPay = v2Tax
    ? round2(v2Tax.net_annual / PAYS[spec.income.cadence])
    : spec.income.net_per_pay;
  const change = v2?.pay?.change;
  const driftFactor =
    v21 && v2?.payer_drift?.mode === "over_time" ? 1 + q("drift-factor").int(10, 40) / 1000 : 1;
  const currentPerPay = change
    ? change.net_per_pay
    : driftFactor !== 1
      ? round2(basePerPay * driftFactor)
      : basePerPay;
  const currentPayer = change?.payer ?? spec.income.payer;
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
  const acrossBanks = v2?.payer_drift?.mode === "across_banks";
  // Set v2.1: a quarter of applicants bank with a second institution too, under varied names.
  const secondBank = acrossBanks || (v21 && q("second-bank").chance(0.25)) ? `${id}-evd2` : null;
  const secondBankOf = v21 ? q("second-bank-which").pick(SECOND_BANKS_V21) : null;
  if (secondBank)
    accounts.push({
      id: secondBank,
      shared: true,
      category: "TRANS_AND_SAVINGS_ACCOUNTS",
      product: "Everyday Account",
      display: secondBankOf ? secondBankOf.display : "Everyday (second bank)",
      openingCents: toCents(r("v2:open-second").int(200, 2000)),
      bsb: secondBankOf ? secondBankOf.bsb : "733000",
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
  const changeDay = change ? start + change.after_days : Infinity;
  const overtime = v2?.pay?.overtime;
  const overtimeRng = r("v2:overtime");
  const bonusIndex = v2?.pay?.bonus ? r("v2:bonus").int(0, Math.max(0, payDays.length - 1)) : -1;
  const drift = streamType === "salary" ? v2?.payer_drift : undefined;
  const driftDay = start + Math.floor((end - start) / 2);
  const payEvents: { kind: "overtime" | "bonus" | "change"; entry: Entry; amount: number }[] = [];
  const splitShare = v21 ? q("split").int(20, 50) / 100 : 0;
  const payers = new Map<string, { aliases: string[]; from: number; to: number }>();
  let receivedCents = 0;
  let changeLogged = false;
  // Set v2.1: the pay reference depends on the payer's bank and payroll; some carry none.
  const refFormat = v21
    ? q("pay-ref").pick(["date", "none", "wages", "payroll", "date"] as const)
    : "date";
  const refRng = q("pay-ref-drop");
  const payrollId = `${q("payroll-id").int(100000, 999999)}`;
  const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const payRef = (day: number, alias: boolean): string => {
    if (!v21) return `PAY ${toIso(day)}`;
    const iso = toIso(day);
    if (alias) return `SAL ${iso.slice(8, 10)}${iso.slice(5, 7)}`;
    if (refFormat === "none" || refRng.chance(0.15)) return "";
    if (refFormat === "wages")
      return `WAGES ${iso.slice(8, 10)}${MON[Number(iso.slice(5, 7)) - 1]}`;
    if (refFormat === "payroll") return `PAYROLL ${payrollId}`;
    return `PAY ${iso}`;
  };
  for (const [k, day] of payDays.entries()) {
    const changed = day >= changeDay;
    const payer = changed && change?.payer ? change.payer : spec.income.payer;
    let cents = toCents(
      payRng.jitter(changed && change ? change.net_per_pay : basePerPay, spec.income.variability),
    );
    let description =
      streamType === "benefit"
        ? "SERVICES AUSTRALIA CENTRELINK"
        : streamType === "gig"
          ? `${payer} PAYOUT`
          : `SALARY ${payer}`;
    let account = incomeAccount;
    let alias = false;
    if (drift?.mode === "over_time" && day >= driftDay) {
      description = drift.alias;
      alias = true;
      if (v21) cents = Math.round(cents * driftFactor);
    }
    if (drift?.mode === "across_banks" && secondBank && (v21 || k % 2 === 1)) {
      if (v21) {
        // Set v2.1: a share of every pay goes to the second bank, under the alias.
        const part = Math.round(cents * splitShare);
        cents -= part;
        add({
          account: secondBank,
          day,
          cents: part,
          type: "TRANSFER_INCOMING",
          description: drift.alias,
          reference: payRef(day, true),
        });
        receivedCents += part;
        const seenAlias = payers.get(payer) ?? { aliases: [], from: day, to: day };
        if (!seenAlias.aliases.includes(drift.alias)) seenAlias.aliases.push(drift.alias);
        payers.set(payer, seenAlias);
      } else {
        description = drift.alias;
        account = secondBank;
        alias = true;
      }
    }
    const events: { kind: "overtime" | "bonus" | "change"; amount: number }[] = [];
    // Set v2.1: an applicant tagged overtime always has some (syn-v2-0073 had none).
    const lastChance =
      v21 && k === payDays.length - 1 && !payEvents.some((e) => e.kind === "overtime");
    if (overtime && (overtimeRng.chance(overtime.share) || lastChance)) {
      cents += toCents(overtime.amount);
      events.push({ kind: "overtime", amount: overtime.amount });
    }
    if (k === bonusIndex && v2?.pay?.bonus) {
      cents += toCents(v2.pay.bonus.amount);
      events.push({ kind: "bonus", amount: v2.pay.bonus.amount });
    }
    if (changed && change && !changeLogged) {
      changeLogged = true;
      events.push({ kind: "change", amount: change.net_per_pay });
    }
    const payEntry: Entry = {
      account,
      day,
      cents,
      type: "TRANSFER_INCOMING",
      description,
      reference: payRef(day, alias),
    };
    add(payEntry);
    for (const e of events) payEvents.push({ ...e, entry: payEntry });
    receivedCents += cents;
    const seen = payers.get(payer) ?? { aliases: [], from: day, to: day };
    if (!seen.aliases.includes(description)) seen.aliases.push(description);
    seen.to = day;
    payers.set(payer, seen);
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

  if (v21 && q("payback").chance(0.35)) {
    const pb = q("payback-days");
    const friend = pb.pick(["J NGUYEN", "S PATEL", "M SMITH", "L CHEN", "A BROWN"]);
    for (const day of schedule(pb, "monthly", start, end))
      add({
        account: everyday,
        day,
        cents: toCents(pb.int(20, 200)),
        type: "TRANSFER_INCOMING",
        description: `TRANSFER FROM ${friend}`,
        reference: `PAY ${toIso(day)}`,
      });
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
  spend(
    "fuel",
    "basic",
    "fortnightly",
    75 * scale,
    shop(FUEL, v21 && secondBank && !acrossBanks ? secondBank : everyday),
  );
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

  // Set v2.1: direct debits that aren't loans, and ordinary bank fees.
  if (v21 && q("gym").chance(0.6)) {
    const brand = q("gym-brand").pick(["ANYTIME FITNESS", "JETTS", "SNAP FITNESS", "F45"]);
    spend(
      "gym",
      "discretionary",
      "monthly",
      q("gym-fee").int(15, 70),
      (day, cents) =>
        add({
          account: everyday,
          day,
          cents,
          type: "DIRECT_DEBIT",
          description: `${brand} MEMBERSHIP`,
        }),
      0,
    );
  }
  if (v21 && q("car-insurance").chance(0.45)) {
    const insurer = q("car-insurer").pick(["AAMI", "BUDGET DIRECT", "YOUI", "NRMA"]);
    spend(
      "car_insurance_monthly",
      "committed",
      "monthly",
      q("car-insurance-fee").int(60, 160),
      (day, cents) =>
        add({
          account: everyday,
          day,
          cents,
          type: "DIRECT_DEBIT",
          description: `${insurer} INSURANCE`,
        }),
      0,
    );
  }
  if (v21 && q("account-fee").chance(0.55))
    spend(
      "account_fee",
      "discretionary",
      "monthly",
      q("account-fee-amount").pick([4, 5, 6]),
      (day, cents) =>
        add({ account: everyday, day, cents, type: "FEE", description: "ACCOUNT KEEPING FEE" }),
      0,
    );

  // Commitments, including quarterly and annual items.
  const bpayEntries: { entry: Entry; kind: "bill" | "card_repayment"; item: string | null }[] = [];
  const commitments: GroundTruth["commitments"] = spec.commitments.map((c) => {
    const rng = r(`commitment:${c.kind}`);
    const days = schedule(rng, c.cadence, start, end);
    const telco = c.kind === "telco" ? rng.pick(TELCO) : undefined;
    const telcoByDebit = v21 && telco !== undefined && q("telco-dd").chance(0.5);
    const biller = BILLERS[c.kind];
    for (const day of days) {
      if (telco)
        add({
          account: everyday,
          day,
          cents: -toCents(c.amount),
          type: telcoByDebit ? "DIRECT_DEBIT" : "PAYMENT",
          description: `${telco.descriptor} ${suburb} AUS`,
          merchant: telco,
        });
      else if (biller) {
        const bill: Entry = {
          account: everyday,
          day,
          cents: -toCents(c.amount),
          type: "PAYMENT",
          description: `BPAY ${biller.name}`,
          biller,
        };
        add(bill);
        bpayEntries.push({ entry: bill, kind: "bill", item: `commitment:${c.kind}` });
      } else
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
  const liabilityV2: (Omit<V2Truth["liabilities"][number], "repayment_transaction_ids"> & {
    entries: Entry[];
  })[] = [];
  const liabilityItems: GroundTruth["liabilities"]["items"] = spec.liabilities.map((l, i) => {
    const d = LIABILITY_DEFAULTS[l.type];
    const provider = l.provider ?? r(`provider:${i}`).pick(PROVIDERS[l.type] ?? ["LENDER"]);
    const limit = l.limit ?? (d.limit || null);
    const balance = l.balance ?? d.balance;
    const baseRepayment =
      l.type === "credit_card"
        ? (l.repayment ?? Math.max(d.repayment, 0.03 * (limit ?? 0)))
        : (l.repayment ?? d.repayment);
    // Set v2.1: a non-card repayment is drawn per applicant, from 60% to 160% of the type's typical.
    const repayment =
      v21 && l.type !== "credit_card"
        ? round2(baseRepayment * (0.6 + q(`repayment:${i}`).int(0, 1000) / 1000))
        : baseRepayment;
    const cadence: Cadence =
      l.type === "wage_advance" ? spec.income.cadence : (l.cadence ?? d.cadence);
    const shared = l.account_shared ?? false;
    const loanAccount = `${id}-l${i + 1}`;
    // Set v2: where repayments come from, the narrative's reference, and the card biller cue.
    let payFrom = everyday;
    if (l.paid_from_unshared) {
      payFrom = `${id}-p${i + 1}`;
      accounts.push({
        id: payFrom,
        shared: false,
        category: "TRANS_AND_SAVINGS_ACCOUNTS",
        product: "Other Bank Account",
        display: `Other ${i + 1}`,
        openingCents: 0,
      });
    }
    const ref = l.narrative_ref ? `${r(`v2:ref:${i}`).int(10_000_000, 99_999_999)}` : null;
    const named = ref ? `${provider} ${ref}` : provider;
    const cue = l.biller_cue ?? true;
    const repaymentEntries: Entry[] = [];
    if (l.mortgage?.feature === "offset")
      accounts.push({
        id: `${id}-off${i + 1}`,
        shared: true,
        category: "TRANS_AND_SAVINGS_ACCOUNTS",
        product: "Mortgage Offset",
        display: "Offset",
        openingCents: toCents(r(`v2:offset:${i}`).int(5_000, 60_000)),
      });
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
        // Set v2.1: each issuer has its own biller code; without the cue, the biller name is the
        // issuer's legal or brand name, with no "CARD" in it.
        const issuerCode = v21 ? issuerBillerCode(provider) : b.code;
        const plain = (NATURAL_NAMES_V21[provider] ?? provider).toUpperCase();
        const paid: Entry = {
          account: payFrom,
          day,
          cents: -cents,
          type: "PAYMENT",
          description: cue
            ? `BPAY ${named} CREDIT CARD PAYMENT`
            : v21
              ? `BPAY ${plain}`
              : `BPAY ${named} CARDS`,
          biller: {
            name: cue ? `${provider} ${b.name}` : v21 ? plain : `${provider} CARDS`,
            code: issuerCode,
          },
        };
        add(paid);
        repaymentEntries.push(paid);
        bpayEntries.push({ entry: paid, kind: "card_repayment", item: null });
        if (shared)
          add({
            account: cardAccount,
            day,
            cents,
            type: "TRANSFER_INCOMING",
            description: "PAYMENT RECEIVED THANK YOU",
          });
      } else if (l.type === "bnpl") {
        const paid: Entry = {
          account: payFrom,
          day,
          cents: -cents,
          type: "DIRECT_DEBIT",
          description: `${named} INSTALMENT`,
        };
        add(paid);
        repaymentEntries.push(paid);
      } else if (l.type === "wage_advance") {
        add({
          account: everyday,
          day: Math.max(day - 3, start),
          cents,
          type: "TRANSFER_INCOMING",
          description: `${provider} ADVANCE`,
        });
        const paid: Entry = {
          account: payFrom,
          day,
          cents: -cents,
          type: "DIRECT_DEBIT",
          description: `${named} REPAYMENT`,
        };
        add(paid);
        repaymentEntries.push(paid);
      } else {
        const paid: Entry = {
          account: payFrom,
          day,
          cents: -cents,
          type: "DIRECT_DEBIT",
          description: `${named} LOAN REPAYMENT`,
        };
        add(paid);
        repaymentEntries.push(paid);
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
    liabilityV2.push({
      id: `liab-${i + 1}`,
      lender: provider,
      declared_as: l.declared_as ?? null,
      unseen_lender: l.unseen_lender ?? false,
      paid_from_account_id: payFrom,
      paid_from_shared: payFrom === everyday,
      narrative_ref: ref,
      biller_cue: cue,
      mortgage: l.mortgage ?? null,
      entries: repaymentEntries,
    });
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
  const dishonourEntries: { entry: Entry; daysAgo: number }[] = [];
  const dated = v2?.dishonours?.days_ago;
  if (dated) {
    const bankFee = v21 ? q("dishonour-fee").pick(DISHONOUR_FEES_V21) : null;
    for (const daysAgo of dated) {
      const day = end - daysAgo;
      if (v21) {
        // Set v2.1: a dishonour is a direct debit that is returned, and the bank's fee for it.
        const payee = q(`dishonour-payee:${daysAgo}`).pick([
          "ORIGIN ENERGY",
          "AAMI INSURANCE",
          "TELSTRA",
          "JETTS",
        ]);
        const attempted = toCents(q(`dishonour-amount:${daysAgo}`).int(40, 300));
        add({
          account: everyday,
          day,
          cents: -attempted,
          type: "DIRECT_DEBIT",
          description: `${payee} DIRECT DEBIT`,
        });
        add({
          account: everyday,
          day,
          cents: attempted,
          type: "TRANSFER_INCOMING",
          description: `DIRECT DEBIT RETURNED ${payee}`,
        });
      }
      const fee: Entry = {
        account: everyday,
        day,
        cents: bankFee ? -toCents(bankFee.amount) : -1500,
        type: "FEE",
        description: bankFee ? bankFee.description : "DISHONOUR FEE",
      };
      add(fee);
      dishonourEntries.push({ entry: fee, daysAgo });
    }
  } else {
    for (let i = 0; i < spec.behaviours.dishonours; i++) {
      add({
        account: everyday,
        day: start + dishonourRng.int(0, end - start),
        cents: -1500,
        type: "FEE",
        description: "DISHONOUR FEE",
      });
    }
  }
  const dishonourCount = dated ? dated.length : spec.behaviours.dishonours;

  // Ground truth.
  const streamMonthly = round2(currentPerPay * MONTHLY_FACTOR[spec.income.cadence]);
  const group = (g: "committed" | "basic" | "discretionary") =>
    round2(items.filter((i) => i.group === g).reduce((s, i) => s + i.monthly_equivalent, 0));
  const committed = group("committed");
  const basic = group("basic");
  const discretionary = group("discretionary");
  const total = round2(committed + basic + discretionary);
  const repayments = round2(liabilityItems.reduce((s, l) => s + l.monthly_commitment, 0));
  const gambling = items.find((i) => i.name === "gambling");

  const truth: GroundTruth = {
    schema_version: v21
      ? GROUND_TRUTH_SCHEMA_VERSION_V21
      : v2
        ? GROUND_TRUTH_SCHEMA_VERSION_V2
        : GROUND_TRUTH_SCHEMA_VERSION,
    generator_version: v21 ? GENERATOR_VERSION_V21 : v2 ? GENERATOR_VERSION_V2 : GENERATOR_VERSION,
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
          payer: currentPayer,
          cadence: spec.income.cadence,
          net_per_pay: currentPerPay,
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
      dishonours: dishonourCount,
      positive: {
        rent_on_time: spec.expenses.rent_monthly > 0 && spec.behaviours.positive.rent_on_time,
        cards_cleared_in_full: cleared,
        savings_growing: savingsMonthly > 0,
        savings_monthly: savingsMonthly,
        no_dishonours: dishonourCount === 0,
      },
    },
    surplus_monthly: round2(streamMonthly - total - repayments),
  };

  const feed = buildFeed(
    accounts.filter((a) => a.shared),
    entries,
    cdr,
    r("feed"),
  );
  if (v2) {
    const windowMonths = (end - start + 1) / (365.25 / 12);
    const v2truth: V2Truth = {
      request: { lookback_months: v2.requested_lookback },
      tax:
        v21 && v2Tax && change?.gross_annual
          ? { ...v2Tax, gross_annual_after_change: change.gross_annual }
          : v2Tax,
      payers: [...payers.entries()].map(([payer, p]) => ({
        payer,
        aliases: p.aliases,
        from: toIso(p.from),
        to: toIso(p.to),
      })),
      pay_events: payEvents.map((e) => ({
        kind: e.kind,
        date: toIso(e.entry.day),
        transaction_id: e.entry.id ?? null,
        amount: e.amount,
      })),
      received_net_monthly: round2(receivedCents / 100 / windowMonths),
      dishonour_events: dishonourEntries.map(({ entry, daysAgo }) => ({
        date: toIso(entry.day),
        days_ago: daysAgo,
        recent: daysAgo <= 90,
        transaction_id: entry.id ?? "",
      })),
      bpay: bpayEntries.map(({ entry, kind, item }) => ({
        transaction_id: entry.id ?? null,
        biller_name: entry.biller?.name ?? "",
        biller_code: entry.biller?.code ?? "",
        kind,
        item,
        true_group: kind === "bill" ? "committed" : null,
        true_category: kind === "card_repayment" ? "transfer" : null,
      })),
      liabilities: liabilityV2.map(({ entries: paid, ...l }) => ({
        ...l,
        repayment_transaction_ids: paid.flatMap((e) => (e.id ? [e.id] : [])),
      })),
    };
    truth.v2 = v2truth;
  }

  return {
    truth,
    application: {
      stated_gross_annual: spec.income.gross_annual,
      declared_liabilities: liabilityItems
        .filter((l) => l.declared)
        .map((l) => ({
          type: l.type,
          provider: v2
            ? (liabilityV2.find((x) => x.id === l.id)?.declared_as ??
              (v21 && q(`declared-case:${l.id}`).chance(0.6) ? titleCase(l.provider) : l.provider))
            : l.provider,
          repayment_monthly: l.monthly_commitment,
        })),
    },
    feed,
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
    const transactions: Transaction[] = own.map((e, i) => {
      e.id = `${acc.id}-t${String(i + 1).padStart(5, "0")}`;
      return toTransaction(e, e.id, cdr);
    });
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
        data: {
          ...account,
          bsb: acc.bsb ?? "062000",
          accountNumber: `1${rng.int(1000000, 9999999)}`,
        },
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

/** Set v2.1: "ZIP PAY" as an applicant might type it, "Zip Pay". */
const titleCase = (name: string) =>
  name
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase());

/** Set v2.1: a card issuer's own synthetic BPAY biller code, the same for every applicant. */
function issuerBillerCode(issuer: string): string {
  let h = 0;
  for (const ch of issuer) h = (h * 31 + ch.charCodeAt(0)) % 900_000;
  return String(100_000 + h);
}
