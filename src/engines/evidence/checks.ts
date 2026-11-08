// Assessment-level checks EQ-01 to EQ-03 (Amendment 2, EQ-R3; D20). Interpretations E-2 to E-6 are
// in docs/adr/0002-evidence-quality-interpretations.md. The checks run before any family
// and return pass, partial or fail. Thresholds for EQ-03 are Amendment 2's; the EQ-02
// "regular and material" test is interpretation E-2, recorded on SIG-39 for ruling.
import { DEFINITIONS_VERSION } from "../signals/definitions.js";
import { withoutSensitive } from "../sensitive.js";
import { DAYS_PER_MONTH, dayOf, isoOf, lookbackStart } from "./dates.js";
import type { EvidenceCheck, EvidenceContext, EvidenceInput, FeedTransaction } from "./types.js";

export const EQ_THRESHOLDS = Object.freeze({
  /** EQ-03: share of the lookback window returned (Amendment 2 §2). */
  window_pass: 0.9,
  window_partial: 0.6,
  /** EQ-01: a recurring stream has at least this many credits, at most this far apart. */
  income_min_occurrences: 3,
  income_max_median_gap_days: 35,
  income_min_mean_amount: 100,
  /** EQ-02 (E-2, ruled D23): regular means in 3 or more calendar months. */
  transfer_regular_months: 3,
  /** EQ-02 (E-2): material means a monthly mean of at least 5% of observed recurring income... */
  transfer_material_income_share: 0.05,
  /** ...or, when no recurring income is observed, at least this many dollars a month. */
  transfer_material_floor: 250,
  /** EQ-R4 (E-4): a signal's history is met at 90% of its stated months, as for EQ-03. */
  history_tolerance: 0.9,
  /**
   * EQ-03 gaps (SIG-55, E-10, ruled 8 November 2026; all three are candidates): a silence between
   * active days is a gap when it is longer than gap_min_days and more than gap_rhythm_multiple
   * times each adjacent silence, so a change of cadence (fortnightly to monthly pay) is not read
   * as missing data; and, from method 3, any silence longer than gap_ceiling_days is a gap
   * whatever its neighbours, so two long holes side by side are both found.
   */
  gap_min_days: 21,
  gap_rhythm_multiple: 1.5,
  gap_ceiling_days: 60,
});

/**
 * The EQ method version (EQ-R6). Version 2 (SIG-55) measures EQ-03 by the days covered; version 3
 * (SIG-55 ruling, E-10) adds the 60-day ceiling.
 */
export const EQ_METHOD_VERSION = 4;

/** "062-000 123456" or "062000 123456": a BSB and account number in a transfer narrative. */
const BSB_NUMBER = /\b(\d{3})-?(\d{3})\s+(\d{6,10})\b/;
/** Credits that are never income (AF-I5, INC-R2): advances, loans, refunds, card and loan
 * repayments received, and interest. Provider names are the common Australian ones. */
const NOT_INCOME =
  /ADVANCE|LOAN|REFUND|REVERSAL|INTEREST|PAYMENT RECEIVED|REPAYMENT RECEIVED|CASHBACK|BEFOREPAY|MYPAYNOW|CASHD|AFTERPAY|ZIP ?PAY|ZIP ?MONEY|HUMM|KLARNA|NIMBLE|WALLET WIZARD|CASH CONVERTERS/;
const TRANSACTION_ACCOUNTS = "TRANS_AND_SAVINGS_ACCOUNTS";

type Line = {
  account: string;
  category: string | undefined;
  day: number;
  cents: number;
  t: FeedTransaction;
};

const cents = (amount: string) => Math.round(Number(amount) * 100);
const pct = (x: number) => Math.round(x * 100);
const round1 = (x: number) => Math.round(x * 10) / 10;
const payerKey = (description: string) =>
  description
    .toUpperCase()
    .replace(/[^A-Z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** D22: the default request, and the least a lender may request. */
export const DEFAULT_LOOKBACK_MONTHS = 6;
export const MIN_LOOKBACK_MONTHS = 3;

export function assessEvidence(input: EvidenceInput): EvidenceContext {
  // GR-3: sensitive spending is removed before anything is read.
  const feed = withoutSensitive(input.feed, input.categories);
  const lookback = input.lookback_months ?? DEFAULT_LOOKBACK_MONTHS;
  if (!Number.isInteger(lookback) || lookback < MIN_LOOKBACK_MONTHS)
    throw new Error(`The requested lookback must be at least 3 months (D22); got ${lookback}`);
  const end = dayOf(input.as_of);
  const start = lookbackStart(input.as_of, lookback);
  const windowDays = end - start + 1;

  const lines: Line[] = feed.accounts.flatMap((acc) =>
    acc.transactions
      .map((t) => ({
        account: acc.account.accountId,
        category: acc.account.productCategory,
        day: dayOf(t.postingDateTime ?? t.valueDateTime ?? ""),
        cents: cents(t.amount),
        t,
      }))
      .filter((l) => Number.isFinite(l.day) && l.day <= end),
  );
  const inWindow = lines.filter((l) => l.day >= start);
  const earliest = lines.reduce((m, l) => Math.min(m, l.day), Infinity);
  const firstInWindow = inWindow.reduce((m, l) => Math.min(m, l.day), Infinity);
  const lastInWindow = inWindow.reduce((m, l) => Math.max(m, l.day), -Infinity);
  const eqVersion = input.eq_version ?? EQ_METHOD_VERSION;
  // EQ-03 coverage. Version 1 (E-4): from the first transaction in the window to the as-of date.
  // Version 2 (SIG-55): the same, less every silence longer than the gap threshold, measured
  // across the whole feed (E-9). A silence is judged against its neighbours (E-10). Version 3
  // (E-10 as ruled): a silence over the 60-day ceiling is a gap whatever its neighbours.
  const activeDays = [...new Set(inWindow.map((l) => l.day))].sort((a, b) => a - b);
  // Each silence runs from one active day to the next; the last runs to the as-of date.
  const silences: { from: number; to: number; days: number }[] = activeDays.map((d, i) => {
    const next = activeDays[i + 1] ?? end + 1;
    return { from: d + 1, to: next - 1, days: next - d };
  });
  const gaps: { from: number; to: number }[] = [];
  if (eqVersion >= 2)
    silences.forEach((sil, i) => {
      const neighbours = [silences[i - 1]?.days, silences[i + 1]?.days].filter(
        (n): n is number => n !== undefined,
      );
      const relative =
        sil.days > EQ_THRESHOLDS.gap_min_days &&
        neighbours.every((n) => sil.days > EQ_THRESHOLDS.gap_rhythm_multiple * n);
      const ceiling = eqVersion >= 3 && sil.days > EQ_THRESHOLDS.gap_ceiling_days;
      const isGap = sil.to >= sil.from && (relative || ceiling);
      if (isGap) gaps.push({ from: sil.from, to: sil.to });
    });
  const gapDays = gaps.reduce((s, g) => s + (g.to - g.from + 1), 0);
  // The span returned, as before: EQ-01 and EQ-02 average over it. Only EQ-03's share
  // subtracts the gaps.
  const spanDays = Number.isFinite(firstInWindow) ? end - firstInWindow + 1 : 0;
  const coveredDays = Math.max(0, spanDays - gapDays);
  const coveredMonths = spanDays / DAYS_PER_MONTH;
  const history = Number.isFinite(earliest) ? round1((end - earliest + 1) / DAYS_PER_MONTH) : 0;

  // Own-account transfers: matched by BSB and account number where the narrative carries them;
  // otherwise a debit and a credit of the same amount on the same day in two shared accounts.
  const sharedKeys = new Set(
    feed.accounts
      .map((a) => `${a.detail?.data?.bsb ?? ""}${a.detail?.data?.accountNumber ?? ""}`)
      .filter((k) => k.length > 6),
  );
  const sharedBanks = new Set(
    feed.accounts.map((a) => (a.detail?.data?.bsb ?? "").slice(0, 2)).filter(Boolean),
  );
  type Unmatched = { key: string; bank: string; last4: string; first: number; lines: Line[] };
  const unmatched = new Map<string, Unmatched>();
  const ownTransfer = new Set<Line>();
  for (const l of inWindow) {
    const m = BSB_NUMBER.exec(l.t.description);
    if (!m) continue;
    ownTransfer.add(l);
    const key = `${m[1] ?? ""}${m[2] ?? ""}${m[3] ?? ""}`;
    if (sharedKeys.has(key)) continue;
    const u = unmatched.get(key) ?? {
      key,
      bank: (m[1] ?? "").slice(0, 2),
      last4: (m[3] ?? "").slice(-4),
      first: l.day,
      lines: [],
    };
    u.lines.push(l);
    unmatched.set(key, u);
  }
  const debitsByDay = new Map<string, Line[]>();
  for (const l of inWindow)
    if (l.cents < 0) {
      const k = `${l.day}:${-l.cents}`;
      debitsByDay.set(k, [...(debitsByDay.get(k) ?? []), l]);
    }
  const internal = (l: Line) =>
    (debitsByDay.get(`${l.day}:${l.cents}`) ?? []).some((d) => d.account !== l.account);

  // EQ-01: a recurring income credit in a shared transaction account.
  const groups = new Map<string, Line[]>();
  for (const l of inWindow) {
    if (l.cents <= 0 || ownTransfer.has(l) || internal(l)) continue;
    if (l.category !== undefined && l.category !== TRANSACTION_ACCOUNTS) continue;
    const key = payerKey(l.t.description);
    if (NOT_INCOME.test(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const recurring = [...groups.values()].filter((g) => {
    if (g.length < EQ_THRESHOLDS.income_min_occurrences) return false;
    const days = g.map((l) => l.day).sort((a, b) => a - b);
    const gaps = days.slice(1).map((d, i) => d - (days[i] ?? d));
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? Infinity;
    const mean = g.reduce((s, l) => s + l.cents, 0) / g.length / 100;
    return (
      median <= EQ_THRESHOLDS.income_max_median_gap_days &&
      mean >= EQ_THRESHOLDS.income_min_mean_amount
    );
  });
  const incomeMonthly =
    coveredMonths > 0 ? recurring.flat().reduce((s, l) => s + l.cents, 0) / 100 / coveredMonths : 0;
  const incomeAccounts = [...new Set(recurring.flat().map((l) => l.account))].sort();
  const eq01: EvidenceCheck =
    recurring.length > 0
      ? {
          id: "EQ-01",
          name: "Income account present",
          result: "pass",
          detail: "A recurring income credit is in a shared account",
          resolve_with: [],
          review_required: false,
        }
      : {
          id: "EQ-01",
          name: "Income account present",
          result: "fail",
          detail: "No recurring salary or benefit credit is in a shared account",
          resolve_with: ["Connect the account your salary or benefit is paid into"],
          review_required: false,
        };

  // EQ-02: transfers to or from own accounts outside the grant.
  const regularMonths = EQ_THRESHOLDS.transfer_regular_months;
  const materialFloor =
    incomeMonthly > 0
      ? incomeMonthly * EQ_THRESHOLDS.transfer_material_income_share
      : EQ_THRESHOLDS.transfer_material_floor;
  const accounts = [...unmatched.values()].sort(
    (a, b) => a.first - b.first || (a.key < b.key ? -1 : 1),
  );
  const assessed = accounts.map((u) => {
    const months = new Set(u.lines.map((l) => isoOf(l.day).slice(0, 7))).size;
    const out = u.lines.filter((l) => l.cents < 0).reduce((s, l) => s - l.cents, 0);
    const inn = u.lines.filter((l) => l.cents > 0).reduce((s, l) => s + l.cents, 0);
    const monthly = (out + inn) / 100 / Math.max(coveredMonths, 1);
    return {
      u,
      failing: months >= regularMonths && monthly >= materialFloor,
      resolve: `Connect the account ${out >= inn ? "receiving" : "sending"} transfers ending ${u.last4}`,
    };
  });
  const failing = assessed.filter((a) => a.failing);
  const plural = (n: number) => `${n} account${n === 1 ? "" : "s"}`;
  const eq02: EvidenceCheck =
    failing.length > 0
      ? {
          id: "EQ-02",
          name: "Unmatched own-account transfers",
          result: "fail",
          detail: `Regular, material transfers with ${plural(failing.length)} outside the grant`,
          resolve_with: failing.map((a) => a.resolve),
          review_required: true,
        }
      : assessed.length > 0
        ? {
            id: "EQ-02",
            name: "Unmatched own-account transfers",
            result: "partial",
            detail: `Transfers with ${plural(assessed.length)} outside the grant, not material`,
            resolve_with: assessed.map((a) => a.resolve),
            review_required: false,
          }
        : {
            id: "EQ-02",
            name: "Unmatched own-account transfers",
            result: "pass",
            detail: "No transfers to or from accounts outside the grant",
            resolve_with: [],
            review_required: false,
          };

  // EQ-03: share of the lookback window the sync returned.
  const share = coveredDays / windowDays;
  const eq03: EvidenceCheck = {
    id: "EQ-03",
    name: "Window covered",
    result:
      share >= EQ_THRESHOLDS.window_pass
        ? "pass"
        : share >= EQ_THRESHOLDS.window_partial
          ? "partial"
          : "fail",
    detail:
      `The sync returned ${pct(share)}% of the ${lookback}-month lookback window` +
      gaps.map((g) => `. No transactions from ${isoOf(g.from)} to ${isoOf(g.to)}`).join(""),
    resolve_with:
      share >= EQ_THRESHOLDS.window_pass
        ? []
        : gaps.length > 0
          ? gaps.map((g) => `Share the full history from ${isoOf(g.from)} to ${isoOf(g.to)}`)
          : [`Share the full ${lookback} months of transaction history`],
    review_required: false,
  };

  // Reliability: how many purchase and bill debits carry structured merchant or biller fields.
  const spend = inWindow.filter(
    (l) => l.cents < 0 && !ownTransfer.has(l) && !l.t.type.startsWith("TRANSFER"),
  );
  const populated = spend.filter(
    (l) => l.t.merchantName ?? l.t.merchantCategoryCode ?? l.t.billerCode,
  ).length;

  return {
    definitions_version: DEFINITIONS_VERSION,
    eq_version: eqVersion,
    as_of: isoOf(end),
    lookback_months: lookback,
    window: { start: isoOf(start), end: isoOf(end) },
    period: inWindow.length > 0 ? { start: isoOf(firstInWindow), end: isoOf(lastInWindow) } : null,
    feed_type: input.feed_type,
    checks: [eq01, eq02, eq03],
    primary_income_account_shared: eq01.result === "pass",
    income_account_ids: incomeAccounts,
    shared_account_ids: feed.accounts.map((a) => a.account.accountId).sort(),
    transaction_count: inWindow.length,
    unshared_own_accounts: accounts.length,
    institutions_without_shared_account: new Set(
      accounts.map((a) => a.bank).filter((b) => !sharedBanks.has(b)),
    ).size,
    history_months_available: history,
    field_population_pct: spend.length > 0 ? pct(populated / spend.length) : null,
  };
}
