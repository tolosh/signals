// The per-signal evidence_quality block and capping (Amendment 2, EQ-R1 to EQ-R5), and the
// roll-up gate (RU-4, RU-5). Pure and deterministic (EQ-R6).
import { ALIASES, DEFINITIONS, type SignalDefinition } from "../signals/definitions.js";
import { EQ_THRESHOLDS } from "./checks.js";
import type {
  EvidenceCheck,
  EvidenceContext,
  EvidenceRollup,
  RawSignal,
  Signal,
  SignalState,
} from "./types.js";

type Cap = { reason: string; resolve: string[]; review: string | null };

const check = (ctx: EvidenceContext, id: EvidenceCheck["id"]): EvidenceCheck => {
  const found = ctx.checks.find((c) => c.id === id);
  if (!found) throw new Error(`Evidence context has no ${id}`);
  return found;
};

function caps(def: SignalDefinition, raw: RawSignal, ctx: EvidenceContext): Cap[] {
  const out: Cap[] = [];
  const eq01 = check(ctx, "EQ-01");
  const eq02 = check(ctx, "EQ-02");
  const eq03 = check(ctx, "EQ-03");
  if (eq01.result === "fail")
    out.push({ reason: `Not verified: ${eq01.detail}`, resolve: eq01.resolve_with, review: null });
  if (eq03.result === "fail")
    out.push({ reason: `Not verified: ${eq03.detail}`, resolve: eq03.resolve_with, review: null });
  if (!def.feeds.includes(ctx.feed_type))
    out.push({
      reason: "Not verified: this signal needs an open banking feed",
      resolve: ["Connect the accounts through open banking"],
      review: null,
    });
  if (ctx.history_months_available < def.min_history_months * EQ_THRESHOLDS.history_tolerance)
    out.push({
      reason: `Not verified: this signal needs ${def.min_history_months} months of history`,
      resolve: [`Share ${def.min_history_months} months of transaction history`],
      review: null,
    });
  if (
    ctx.feed_type === "uploaded_statement" &&
    def.adverse_detection &&
    raw.unrecognised_adverse > 0
  )
    out.push({
      reason: "Not verified: the statement has debits no rule recognised",
      resolve: [
        `Review ${raw.unrecognised_adverse} debits on the statement that no rule recognised, or connect the account through open banking`,
      ],
      review: "A statement feed has debits that could be adverse and were not recognised",
    });
  if (eq02.result === "fail" && def.depends_on_absence)
    out.push({
      reason: `Not verified: ${eq02.detail}`,
      resolve: eq02.resolve_with,
      review: "Transfers to accounts outside the grant could hide what this signal looks for",
    });
  // EQ-R4, "the accounts or feed it needs" (N-13, E-11): an input the evaluator needs is absent.
  // It applies only when no evidence check caps the signal, whose reason and resolve_with stand.
  if (out.length === 0 && raw.missing_input)
    out.push({
      reason: raw.missing_input.reason,
      resolve: raw.missing_input.resolve_with,
      review: null,
    });
  return out;
}

const unique = (xs: string[]) => [...new Set(xs)];

/** Applies the evidence-quality layer to each evaluator output, in order. */
export function applyEvidence(
  raws: RawSignal[],
  ctx: EvidenceContext,
  definitions: Readonly<Record<string, SignalDefinition>> = DEFINITIONS,
): Signal[] {
  return raws.map((raw) => {
    const def = definitions[ALIASES[raw.id] ?? raw.id];
    if (!def) throw new Error(`Unknown signal ${raw.id}: no definition in the registry`);
    const positive = def.rollup_class === "positive";
    const positiveState = raw.state === "evidenced" || raw.state === "not_observed";
    if (positive !== positiveState)
      throw new Error(
        `${def.id} returned ${raw.state}: POS signals are evidenced or not_observed only (D13)`,
      );

    const applied = caps(def, raw, ctx);
    const capped = applied.length > 0;
    const state: SignalState = capped
      ? "unverified"
      : def.depends_on_absence && raw.nothing_found
        ? "none_observed"
        : raw.state;
    const reviews = [...applied.map((c) => c.review), raw.review_reason ?? null].filter(
      (r): r is string => r !== null,
    );

    return {
      id: def.id,
      family: def.family,
      family_code: def.family_code,
      name: def.name,
      state,
      rollup_class: def.rollup_class,
      value: capped ? null : raw.value,
      reason: applied[0]?.reason ?? raw.reason,
      confidence: capped ? "low" : raw.confidence,
      evidence_count: raw.evidence.transaction_count,
      evidence_quality: {
        observed: {
          period_start: raw.evidence.period_start ?? ctx.period?.start ?? ctx.window.start,
          period_end: raw.evidence.period_end ?? ctx.period?.end ?? ctx.window.end,
          account_ids:
            raw.evidence.account_ids.length > 0 ? raw.evidence.account_ids : ctx.shared_account_ids,
          transaction_count: raw.evidence.transaction_count,
        },
        completeness: {
          primary_income_account_shared: ctx.primary_income_account_shared,
          unshared_own_account_transfers: ctx.unshared_own_accounts,
          institutions_without_shared_account: ctx.institutions_without_shared_account,
          history_months_available: ctx.history_months_available,
          history_months_required: def.min_history_months,
        },
        reliability: {
          feed_type: ctx.feed_type,
          enrich_confident_pct: raw.enrich_confident_pct,
          field_population_pct: ctx.field_population_pct,
        },
        basis: def.basis,
        resolve_with: unique([...applied.flatMap((c) => c.resolve), ...(raw.resolve_with ?? [])]),
        review_required: reviews.length > 0,
        review_reason: reviews[0] ?? null,
      },
    };
  });
}

/** RU-4 and RU-5: what the evidence layer contributes to the roll-up, before any family. */
export function evidenceRollup(ctx: EvidenceContext): EvidenceRollup {
  const eq01 = check(ctx, "EQ-01");
  const eq02 = check(ctx, "EQ-02");
  const eq03 = check(ctx, "EQ-03");
  const blocking = [eq01, eq03].filter((c) => c.result === "fail");
  const reasons: EvidenceRollup["reasons"] = [
    ...blocking.map((c) => ({ signal_id: null, state: "unverified" as const, reason: c.detail })),
    ...(eq02.result === "fail" ? [{ signal_id: null, state: null, reason: eq02.detail }] : []),
  ];
  return {
    state: blocking.length > 0 ? "unverified" : null,
    green_allowed: eq01.result === "pass" && eq03.result === "pass" && eq02.result !== "fail",
    reasons,
  };
}
