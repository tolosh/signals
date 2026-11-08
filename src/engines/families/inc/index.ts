// Family 1 INC: income integrity and continuity, INC-01 to INC-13 (SIG-41; Amendment 2 §4.1,
// INC-R1 to INC-R3; Product Specification §7.2). The family reads SIG-16's income streams and
// never re-derives income. Every output passes through the evidence-quality layer (SIG-39).
// Interpretations N-1 to N-14 are in docs/adr/0004-inc-family.md, for ruling.
// Pure: no clock, no randomness, relative imports only (D3).
import { applyEvidence, assessEvidence } from "../../evidence/index.js";
import { dayOf, isoOf, lookbackStart } from "../../evidence/dates.js";
import type { EvidenceContext, Feed, RawSignal, Signal } from "../../evidence/index.js";
import { withoutSensitive } from "../../sensitive.js";
import type { FeedType } from "../../signals/definitions.js";
import { INC_DEFAULTS, INC_THRESHOLDS as T, type IncConfig } from "./config.js";
import { SALARY_LIKE, streamsOf, type Credit, type Streams, type TypedStream } from "./streams.js";

export {
  INC_CANDIDATES,
  INC_DEFAULTS,
  INC_THRESHOLDS,
  incConfigFromPolicy,
  type IncConfig,
  type IncomeSignalsPolicy,
  type StreamType,
} from "./config.js";
export const INC_VERSION = "1.2.1";

export type IncApplication = {
  /** FR-C9; used only by INC-02 (INC-R3). */
  stated_gross_annual?: number | null;
  occupation?: string | null;
  loan_amount?: number | null;
  proposed_repayment_monthly?: number | null;
  /** How many people in the household earn an income (N-9). */
  household_earners?: number | null;
};

export type IncInput = {
  feed: Feed;
  feed_type: FeedType;
  as_of: string;
  /** The lookback the lender requested (D22); 6 months when absent. */
  lookback_months?: number;
  application?: IncApplication;
  config?: Partial<IncConfig>;
  /**
   * Gross monthly income from net monthly income: SIG-46's resident tax-table gross-up. SIG-46 is
   * on hold (ruling 7 November 2026), so production passes none and INC-02 is unverified (D24).
   */
  gross_up?: ((netMonthly: number) => number) | null;
  /** Enrich category by transaction id, when known; GR-3 lines are removed first. */
  categories?: Readonly<Record<string, string>>;
};

/** The income table, in the contract's AffordabilityTrace.income row shape. */
export type IncomeRow = {
  payer: string;
  cadence: string;
  observed_amount: number;
  type: string;
  shading: number;
  assessed_amount: number;
};

export type IncResult = {
  version: string;
  signals: Signal[];
  income: IncomeRow[];
  net_monthly: number;
  assessed_monthly: number;
  trace: { step: string; value: number }[];
};

const round = (value: number, places = 2) => {
  const f = 10 ** places;
  return Math.round((value + Number.EPSILON * Math.sign(value)) * f) / f;
};
const pct = (x: number) => Math.round(x * 100);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};
const monthlyOf = (xs: TypedStream[]) => sum(xs.map((s) => s.monthly));
const BANDS: [string, number, number, number][] = [
  ["weekly", 5, 9, 52 / 12],
  ["fortnightly", 12, 16, 26 / 12],
  ["monthly", 26, 35, 1],
];
const bandOf = (gap: number) => BANDS.find(([, lo, hi]) => gap >= lo && gap <= hi);
const gapsOf = (cs: Credit[]) => cs.slice(1).map((c, i) => c.day - (cs[i]?.day ?? c.day));

/** An evaluator's result. An absent input is `raw.missing_input`, capped by the layer (N-13). */
type Out = { raw: RawSignal };

type Ctx = {
  end: number;
  dataStart: number;
  lookback: number;
  app: IncApplication;
  config: IncConfig;
  streams: TypedStream[];
  feed: Feed;
  gross_up: ((n: number) => number) | null;
  /** Whether INC-09's final state is amber or red; INC-12 cross-references it only then. */
  inc09Fires: boolean;
};

function evidenceOf(credits: Credit[]): RawSignal["evidence"] {
  const first = credits[0];
  const last = credits[credits.length - 1];
  return {
    account_ids: [...new Set(credits.map((c) => c.account))].sort(),
    transaction_count: credits.length,
    ...(first && last ? { period_start: isoOf(first.day), period_end: isoOf(last.day) } : {}),
  };
}

function out(
  id: string,
  state: RawSignal["state"],
  value: string | null,
  reason: string,
  credits: Credit[],
  extra: Partial<RawSignal> = {},
): Out {
  return {
    raw: {
      id,
      state,
      value,
      reason,
      confidence: "high",
      nothing_found: false,
      evidence: evidenceOf(credits),
      enrich_confident_pct: null,
      unrecognised_adverse: 0,
      ...extra,
    },
  };
}
const missing = (id: string, reason: string, resolve: string[]): Out =>
  out(id, "green", null, reason, [], { missing_input: { reason, resolve_with: resolve } });

const largest = (xs: TypedStream[]) =>
  [...xs].sort((a, b) => b.monthly - a.monthly || (a.payer < b.payer ? -1 : 1))[0];
/** N-5: the current employer is the salary-like stream paid most recently. */
const current = (xs: TypedStream[]) =>
  [...xs]
    .filter((s) => SALARY_LIKE.has(s.type))
    .sort((a, b) => b.last - a.last || b.monthly - a.monthly || (a.payer < b.payer ? -1 : 1))[0];
const creditsOf = (xs: TypedStream[]) => xs.flatMap((s) => s.credits).sort((a, b) => a.day - b.day);

// INC-01 Income regularity: variation cycle to cycle, and how late the last pay is (N-4).
function inc01(c: Ctx): Out {
  const p = largest(c.streams);
  if (!p) return out("INC-01", "red", null, "No recurring income was found", []);
  const since = lookbackStart(isoOf(c.end), 6);
  const recent = p.credits.filter((x) => x.day >= since);
  const changes = recent
    .slice(1)
    .map((x, i) => Math.abs(x.amount - (recent[i]?.amount ?? x.amount)) / (recent[i]?.amount ?? 1));
  const variation = round(Math.max(0, ...changes));
  const daysSince = c.end - p.last;
  if (daysSince > p.cycle_days * T.regularity_late_cycles)
    return out(
      "INC-01",
      "red",
      `Last pay ${daysSince} days ago`,
      `The last ${p.cadence} pay from ${p.payer} was more than 1.5 cycles ago`,
      recent,
    );
  return out(
    "INC-01",
    variation > T.regularity_variation ? "amber" : "green",
    `Varies up to ${pct(variation)}% cycle to cycle`,
    variation > T.regularity_variation
      ? `Pay from ${p.payer} varies more than 20% from one cycle to the next`
      : `Pay from ${p.payer} arrives ${p.cadence} and varies by ${pct(variation)}% at most`,
    recent,
  );
}

// INC-02 Stated vs observed: stated gross salary against observed net pay, grossed up (N-12).
function inc02(c: Ctx): Out {
  const stated = c.app.stated_gross_annual ?? null;
  if (stated === null || stated <= 0)
    return missing("INC-02", "Not verified: the application has no stated gross salary", [
      "Record the applicant's stated gross salary",
    ]);
  if (!c.gross_up)
    return missing(
      "INC-02",
      "Not verified: needs gross-up. The resident tax-table gross-up (SIG-46) is not built yet (D24)",
      [],
    );
  const salary = c.streams.filter((s) => SALARY_LIKE.has(s.type));
  const observed = round(c.gross_up(monthlyOf(salary)) * 12);
  const gap = round(Math.abs(observed - stated) / stated);
  const state = gap > T.stated_gap_red ? "red" : gap > T.stated_gap_amber ? "amber" : "green";
  return out(
    "INC-02",
    state,
    `${pct(gap)}% gap`,
    `Stated gross salary $${stated.toFixed(0)} a year against $${observed.toFixed(0)} observed, grossed up`,
    creditsOf(salary),
  );
}

const VARIABLE = new Set(["overtime_bonus", "commission", "gig_platform", "rental"]);

// INC-03 Income mix (N-7).
function inc03(c: Ctx): Out {
  const total = monthlyOf(c.streams);
  const variable = c.streams.filter((s) => VARIABLE.has(s.type));
  const share = total > 0 ? round(monthlyOf(variable) / total) : 0;
  const benefitsOnly =
    c.streams.length > 0 && c.streams.every((s) => s.type === "government_benefit");
  const loan = c.app.loan_amount ?? 0;
  if (benefitsOnly && loan >= c.config.wage_sized_loan_amount)
    return out(
      "INC-03",
      "red",
      "100% benefits",
      `Government benefits are the only income, on a loan of $${loan.toFixed(0)}`,
      creditsOf(c.streams),
    );
  return out(
    "INC-03",
    share > T.variable_share ? "amber" : "green",
    `${pct(share)}% variable`,
    `${pct(share)}% of income is variable, gig or rental; variable income is shaded in the income table`,
    creditsOf(variable.length > 0 ? variable : c.streams),
  );
}

// INC-04 Employer tenure (N-5).
function inc04(c: Ctx): Out {
  const cur = current(c.streams);
  if (!cur)
    return out("INC-04", "green", null, "No salary stream, so employer tenure does not apply", []);
  const months = round((c.end - cur.first) / 30.4375);
  const fromStart = cur.first - c.dataStart <= cur.cycle_days;
  if (fromStart || months >= T.tenure_months)
    return out(
      "INC-04",
      "green",
      fromStart ? `At least ${months.toFixed(1)} months` : `${months.toFixed(1)} months`,
      `Paid by ${cur.payer} since ${isoOf(cur.first)}${fromStart ? ", the start of the history" : ""}`,
      cur.credits.slice(0, 1),
    );
  const policy = c.config.policy_loan_amount;
  const loan = c.app.loan_amount ?? 0;
  const red = policy !== null && loan > policy;
  return out(
    "INC-04",
    red ? "red" : "amber",
    `${months.toFixed(1)} months`,
    `First pay from ${cur.payer} was on ${isoOf(cur.first)}, under 3 months ago` +
      (red ? `, and the loan is over the policy size of $${policy.toFixed(0)}` : ""),
    cur.credits.slice(0, 1),
  );
}

const BSB_NUMBER = /\b\d{3}-?\d{3}\s+\d{6,10}\b/;
const PAY_WORD = /\b(SALARY|WAGES?|PAYROLL|PAY)\b/;

// INC-05 Circular income: pay-like credits from the applicant's own accounts (N-6).
function inc05(c: Ctx): Out {
  const start = lookbackStart(isoOf(c.end), c.lookback);
  type L = Credit & { description: string };
  const lines: L[] = c.feed.accounts.flatMap((a) =>
    a.transactions
      .map((t) => ({
        day: dayOf(t.postingDateTime ?? t.valueDateTime ?? ""),
        amount: Number(t.amount),
        transactionId: t.transactionId,
        account: a.account.accountId,
        description: t.description.toUpperCase(),
      }))
      .filter((l) => l.day >= start && l.day <= c.end),
  );
  const debits = new Set(
    lines.filter((l) => l.amount < 0).map((l) => `${l.day}:${-l.amount}:${l.account}`),
  );
  const paired = (l: L) =>
    c.feed.accounts.some(
      (a) =>
        a.account.accountId !== l.account &&
        debits.has(`${l.day}:${l.amount}:${a.account.accountId}`),
    );
  const circular = lines
    .filter((l) => l.amount > 0 && PAY_WORD.test(l.description))
    .filter((l) => BSB_NUMBER.test(l.description) || paired(l))
    .sort((a, b) => a.day - b.day);
  if (circular.length === 0)
    return out(
      "INC-05",
      "green",
      "0 credits",
      "No pay-like credits from the applicant's own accounts were found",
      [],
      { nothing_found: true },
    );
  const monthly = sum(circular.map((l) => l.amount)) / c.lookback;
  const income = monthlyOf(c.streams);
  const share = income > 0 ? round(monthly / income) : 1;
  return out(
    "INC-05",
    share >= T.circular_material_share ? "red" : "amber",
    `${pct(share)}% of income`,
    `${circular.length} pay-like credits came from the applicant's own accounts`,
    circular,
  );
}

// INC-06 Occupation fit (N-8).
function inc06(c: Ctx): Out {
  const occupation = c.app.occupation?.trim().toLowerCase() ?? "";
  if (!occupation)
    return missing("INC-06", "Not verified: the application has no occupation", [
      "Add the applicant's occupation to the application",
    ]);
  const salary = c.streams.filter((s) => SALARY_LIKE.has(s.type));
  if (salary.length === 0)
    return out(
      "INC-06",
      "red",
      "No matching payer",
      `Occupation "${occupation}" is stated, but no salary payer was found`,
      [],
    );
  const band = c.config.occupation_bands[occupation];
  if (!band)
    return missing("INC-06", `Not verified: no pay band is set for "${occupation}"`, [
      `Set a pay band for the occupation "${occupation}" in the workspace policy`,
    ]);
  const pay = round(monthlyOf(salary));
  const outside = pay < band.min_monthly || pay > band.max_monthly;
  return out(
    "INC-06",
    outside ? "amber" : "green",
    `$${pay.toFixed(0)} a month`,
    `Salary of $${pay.toFixed(0)} a month is ${outside ? "outside" : "within"} the band for "${occupation}" ($${band.min_monthly} to $${band.max_monthly})`,
    creditsOf(salary),
  );
}

// INC-07 Payer concentration: context (N-9).
function inc07(c: Ctx): Out {
  const total = monthlyOf(c.streams);
  const top = largest(c.streams);
  const share = top && total > 0 ? round(top.monthly / total) : 0;
  const single = c.streams.length === 1;
  const earners = c.app.household_earners ?? null;
  // Ruling 2 (7 November 2026): without household_earners, INC-07 is unverified, never green.
  if (earners === null)
    return missing("INC-07", "Not verified: the application does not say how many earn an income", [
      "Confirm how many people in the household earn an income",
    ]);
  const loan = c.app.loan_amount ?? 0;
  const flagged = single && earners === 1 && loan >= c.config.large_loan_amount;
  return out(
    "INC-07",
    flagged ? "amber" : "green",
    `${pct(share)}% from one payer`,
    flagged
      ? `A single payer and a single income in the household, on a loan of $${loan.toFixed(0)}`
      : `The largest payer provides ${pct(share)}% of income`,
    top?.credits ?? [],
  );
}

// INC-08 Diversification: context.
function inc08(c: Ctx): Out {
  const total = monthlyOf(c.streams);
  const counted = c.streams.filter(
    (s) => total > 0 && round(s.monthly / total) > T.diversification_share,
  );
  return out(
    "INC-08",
    "green",
    `${counted.length} stream${counted.length === 1 ? "" : "s"}`,
    `${counted.length} independent income stream${counted.length === 1 ? "" : "s"} each contribute over 10%`,
    creditsOf(counted),
  );
}

// INC-09 Seasonality over the last 12 months (N-10, as ruled 8 November 2026): the income actually
// received in each month against the 12-month average of actual income (Amendment 2 §4.1). There
// is no add-back: a missed pay is never used to hide a dip. INC-09 and INC-12 both fire, and each
// names the other when a trough month holds a pay INC-12 reports as missed.
type Month = { from: number; to: number; total: number };
function troughMonths(c: Ctx): { months: Month[]; troughs: Month[] } {
  const asOf = isoOf(c.end);
  const all = creditsOf(c.streams);
  const months = Array.from({ length: 12 }, (_, k) => {
    const from = lookbackStart(asOf, k + 1);
    const to = lookbackStart(asOf, k) - 1;
    return {
      from,
      to,
      total: sum(all.filter((x) => x.day >= from && x.day <= to).map((x) => x.amount)),
    };
  });
  const average = sum(months.map((m) => m.total)) / 12;
  const troughs = months.filter((m) => average > 0 && round(m.total / average) < T.trough_share);
  return { months, troughs };
}
const monthOf = (m: Month) => isoOf(m.to).slice(0, 7);
/** The pays INC-12 reports as missed (its own 6 months) that fall in an INC-09 trough month. */
function crossReferenced(c: Ctx): { day: number; month: Month }[] {
  const { troughs } = troughMonths(c);
  return missedPays(c, T.interruption_window_months).flatMap((m) => {
    const month = troughs.find((t) => m.day >= t.from && m.day <= t.to);
    return month ? [{ day: m.day, month }] : [];
  });
}

function inc09(c: Ctx): Out {
  // Fix 1 (re-review at cfa9d4f): with no income stream there is no basis to judge seasonality.
  if (c.streams.length === 0)
    return missing("INC-09", "Not verified: no regular income stream was found to judge", [
      "Connect the account your regular pay goes into, or explain why it is missing",
    ]);
  const all = creditsOf(c.streams);
  const { troughs } = troughMonths(c);
  const repayment = c.app.proposed_repayment_monthly ?? null;
  const uncovered = troughs.filter((m) => repayment !== null && m.total < repayment);
  const state = uncovered.length > 0 ? "red" : troughs.length > 0 ? "amber" : "green";
  const links = crossReferenced(c).map(
    (x) => `Includes a missed pay on ${isoOf(x.day)}; see INC-12`,
  );
  const base =
    state === "red"
      ? `In ${uncovered.length} trough month${uncovered.length === 1 ? "" : "s"}, income is below the proposed repayment`
      : state === "amber"
        ? `${troughs.length} month${troughs.length === 1 ? "" : "s"} fell below 60% of the annual average`
        : "Every month is at or above 60% of the annual average";
  // N-1: the family reads SIG-16's regular streams, so bonuses and one-off credits aren't counted.
  const basis = "regular income only";
  return out(
    "INC-09",
    state,
    `${troughs.length} trough month${troughs.length === 1 ? "" : "s"}`,
    [`${base} (${basis})`, ...links].join(". "),
    all,
  );
}

// INC-10 Gig and platform income (N-11).
function inc10(c: Ctx): Out {
  const total = monthlyOf(c.streams);
  const gig = c.streams.filter((s) => s.type === "gig_platform");
  const share = total > 0 ? round(monthlyOf(gig) / total) : 0;
  const credits = creditsOf(gig);
  const inRange = (from: number, to: number) =>
    sum(credits.filter((x) => x.day >= from && x.day <= to).map((x) => x.amount));
  const recent = inRange(c.end - 90, c.end);
  const prior = inRange(c.end - 181, c.end - 91);
  const decline = prior > 0 ? round(1 - recent / prior) : 0;
  const state =
    share > T.gig_red && decline > T.gig_decline ? "red" : share > T.gig_amber ? "amber" : "green";
  return out(
    "INC-10",
    state,
    `${pct(share)}% gig`,
    `${pct(share)}% of income is from gig and platform payers` +
      (decline > T.gig_decline ? `, down ${pct(decline)}% on the 3 months before` : "") +
      ". Gig payers are matched against the fixture list until Enrich curates them",
    credits,
    { confidence: "medium" },
  );
}

// INC-11 Falling pay at the same payer (N-4).
function inc11(c: Ctx): Out {
  const n = T.falling_cycles;
  const worst = c.streams
    .filter((s) => SALARY_LIKE.has(s.type) && s.credits.length > n)
    .map((s) => {
      const last = s.credits.slice(-(n + 1));
      const falling = last.every((x, i) => i === 0 || x.amount <= (last[i - 1]?.amount ?? 0));
      const fall = falling ? round(1 - (last[n]?.amount ?? 0) / (last[0]?.amount ?? 1)) : 0;
      return { s, fall, last };
    })
    .sort((a, b) => b.fall - a.fall)[0];
  if (!worst || worst.fall <= T.falling_amber)
    return out(
      "INC-11",
      "green",
      `Down ${pct(worst?.fall ?? 0)}% over ${n} cycles`,
      "Pay per cycle from the same payer is not falling",
      worst?.last ?? [],
    );
  return out(
    "INC-11",
    worst.fall > T.falling_red ? "red" : "amber",
    `Down ${pct(worst.fall)}% over ${n} cycles`,
    `Pay from ${worst.s.payer} has fallen ${pct(worst.fall)}% over the last ${n} cycles`,
    worst.last,
  );
}

// INC-12 Interruptions in a regular cadence (N-14).
/**
 * The pays missed over the last `months`: the day each was expected, its stream, and the
 * stream's median pay. INC-12 reports them over its 6 months; INC-09 names those that fall in its
 * trough months (8 November 2026 ruling, replacing the 7 November add-back).
 */
type Missed = { day: number; stream: TypedStream };
/** The same calendar day `n` months after `day`, clamped to a shorter month's end. */
const monthsAfter = (day: number, n: number) => lookbackStart(isoOf(day), -n) - 1;
function missedPays(c: Ctx, months: number): Missed[] {
  const since = lookbackStart(isoOf(c.end), months);
  const out: Missed[] = [];
  for (const s of c.streams.filter((x) => x.type !== "gig_platform")) {
    const days = s.credits.map((x) => x.day);
    // Fix 2 (re-review at cfa9d4f): a missed pay is dated to its expected day, and a monthly pay
    // keeps its day of the month, so a pay due on 1 September is a September miss.
    const expected = (from: number, j: number) =>
      s.cadence === "monthly" ? monthsAfter(from, j) : Math.round(from + s.cycle_days * j);
    days.forEach((d, i) => {
      const prev = days[i - 1];
      if (prev === undefined || d - prev <= s.cycle_days * 1.5) return;
      const k = Math.round((d - prev) / s.cycle_days) - 1;
      for (let j = 1; j <= k; j++) out.push({ day: expected(prev, j), stream: s });
    });
    const overdue = Math.floor((c.end - s.last - s.cycle_days * 0.5) / s.cycle_days);
    for (let j = 1; j <= overdue; j++) out.push({ day: expected(s.last, j), stream: s });
  }
  return out.filter((m) => m.day >= since).sort((a, b) => a.day - b.day);
}

function inc12(c: Ctx): Out {
  const since = lookbackStart(isoOf(c.end), T.interruption_window_months);
  const regular = c.streams.filter((s) => s.type !== "gig_platform");
  const missed = missedPays(c, T.interruption_window_months).map((m) => m.day);
  const recent = missed.some((d) => d >= c.end - T.interruption_recent_days);
  const state = missed.length >= 2 || recent ? "red" : missed.length === 1 ? "amber" : "green";
  // 8 November 2026 ruling, with the cfa9d4f fixes: only when INC-09 is amber or red, name each
  // trough month that holds a missed pay, and add that month's transactions to the evidence.
  const linked = c.inc09Fires ? crossReferenced(c) : [];
  const linkedMonths = [...new Map(linked.map((x) => [monthOf(x.month), x.month])).values()];
  // Each of INC-09's 12 months ends on the as-of date's day, so a month is named by its dates: a
  // label like "2025-12" would point at the wrong calendar month (closing check, 8 November).
  const troughLinks = linkedMonths.map(
    (m) => `${isoOf(m.from)} to ${isoOf(m.to)} is a trough month in INC-09`,
  );
  const base = creditsOf(regular).filter((x) => x.day >= since);
  const seen = new Set(base.map((x) => x.transactionId));
  const monthLines: Credit[] = c.feed.accounts.flatMap((a) =>
    a.transactions
      .map((t) => ({
        day: dayOf(t.postingDateTime ?? t.valueDateTime ?? ""),
        amount: Number(t.amount),
        transactionId: t.transactionId,
        account: a.account.accountId,
      }))
      .filter(
        (t) =>
          !seen.has(t.transactionId) && linkedMonths.some((m) => t.day >= m.from && t.day <= m.to),
      ),
  );
  return out(
    "INC-12",
    state,
    `${missed.length} missed cycle${missed.length === 1 ? "" : "s"}`,
    missed.length === 0
      ? "No missed pay cycles in the last 6 months"
      : [
          `Pay was expected but not received around ${missed.map(isoOf).join(", ")}`,
          ...troughLinks,
        ].join(". "),
    [...base, ...monthLines].sort(
      (a, b) => a.day - b.day || (a.transactionId < b.transactionId ? -1 : 1),
    ),
  );
}

// INC-13 Pay-cycle change: a new cadence or a new payer in the last 90 days (N-14).
function inc13(c: Ctx): Out {
  const since = c.end - T.change_window_days;
  const salary = c.streams.filter((s) => SALARY_LIKE.has(s.type));
  type Change = { what: string; before: number; after: number; credits: Credit[] };
  const changes: Change[] = [];
  for (const s of salary) {
    const recent = s.credits.filter((x) => x.day >= since);
    const older = s.credits.filter((x) => x.day < since);
    if (recent.length >= 3 && older.length >= 3) {
      const was = bandOf(median(gapsOf(older)));
      const now = bandOf(median(gapsOf(recent)));
      if (was && now && was[0] !== now[0])
        changes.push({
          what: `${s.payer} moved from ${was[0]} to ${now[0]} pay`,
          before: median(older.map((x) => x.amount)) * was[3],
          after: median(recent.map((x) => x.amount)) * now[3],
          credits: recent,
        });
    }
    if (s.first >= since && s.first - c.dataStart >= 30) {
      const before = monthlyOf(salary.filter((o) => o !== s && o.first < s.first));
      const after = monthlyOf(salary.filter((o) => c.end - o.last <= o.cycle_days * 1.5));
      changes.push({
        what: `${s.payer} first paid on ${isoOf(s.first)}`,
        before,
        after,
        credits: s.credits,
      });
    }
  }
  if (changes.length === 0)
    return out(
      "INC-13",
      "green",
      "No change",
      "No change in pay cycle or payer in the last 90 days",
      [],
    );
  const falls = changes.map((ch) => (ch.before > 0 ? round(1 - ch.after / ch.before) : 0));
  const fall = Math.max(...falls);
  return out(
    "INC-13",
    fall > T.change_pay_fall ? "red" : "amber",
    fall > T.change_pay_fall ? `Changed, pay down ${pct(fall)}%` : "Changed",
    changes.map((ch) => ch.what).join("; ") +
      (fall > T.change_pay_fall ? `, with pay down ${pct(fall)}%` : ""),
    changes.flatMap((ch) => ch.credits).sort((a, b) => a.day - b.day),
  );
}

const EVALUATORS = [
  inc01,
  inc02,
  inc03,
  inc04,
  inc05,
  inc06,
  inc07,
  inc08,
  inc09,
  inc10,
  inc11,
  inc12,
  inc13,
];

const EXCLUSION_STEPS: Record<keyof Streams["excluded"], string> = {
  own_account_transfer: "Excluded: own-account transfers",
  refund: "Excluded: refunds",
  advance_or_loan: "Excluded: advances and loans",
  interest: "Excluded: interest",
  repayment_received: "Excluded: repayments received",
  not_a_transaction_account: "Excluded: not a transaction account",
};

export function assessInc(input: IncInput): IncResult {
  const config: IncConfig = { ...INC_DEFAULTS, ...input.config } as IncConfig;
  // GR-3: sensitive spending is removed before anything is read.
  const feed = withoutSensitive(input.feed, input.categories);
  const evidence: EvidenceContext = assessEvidence({
    feed,
    feed_type: input.feed_type,
    as_of: input.as_of,
    ...(input.lookback_months === undefined ? {} : { lookback_months: input.lookback_months }),
  });
  const found = streamsOf(feed, input.as_of, config);
  const days = feed.accounts.flatMap((a) =>
    a.transactions.map((t) => dayOf(t.postingDateTime ?? t.valueDateTime ?? "")),
  );
  const ctx: Ctx = {
    end: dayOf(input.as_of),
    dataStart: Math.min(...days.filter(Number.isFinite)),
    lookback: evidence.lookback_months,
    app: input.application ?? {},
    config,
    streams: found.streams,
    feed,
    gross_up: input.gross_up ?? null,
    inc09Fires: false,
  };

  // Missing inputs (N-13) are capped by the evidence-quality layer under EQ-R4 (SIG-41 ruling 4).
  const finalise = (outs: Out[]): Signal[] =>
    applyEvidence(
      outs.map((o) => o.raw),
      evidence,
    );
  // INC-09's final state decides whether INC-12 cross-references it (fix 3, cfa9d4f).
  const inc09State = finalise([inc09(ctx)])[0]?.state;
  ctx.inc09Fires = inc09State === "amber" || inc09State === "red";
  const signals = finalise(EVALUATORS.map((evaluate) => evaluate(ctx)));

  const income = found.streams.map((s) => {
    const shading = config.shading[s.type];
    return {
      payer: s.payer,
      cadence: s.cadence,
      observed_amount: s.monthly,
      type: s.type,
      shading,
      assessed_amount: round(s.monthly * shading),
    };
  });
  const assessed = round(sum(income.map((r) => r.assessed_amount)));
  return {
    version: INC_VERSION,
    signals,
    income,
    net_monthly: found.net_monthly,
    assessed_monthly: assessed,
    trace: [
      { step: "Income streams", value: found.streams.length },
      { step: "Observed net monthly income", value: found.net_monthly },
      { step: "Assessed monthly income, after shading", value: assessed },
      ...Object.entries(EXCLUSION_STEPS).map(([key, step]) => ({
        step,
        value: found.excluded[key as keyof Streams["excluded"]],
      })),
    ],
  };
}
