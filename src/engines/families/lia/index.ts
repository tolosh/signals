// Family 3 LIA: hidden and stacked credit, LIA-01 to LIA-06 (SIG-42; Product Specification §7.2,
// Amendment 2 §4.2 and LIA-R1). LIA-01 is built on SIG-18's detector at 1.0.0, as the experiment
// left it (Supported on synthetic set v1 only; H2 open on realistic data). Every output passes
// through the evidence-quality layer (SIG-39), so absence is never proof (EQ-R2). Interpretations
// L-1 to L-8 are in docs/adr/0006-lia-family.md, ruled 8 November 2026 (SIG-42) with two changes:
// keywords match whole words only, and three thresholds are candidate workspace defaults (1.1.0).
// 1.3.0 follows the short re-review at 11e2ef4 (Colin, 8 November 2026, 19:40): a fuzzy match to a
// declaration is amber "possibly declared", never green; strict matching (exact types, closest
// amount, one-to-one, duplicates removed); reasons name the lender, not the narrative (D29); LIA
// reads within the requested lookback (LIA-03 keeps 12 months); text is NFC before keywords.
// Pure: categories and the application are inputs; no clock, no randomness, relative imports (D3).
import { applyEvidence, assessEvidence, EQ_THRESHOLDS } from "../../evidence/index.js";
import { dayOf, isoOf } from "../../evidence/dates.js";
import type { FeedTransaction, RawSignal, Signal } from "../../evidence/index.js";
import { SENSITIVE_METHOD_VERSION, withoutSensitive } from "../../sensitive.js";
import type { FeedType } from "../../signals/definitions.js";
import {
  detectLiabilities,
  LIABILITY_METHOD_VERSION,
  normaliseProvider,
  type DeclaredLiability,
  type DetectedLiability,
} from "../../liabilities/index.js";

export const LIA_VERSION = "1.3.1";

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
  /**
   * LIA-06 is parked (SIG-42 review ruling 2): it returns unverified until Enrich supplies a
   * private-transfer category that excludes sensitive payees (ENR-30). "detect" runs the 1.1.0 rules,
   * for tests only; a lender's policy can't set it (liaConfigFromPolicy maps candidates only).
   */
  private_loans: "parked" | "detect";
  /** LIA-01's fallback: a declared repayment within this fraction matches (a candidate). */
  declared_amount_tolerance: number;
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
  private_loans: "parked",
  declared_amount_tolerance: 0.15,
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
  /** The GR-3 gate applied to the feed (SENSITIVE_METHOD_VERSION). */
  gr3_gate_version: string;
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
/**
 * The exact type of a liability found (re-review ruling 2: car, personal, card, BNPL, SACC,
 * mortgage and so on are all different types). The detector's "loan" family is split by what the
 * data says: the loan account's product name, or the repayments' narratives. A loan the data
 * doesn't type stays "loan", which matches only a declaration typed "loan".
 */
const LOAN_TYPES: readonly [string, RegExp][] = [
  ["car_loan", /\b(CAR|AUTO|VEHICLE|MOTOR)\b/],
  ["personal_loan", /\bPERSONAL\b/],
  ["mortgage", /\b(MORTGAGE|HOME LOAN)\b/],
];
export const LIA06_PARKED = "Private-loan detection is not yet supported on categorised data";
const BSB_NUMBER = /\b\d{3}-?\d{3}\s+\d{6,10}\b/;
/** Text for keyword matching: NFC first, so a combining accent joins its letter (1.3.0). */
const upper = (text: string) => text.normalize("NFC").toUpperCase();
// Keywords match whole words only, case-insensitively (the text is upper-cased first), so OWEN,
// LOANS4U and BIOU don't match (SIG-42 ruling 1). A word is a run of Unicode letters and digits:
// an underscore or punctuation separates words, and an accented letter is a letter, so LOAN_REPAY
// matches and JOSÉLOAN doesn't (review ruling 4). A combining mark counts as part of its letter
// too, after NFC (1.3.0). The tests in test/families/lia/ pin each case.
const keywords = (...words: string[]) =>
  new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(${words.join("|")})(?![\\p{L}\\p{M}\\p{N}])`, "u");
const DISBURSEMENT = keywords("LOAN", "DISBURSEMENT", "DRAWDOWN");
const PRIVATE_REPAYMENT = keywords("LOAN", "REPAY", "REPAYMENT", "OWED", "OWE", "IOU");
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
/**
 * D29 (review 9 ruling 3, 9 November 2026): text names only the lender, never the rest of the
 * bank's description ("MACQUARIE IVF CLINIC REF", "HUMM SMILE DENTAL"). Until there is a lender
 * register, the lender is the first word of the narrative, for every family (the interim rule
 * ruled for BNPL, ADR 0006). A liability known only from an account in the grant is named by the
 * account's product, which carries no merchant.
 */
const lenderOf = (provider: string) => provider.split(" ")[0] ?? provider;

/** Words that describe the product, not the lender: the detector's, plus the loan types. */
const GENERIC_WORDS = new Set([
  "loan",
  "loans",
  "repayment",
  "repayments",
  "instalment",
  "payment",
  "credit",
  "card",
  "bpay",
  "personal",
  "car",
  "auto",
  "vehicle",
  "motor",
  "mortgage",
  "home",
]);
/**
 * Review 9 ruling 2: a name for exact matching. NFC, then case folding; every digit, the legal
 * suffixes Pty Ltd, Pty, Ltd and Limited, and punctuation removed, with the product words above
 * on both sides (as the detector does). Letters stay letters, accents included, so ZÖP and Zíp
 * differ. A name with fewer than 3 letters left is never exact (null).
 */
export function exactName(text: string): string | null {
  const words = text
    .normalize("NFC")
    .toUpperCase()
    .toLowerCase()
    .replace(/\p{N}/gu, " ")
    .replace(/[^\p{L}\p{M}]+/gu, " ")
    .split(" ")
    .filter((w) => w && !GENERIC_WORDS.has(w) && w !== "pty" && w !== "ltd" && w !== "limited");
  const name = words.join(" ");
  return (name.match(/\p{L}/gu) ?? []).length >= 3 ? name : null;
}
/** The detector's credit categories: a line in one is named by its narrative, else its biller. */
const CREDIT_LINE_CATEGORIES = new Set(["loan_repayment", "bnpl", "sacc_loan", "wage_advance"]);
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
  // GR-3: sensitive spending is removed before anything is read, the detector included.
  const feed = withoutSensitive(input.feed, input.categories);
  const ctx = assessEvidence({
    feed,
    feed_type: input.feed_type,
    as_of: input.as_of,
    lookback_months: lookback,
  });
  const end = dayOf(input.as_of);
  const windowStart = dayOf(ctx.window.start);
  const inWindow = (l: { day: number }) => l.day >= windowStart;
  // Every line up to the as-of date; LIA-03 reads 12 months of these, the rest only the window.
  const allLines: Line[] = feed.accounts
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
  // 1.3.0 (re-review direction 7): LIA reads within the requested lookback.
  const lines = allLines.filter(inWindow);
  const cat = (l: Line) => input.categories[l.id] ?? "";
  const lineDay = (t: { postingDateTime?: string; valueDateTime?: string }) =>
    dayOf(t.postingDateTime ?? t.valueDateTime ?? "");
  const windowFeed = {
    ...feed,
    accounts: feed.accounts.map((a) => ({
      ...a,
      transactions: a.transactions.filter((t) => lineDay(t) >= windowStart),
    })),
  };

  // LIA-01 Undisclosed liabilities (L-1): SIG-18's detector, unchanged, on the window; then the
  // declaration fallback, strict from 1.3.0 (re-review ruling). A liability the detector couldn't
  // match by name is "possibly declared" when a declaration of exactly its type, not already
  // matched, has a repayment within declared_amount_tolerance of it. Duplicate declarations are
  // removed first; pairs are made closest amount first, one-to-one. A possible match is amber with
  // review: only an exact name (or, after SIG-57, an alias-table name) is green.
  const detected = detectLiabilities({
    feed: windowFeed,
    categories: input.categories,
    declared: input.application.declared_liabilities,
    as_of: input.as_of,
    min_occurrences: cfg.min_occurrences,
    amount_tolerance: cfg.amount_tolerance,
  });
  const caveat =
    "Detection rests on lender names in the narratives (tested on synthetic, template-written data only). Only an exact provider name counts as declared; a liability of a declared type and repayment under another name is possibly declared, to confirm with the applicant";
  const byId = new Map(allLines.map((l) => [l.id, l]));
  const productNames = new Map(
    feed.accounts.map((a) => [a.account.accountId, a.account.productName ?? ""]),
  );
  const typeOf = (d: DetectedLiability): string => {
    if (d.family !== "loan") return d.family;
    const text = upper(
      [
        ...d.account_ids.map((id) => productNames.get(id) ?? ""),
        ...d.evidence.map((id) => byId.get(id)?.t.description ?? ""),
      ].join(" "),
    );
    const types = LOAN_TYPES.filter(([, re]) => re.test(text)).map(([type]) => type);
    return types.length === 1 ? (types[0] as string) : "loan";
  };
  // Review 9 ruling 1: green needs the exact name AND the exact type. The detector's own match is
  // by family and its ASCII-only name, so it isn't used: every liability found is matched here.
  // A liability's name is the one its sources agree on: the account product, or each repayment's
  // narrative (its biller's name for a card repaid by BPAY). Sources that disagree give no name.
  const nameOfFound = (d: DetectedLiability): string | null => {
    const names = [
      ...d.account_ids
        .filter((id) => d.sources.includes("account") && productNames.has(id))
        .map((id) => productNames.get(id) ?? ""),
      ...d.evidence.map((id) => {
        const l = byId.get(id);
        if (!l) return "";
        return CREDIT_LINE_CATEGORIES.has(cat(l))
          ? l.t.description
          : (/^(.*?)CREDIT CARD/i.exec(l.t.billerName ?? "")?.[1] ?? "");
      }),
    ]
      .filter((t) => t !== "")
      .map(exactName);
    const first = names[0];
    return first !== undefined && first !== null && names.every((n) => n === first) ? first : null;
  };
  const seen = new Set<string>();
  const declaredList = input.application.declared_liabilities.flatMap((d, i) => {
    const exact = exactName(d.provider);
    const key = `${d.type}|${exact ?? `#${normaliseProvider(d.provider)}`}|${d.repayment_monthly ?? ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ i, d, exact }];
  });
  const used = new Set<number>();
  const exactly = new Set<DetectedLiability>();
  for (const l of detected.liabilities) {
    const name = nameOfFound(l);
    const x =
      name === null
        ? undefined
        : declaredList.find((y) => !used.has(y.i) && y.exact === name && y.d.type === typeOf(l));
    if (x) {
      used.add(x.i);
      exactly.add(l);
    }
  }
  const keyOf = (d: DetectedLiability) => `${d.family}|${d.provider}`;
  const rest = detected.liabilities.filter((l) => !exactly.has(l));
  // "Possibly declared" (amber, review): the exact name with another type (ruling 1), first; then
  // a declaration of exactly its type whose repayment is within tolerance. Closest amount first,
  // one-to-one, duplicates removed.
  const amountDiff = (l: DetectedLiability, d: DeclaredLiability) =>
    l.monthly !== null && d.repayment_monthly !== undefined
      ? Math.abs(l.monthly - d.repayment_monthly)
      : Number.MAX_SAFE_INTEGER;
  const pairs = rest.flatMap((l) => {
    const name = nameOfFound(l);
    return declaredList.flatMap((x) => {
      if (used.has(x.i)) return [];
      if (name !== null && x.exact === name) return [{ l, x, rank: 0, diff: amountDiff(l, x.d) }];
      const fuzzy =
        l.monthly !== null &&
        x.d.type === typeOf(l) &&
        x.d.repayment_monthly !== undefined &&
        x.d.repayment_monthly > 0 &&
        Math.abs(l.monthly - x.d.repayment_monthly) <=
          cfg.declared_amount_tolerance * x.d.repayment_monthly + 1e-9;
      return fuzzy ? [{ l, x, rank: 1, diff: amountDiff(l, x.d) }] : [];
    });
  });
  pairs.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.diff - b.diff ||
      (keyOf(a.l) < keyOf(b.l) ? -1 : keyOf(a.l) > keyOf(b.l) ? 1 : 0) ||
      a.x.i - b.x.i,
  );
  const matched = new Map<DetectedLiability, DeclaredLiability>();
  for (const { l, x } of pairs)
    if (!matched.has(l) && !used.has(x.i)) {
      matched.set(l, x.d);
      used.add(x.i);
    }
  const possibly = rest
    .filter((l) => matched.has(l))
    .map((l) => ({ liability: l, declared: matched.get(l) as DeclaredLiability }));
  const undisclosed = rest.filter((l) => !matched.has(l));
  const linesOf = (ls: DetectedLiability[]) =>
    ls.flatMap((d) => d.evidence.map((e) => byId.get(e)).filter((x): x is Line => x !== undefined));
  const kind = (d: DetectedLiability) => typeOf(d).replace("_", " ");
  const nameOf = (d: DetectedLiability) =>
    d.sources.includes("outflow") ? lenderOf(d.provider) : d.provider;
  const describe = (d: DetectedLiability) =>
    `${nameOf(d)} (${kind(d)}${d.monthly ? `, $${d.monthly} a month` : ""})`;
  const possiblyText = possibly.map(
    (p) =>
      `${describe(p.liability)}. Possibly the declared ${p.declared.provider.trim()}${p.declared.repayment_monthly === undefined ? "" : ` ($${p.declared.repayment_monthly} a month)`}: confirm with the applicant`,
  );
  const counts = [
    ...(undisclosed.length > 0 ? [`${undisclosed.length} undisclosed`] : []),
    ...(possibly.length > 0 ? [`${possibly.length} possibly declared`] : []),
  ].join(", ");
  // Red (L-1, knockout) waits until SIG-57's alias table is Supported and the assessed surplus is
  // wired in (SIG-58); until then LIA-01 is amber at most (review ruling 1). The assessed
  // surplus on the application is not read.
  const lia01: RawSignal =
    detected.liabilities.length === 0
      ? {
          ...nothing(
            "LIA-01",
            `No loan or card account, and no recurring repayment to a lender, was found. ${caveat}`,
          ),
          confidence: "medium",
        }
      : undisclosed.length === 0 && possibly.length === 0
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
            "amber",
            counts,
            [
              ...(undisclosed.length > 0
                ? [`${undisclosed.map(describe).join("; ")} found but not in the application`]
                : []),
              ...possiblyText,
            ].join(". ") + `. ${caveat}`,
            linesOf([...undisclosed, ...possibly.map((p) => p.liability)]),
            {
              confidence: "medium",
              review_reason:
                undisclosed.length > 0
                  ? "A liability in the shared data is missing from the application"
                  : "A liability in the shared data may be a declared one under another name: confirm with the applicant",
              resolve_with: [
                ...undisclosed.map(
                  (d) =>
                    `The applicant's confirmation of the ${nameOf(d)} ${kind(d)}, added to the application`,
                ),
                ...possibly.map(
                  (p) =>
                    `The applicant's confirmation that ${nameOf(p.liability)} is the declared ${p.declared.provider.trim()}`,
                ),
              ],
            },
          );

  /** D29: a set of providers, shown by their lenders only. */
  const lenders = (providers: Iterable<string>) =>
    [...new Set([...providers].map(lenderOf))].join(", ");

  // LIA-02 Loan stacking (L-2): disbursement credits from lenders.
  const lenderProviders = new Set(
    detected.liabilities
      .filter((d) => d.family === "loan" || d.family === "sacc")
      .map((d) => d.provider),
  );
  const disbursements = lines.filter(
    (l) =>
      l.amount > 0 &&
      (DISBURSEMENT.test(upper(`${l.t.description} ${l.t.reference ?? ""}`)) ||
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
            ? `Disbursements from ${recentLenders.size} lenders in the last ${cfg.stacking_window_days} days: ${lenders(recentLenders)}`
            : recent.length >= 1
              ? `A disbursement from ${lenders(recentLenders)} in the last ${cfg.stacking_window_days} days`
              : `Disbursements found, none in the last ${cfg.stacking_window_days} days`,
          disbursements,
        );

  // LIA-03 Payday and SACC (L-3): repayments categorised sacc_loan, over 12 months.
  const saccStart = Math.min(windowStart, end - Math.round(cfg.sacc_lookback_months * 30.4375));
  const sacc = allLines.filter((l) => l.day >= saccStart && l.amount < 0 && cat(l) === "sacc_loan");
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
            ? `SACC repayments to ${lenders(saccBy.keys())} in the last ${cfg.sacc_recent_days} days`
            : concurrent
              ? `Repayments to ${saccBy.size} SACC lenders at the same time: ${lenders(saccBy.keys())}`
              : `SACC repayments to ${lenders(saccBy.keys())} in the last 12 months`,
          sacc,
        );

  // LIA-04 Wage advance (L-4): advance credits from a provider whose repayments are wage_advance.
  const advanceProviders = new Set(
    lines
      .filter((l) => l.amount < 0 && cat(l) === "wage_advance")
      .map((l) => providerOf(l.t.description)),
  );
  const advances = lines.filter(
    (l) => l.amount > 0 && advanceProviders.has(providerOf(l.t.description)),
  );
  const advanceRepayments = lines.filter((l) => l.amount < 0 && cat(l) === "wage_advance");
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

  // LIA-05 BNPL (L-5): distinct lenders and monthly outflow, within the requested lookback.
  const bnpl = lines.filter((l) => l.amount < 0 && cat(l) === "bnpl");
  const bnplLender = (l: Line) => lenderOf(providerOf(l.t.description));
  const bnplProviders = new Set(bnpl.map(bnplLender));
  const outflow = (from: number, to: number) =>
    -sum(bnpl.filter((l) => l.day > from && l.day <= to).map((l) => l.amount));
  const nowOut = outflow(end - 90, end);
  const priorOut = outflow(end - 180, end - 90);
  // Rising compares two 90-day windows, so it is judged only when both lie inside the requested
  // lookback, and the shared history inside it covers the earlier window as EQ-03 judges cover
  // (window_pass, 90%). From 1.3.0 a line outside the lookback no longer counts as history.
  const dataStart = lines.reduce((m, l) => Math.min(m, l.day), Infinity);
  const priorCovered =
    windowStart <= end - 180 && dataStart <= end - 90 - Math.ceil(90 * EQ_THRESHOLDS.window_pass);
  const rising = priorCovered && priorOut > 0 && nowOut > priorOut * (1 + cfg.bnpl_rising);
  // One monthly figure for a BNPL in LIA-01 and LIA-05 (review ruling 5): the detector's
  // cadence-based monthly where the lender's repayments recur, otherwise its last 90 days / 3.
  const bnplMonthly = round2(
    sum(
      [...bnplProviders].map((p) => {
        const ids = new Set(bnpl.filter((l) => bnplLender(l) === p).map((l) => l.id));
        const recurring = detected.liabilities.filter(
          (d) => d.family === "bnpl" && d.monthly !== null && d.evidence.some((e) => ids.has(e)),
        );
        if (recurring.length > 0) return sum(recurring.map((d) => d.monthly as number));
        return -sum(bnpl.filter((l) => ids.has(l.id) && l.day > end - 90).map((l) => l.amount)) / 3;
      }),
    ),
  );
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
          `${bnplProviders.size} provider${bnplProviders.size === 1 ? "" : "s"}, $${bnplMonthly} a month`,
          `${[...bnplProviders].join(", ")}; $${round2(nowOut)} in the last 90 days` +
            (rising ? `, up from $${round2(priorOut)} in the 90 days before` : ""),
          bnpl,
        );

  // LIA-06 Private loans (L-6): repeat transfers to an individual with a repayment reference.
  const privateLines = lines.filter(
    (l) =>
      l.amount < 0 &&
      !cat(l) &&
      /^TRANSFER/.test(l.t.type) &&
      PRIVATE_REPAYMENT.test(upper(`${l.t.description} ${l.t.reference ?? ""}`)),
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
  const lia06: RawSignal =
    cfg.private_loans === "parked"
      ? {
          ...nothing("LIA-06", LIA06_PARKED),
          missing_input: { reason: LIA06_PARKED, resolve_with: [] },
        }
      : repeated.length === 0
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
    gr3_gate_version: SENSITIVE_METHOD_VERSION,
    detector: {
      method_version: LIABILITY_METHOD_VERSION,
      min_occurrences: cfg.min_occurrences,
      amount_tolerance: cfg.amount_tolerance,
    },
    signals: applyEvidence([lia01, lia02, lia03, lia04, lia05, lia06], ctx),
    // D29: every liability is named by its lender here too, never by the rest of its narrative;
    // "declared" is the exact match of ruling 1 (name and type).
    liabilities: detected.liabilities.map((d) => ({
      ...d,
      provider: nameOf(d),
      declared: exactly.has(d),
    })),
  };
}
