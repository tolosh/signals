// Family 3 LIA: hidden and stacked credit, LIA-01 to LIA-06 (SIG-42; Product Specification §7.2,
// Amendment 2 §4.2 and LIA-R1). LIA-01 is built on SIG-18's detector at 1.0.0, as the experiment
// left it (Supported on synthetic set v1 only; H2 open on realistic data). Every output passes
// through the evidence-quality layer (SIG-39), so absence is never proof (EQ-R2). Interpretations
// L-1 to L-8 are in docs/adr/0006-lia-family.md, ruled 8 November 2026 (SIG-42) with two changes:
// keywords match whole words only, and three thresholds are candidate workspace defaults (1.1.0).
// Pure: categories and the application are inputs; no clock, no randomness, relative imports (D3).
import { applyEvidence, assessEvidence } from "../../evidence/index.js";
import { dayOf, isoOf } from "../../evidence/dates.js";
import type { FeedTransaction, RawSignal, Signal } from "../../evidence/index.js";
import type { FeedType } from "../../signals/definitions.js";
import {
  detectLiabilities,
  LIABILITY_METHOD_VERSION,
  normaliseProvider,
  type DeclaredLiability,
  type DetectedLiability,
} from "../../liabilities/index.js";

export const LIA_VERSION = "1.1.0";

/** A shared-account feed with the fields both the evidence layer and the detector read. */
export type LiaFeed = {
  accounts: {
    account: { accountId: string; productCategory?: string; productName?: string };
    detail?: { data?: { bsb?: string; accountNumber?: string } };
    transactions: (FeedTransaction & { billerName?: string })[];
  }[];
};
export type LiaApplication = {
  declared_liabilities: DeclaredLiability[];
  /** The affordability engine's assessed surplus (6.5); LIA-01 red needs it (L-1). */
  assessed_surplus_monthly?: number | null;
};
export type LiaConfig = {
  /** SIG-18's pre-registered primary configuration. */
  min_occurrences: number;
  amount_tolerance: number;
  /** LIA-02: the stacking window, in days. */
  stacking_window_days: number;
  /** LIA-03: SACC repayments this recent are red; the signal looks back this many months. */
  sacc_recent_days: number;
  sacc_lookback_months: number;
  /** LIA-04 red: at least this many advances in the last 90 days, at most this far apart. */
  advance_cycle_min: number;
  advance_cycle_max_gap_days: number;
  /** LIA-05: providers for amber and red, and the rise that makes outflow "rising" (candidate). */
  bnpl_amber_providers: number;
  bnpl_red_providers: number;
  bnpl_rising: number;
  /** LIA-06: a monthly mean this large is red, and a rise this large is "increasing" (candidates). */
  private_large_monthly: number;
  private_increasing: number;
};
export const LIA_DEFAULTS: Readonly<LiaConfig> = Object.freeze({
  min_occurrences: 3,
  amount_tolerance: 0.15,
  stacking_window_days: 90,
  sacc_recent_days: 90,
  sacc_lookback_months: 12,
  advance_cycle_min: 3,
  advance_cycle_max_gap_days: 35,
  bnpl_amber_providers: 2,
  bnpl_red_providers: 3,
  bnpl_rising: 0.25,
  private_large_monthly: 500,
  private_increasing: 0.25,
});

/**
 * Workspace defaults the specifications don't give, ruled as candidates each lender can change
 * (SIG-42 ruling 2, 8 November 2026), as for INC's income_signals.
 */
export const LIA_CANDIDATES = Object.freeze([
  "bnpl_rising",
  "private_large_monthly",
  "private_increasing",
] as const);

/** The contract's PolicyInput.liability_signals (1.8.0), as a lender saves it. */
export type LiabilitySignalsPolicy = Partial<Record<(typeof LIA_CANDIDATES)[number], number>>;

/**
 * Maps a lender's liability_signals policy onto the LIA config. The names are the contract's; a
 * field the policy leaves out keeps the workspace default.
 */
export function liaConfigFromPolicy(
  signals: LiabilitySignalsPolicy | null | undefined,
): Partial<LiaConfig> {
  const out: Partial<LiaConfig> = {};
  if (!signals) return out;
  for (const field of LIA_CANDIDATES) {
    const value = signals[field];
    if (value !== undefined) out[field] = value;
  }
  return out;
}

export type LiaInput = {
  feed: LiaFeed;
  feed_type: FeedType;
  as_of: string;
  lookback_months?: number;
  /** Enrich category by transaction id. */
  categories: Readonly<Record<string, string>>;
  application: LiaApplication;
  config?: Partial<LiaConfig>;
};
export type LiaResult = {
  version: string;
  detector: { method_version: string; min_occurrences: number; amount_tolerance: number };
  signals: Signal[];
  liabilities: DetectedLiability[];
};

type Line = {
  id: string;
  account: string;
  day: number;
  amount: number;
  t: LiaFeed["accounts"][number]["transactions"][number];
};
const BSB_NUMBER = /\b\d{3}-?\d{3}\s+\d{6,10}\b/;
// Keywords match whole words only, case-insensitively (the text is upper-cased first), so OWEN,
// LOANS4U and BIOU don't match (SIG-42 ruling 1). test/families/lia/rulings.test.ts pins each.
const DISBURSEMENT = /\b(LOAN|DISBURSEMENT|DRAWDOWN)\b/;
const PRIVATE_REPAYMENT = /\b(LOAN|REPAY|REPAYMENT|OWED|OWE|IOU)\b/;
const EXTRA_WORDS = new Set([
  "DISBURSEMENT",
  "DRAWDOWN",
  "FUNDS",
  "ADVANCE",
  "TRANSFER",
  "TO",
  "FROM",
]);
const providerOf = (text: string) =>
  normaliseProvider(text)
    .split(" ")
    .filter((w) => w && !EXTRA_WORDS.has(w))
    .join(" ");
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const round2 = (x: number) => Math.round(x * 100) / 100;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length === 0
    ? 0
    : s.length % 2
      ? (s[m] as number)
      : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

function raw(
  id: string,
  state: RawSignal["state"],
  value: string | null,
  reason: string,
  lines: Line[],
  over: Partial<RawSignal> = {},
): RawSignal {
  const days = lines.map((l) => l.day).sort((a, b) => a - b);
  const first = days[0];
  const last = days[days.length - 1];
  return {
    id,
    state,
    value,
    reason,
    confidence: "high",
    nothing_found: false,
    evidence: {
      account_ids: [...new Set(lines.map((l) => l.account))].sort(),
      transaction_count: lines.length,
      ...(first !== undefined && last !== undefined
        ? { period_start: isoOf(first), period_end: isoOf(last) }
        : {}),
    },
    enrich_confident_pct: null,
    unrecognised_adverse: 0,
    ...over,
  };
}
const nothing = (id: string, reason: string): RawSignal => ({
  ...raw(id, "green", null, reason, []),
  nothing_found: true,
});

export function assessLia(input: LiaInput): LiaResult {
  const cfg: LiaConfig = { ...LIA_DEFAULTS, ...input.config };
  const lookback = input.lookback_months ?? 6;
  const ctx = assessEvidence({
    feed: input.feed,
    feed_type: input.feed_type,
    as_of: input.as_of,
    lookback_months: lookback,
  });
  const end = dayOf(input.as_of);
  const windowStart = dayOf(ctx.window.start);
  const lines: Line[] = input.feed.accounts
    .filter(
      (a) =>
        (a.account.productCategory ?? "TRANS_AND_SAVINGS_ACCOUNTS") ===
        "TRANS_AND_SAVINGS_ACCOUNTS",
    )
    .flatMap((a) =>
      a.transactions.map((t) => ({
        id: t.transactionId,
        account: a.account.accountId,
        day: dayOf(t.postingDateTime ?? t.valueDateTime ?? ""),
        amount: Number(t.amount),
        t,
      })),
    )
    .filter((l) => Number.isFinite(l.day) && l.day <= end && !BSB_NUMBER.test(l.t.description));
  const cat = (l: Line) => input.categories[l.id] ?? "";
  const inWindow = (l: Line) => l.day >= windowStart;

  // LIA-01 Undisclosed liabilities (L-1): SIG-18's detector, then the assessed surplus.
  const detected = detectLiabilities({
    feed: input.feed,
    categories: input.categories,
    declared: input.application.declared_liabilities,
    as_of: input.as_of,
    min_occurrences: cfg.min_occurrences,
    amount_tolerance: cfg.amount_tolerance,
  });
  const caveat =
    "Detection rests on lender names in the narratives (tested on synthetic, template-written data only) and matches the application by exact provider name only; check each item against the application";
  const byId = new Map(lines.map((l) => [l.id, l]));
  const lia01Lines = detected.undisclosed.flatMap((d) =>
    d.evidence.map((e) => byId.get(e)).filter((l): l is Line => l !== undefined),
  );
  const undisclosedMonthly = round2(sum(detected.undisclosed.map((d) => d.monthly ?? 0)));
  const surplus = input.application.assessed_surplus_monthly ?? null;
  const lia01: RawSignal =
    detected.liabilities.length === 0
      ? {
          ...nothing(
            "LIA-01",
            `No loan or card account, and no recurring repayment to a lender, was found. ${caveat}`,
          ),
          confidence: "medium",
        }
      : detected.undisclosed.length === 0
        ? raw(
            "LIA-01",
            "green",
            `${detected.liabilities.length} found, all declared`,
            `Every liability found is in the application. ${caveat}`,
            [],
            { confidence: "medium" },
          )
        : raw(
            "LIA-01",
            surplus !== null && surplus - undisclosedMonthly < 0 ? "red" : "amber",
            `${detected.undisclosed.length} undisclosed`,
            `${detected.undisclosed.map((d) => `${d.provider} (${d.family.replace("_", " ")}${d.monthly ? `, $${d.monthly} a month` : ""})`).join("; ")} found but not in the application` +
              (surplus !== null && surplus - undisclosedMonthly < 0
                ? `; the repayments move the assessed surplus of $${surplus} below zero`
                : "") +
              `. ${caveat}`,
            lia01Lines,
            {
              confidence: "medium",
              review_reason: "A liability in the shared data is missing from the application",
              resolve_with: detected.undisclosed.map(
                (d) =>
                  `The applicant's confirmation of the ${d.provider} ${d.family.replace("_", " ")}, added to the application`,
              ),
            },
          );

  // LIA-02 Loan stacking (L-2): disbursement credits from lenders.
  const lenderProviders = new Set(
    detected.liabilities
      .filter((d) => d.family === "loan" || d.family === "sacc")
      .map((d) => d.provider),
  );
  const disbursements = lines.filter(
    (l) =>
      inWindow(l) &&
      l.amount > 0 &&
      (DISBURSEMENT.test(l.t.description.toUpperCase()) ||
        lenderProviders.has(providerOf(l.t.description))),
  );
  const recent = disbursements.filter((l) => l.day > end - cfg.stacking_window_days);
  const recentLenders = new Set(recent.map((l) => providerOf(l.t.description)));
  const lia02 =
    disbursements.length === 0
      ? nothing("LIA-02", "No disbursement from a lender was found")
      : raw(
          "LIA-02",
          recentLenders.size >= 2 ? "red" : recent.length >= 1 ? "amber" : "green",
          `${recentLenders.size} lender${recentLenders.size === 1 ? "" : "s"} in ${cfg.stacking_window_days} days`,
          recentLenders.size >= 2
            ? `Disbursements from ${recentLenders.size} lenders in the last ${cfg.stacking_window_days} days: ${[...recentLenders].join(", ")}`
            : recent.length >= 1
              ? `A disbursement from ${[...recentLenders].join(", ")} in the last ${cfg.stacking_window_days} days`
              : `Disbursements found, none in the last ${cfg.stacking_window_days} days`,
          disbursements,
        );

  // LIA-03 Payday and SACC (L-3): repayments categorised sacc_loan, over 12 months.
  const saccStart = Math.min(windowStart, end - Math.round(cfg.sacc_lookback_months * 30.4375));
  const sacc = lines.filter((l) => l.day >= saccStart && l.amount < 0 && cat(l) === "sacc_loan");
  const saccBy = new Map<string, Line[]>();
  for (const l of sacc)
    saccBy.set(providerOf(l.t.description), [
      ...(saccBy.get(providerOf(l.t.description)) ?? []),
      l,
    ]);
  const spans = [...saccBy.values()].map(
    (ls) => [Math.min(...ls.map((l) => l.day)), Math.max(...ls.map((l) => l.day))] as const,
  );
  const concurrent = spans.some((a, i) =>
    spans.some((b, j) => j > i && a[0] <= b[1] && b[0] <= a[1]),
  );
  const saccRecent = sacc.some((l) => l.day > end - cfg.sacc_recent_days);
  const lia03 =
    sacc.length === 0
      ? nothing("LIA-03", "No payday or SACC repayment was found in 12 months")
      : raw(
          "LIA-03",
          saccRecent || concurrent ? "red" : "amber",
          `${saccBy.size} provider${saccBy.size === 1 ? "" : "s"}`,
          saccRecent
            ? `SACC repayments to ${[...saccBy.keys()].join(", ")} in the last ${cfg.sacc_recent_days} days`
            : concurrent
              ? `Repayments to ${saccBy.size} SACC lenders at the same time: ${[...saccBy.keys()].join(", ")}`
              : `SACC repayments to ${[...saccBy.keys()].join(", ")} in the last 12 months`,
          sacc,
        );

  // LIA-04 Wage advance (L-4): advance credits from a provider whose repayments are wage_advance.
  const advanceProviders = new Set(
    lines
      .filter((l) => l.amount < 0 && cat(l) === "wage_advance")
      .map((l) => providerOf(l.t.description)),
  );
  const advances = lines.filter(
    (l) => inWindow(l) && l.amount > 0 && advanceProviders.has(providerOf(l.t.description)),
  );
  const advanceRepayments = lines.filter(
    (l) => inWindow(l) && l.amount < 0 && cat(l) === "wage_advance",
  );
  const last90 = advances
    .filter((l) => l.day > end - 90)
    .map((l) => l.day)
    .sort((a, b) => a - b);
  const everyCycle =
    last90.length >= cfg.advance_cycle_min &&
    median(last90.slice(1).map((d, i) => d - (last90[i] as number))) <=
      cfg.advance_cycle_max_gap_days;
  const lia04 =
    advances.length === 0 && advanceRepayments.length === 0
      ? nothing("LIA-04", "No wage advance was found")
      : raw(
          "LIA-04",
          everyCycle ? "red" : "amber",
          `${advances.length} advance${advances.length === 1 ? "" : "s"}`,
          everyCycle
            ? `A wage advance about every pay cycle: ${last90.length} in the last 90 days`
            : `Occasional wage advances: ${advances.length} in the window`,
          [...advances, ...advanceRepayments],
        );

  // LIA-05 BNPL (L-5): distinct providers and monthly outflow.
  const bnpl = lines.filter((l) => inWindow(l) && l.amount < 0 && cat(l) === "bnpl");
  const bnplProviders = new Set(bnpl.map((l) => providerOf(l.t.description)));
  const outflow = (from: number, to: number) =>
    -sum(
      lines
        .filter((l) => l.amount < 0 && cat(l) === "bnpl" && l.day > from && l.day <= to)
        .map((l) => l.amount),
    );
  const nowOut = outflow(end - 90, end);
  const priorOut = outflow(end - 180, end - 90);
  const rising = priorOut > 0 && nowOut > priorOut * (1 + cfg.bnpl_rising);
  const lia05 =
    bnpl.length === 0
      ? nothing("LIA-05", "No BNPL repayment was found")
      : raw(
          "LIA-05",
          bnplProviders.size >= cfg.bnpl_red_providers || rising
            ? "red"
            : bnplProviders.size >= cfg.bnpl_amber_providers
              ? "amber"
              : "green",
          `${bnplProviders.size} provider${bnplProviders.size === 1 ? "" : "s"}, $${round2(nowOut / 3)} a month`,
          `${[...bnplProviders].join(", ")}; $${round2(nowOut)} in the last 90 days` +
            (rising ? `, up from $${round2(priorOut)} in the 90 days before` : ""),
          bnpl,
        );

  // LIA-06 Private loans (L-6): repeat transfers to an individual with a repayment reference.
  const privateLines = lines.filter(
    (l) =>
      inWindow(l) &&
      l.amount < 0 &&
      !cat(l) &&
      /^TRANSFER/.test(l.t.type) &&
      PRIVATE_REPAYMENT.test(`${l.t.description} ${l.t.reference ?? ""}`.toUpperCase()),
  );
  const privateBy = new Map<string, Line[]>();
  for (const l of privateLines)
    privateBy.set(providerOf(l.t.description), [
      ...(privateBy.get(providerOf(l.t.description)) ?? []),
      l,
    ]);
  const repeated = [...privateBy.values()].filter((ls) => ls.length >= 2);
  const repeatedLines = repeated.flat();
  const monthlyMean = -sum(repeatedLines.filter((l) => l.day > end - 90).map((l) => l.amount)) / 3;
  const increasing = repeated.some((ls) => {
    const byDay = [...ls].sort((a, b) => a.day - b.day);
    const firstAmt = -(byDay[0]?.amount ?? 0);
    const lastAmt = -(byDay[byDay.length - 1]?.amount ?? 0);
    return firstAmt > 0 && lastAmt > firstAmt * (1 + cfg.private_increasing);
  });
  const lia06 =
    repeated.length === 0
      ? nothing(
          "LIA-06",
          "No repeat transfer to an individual with a repayment reference was found",
        )
      : raw(
          "LIA-06",
          monthlyMean >= cfg.private_large_monthly || increasing ? "red" : "amber",
          `$${round2(monthlyMean)} a month`,
          `Repeat transfers with a repayment reference to ${repeated.length} payee${repeated.length === 1 ? "" : "s"}` +
            (increasing
              ? ", increasing"
              : monthlyMean >= cfg.private_large_monthly
                ? ", large"
                : ""),
          repeatedLines,
        );

  return {
    version: LIA_VERSION,
    detector: {
      method_version: LIABILITY_METHOD_VERSION,
      min_occurrences: cfg.min_occurrences,
      amount_tolerance: cfg.amount_tolerance,
    },
    signals: applyEvidence([lia01, lia02, lia03, lia04, lia05, lia06], ctx),
    liabilities: detected.liabilities,
  };
}
