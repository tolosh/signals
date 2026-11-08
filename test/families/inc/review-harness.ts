// SIG-41 regression harness, ported from the independent re-review at cfa9d4f
// (research/reviews/sig41-2026-11-08/lib.ts.txt and random.ts.txt; that folder is evidence and
// isn't edited). It rebuilds each mismatch history from its generator parameters, runs the INC
// engine as the reviewer did, and classifies any difference from the plain 60% rule.
import { assessInc, type IncResult } from "../../../src/engines/families/inc/index.js";
import type { Feed } from "../../../src/engines/evidence/index.js";

type Cad = "weekly" | "fortnightly" | "monthly";
export type Gen = {
  family: string;
  cad: Cad;
  base: number;
  lastOffset: number;
  skips: string[];
  cuts: { month: string; factor: number }[];
  repayment: number | null;
  extra: { day: number; amount: number; payer: string }[];
  asOf: string;
};
export type Entry = {
  id: string;
  cause: string;
  reference: string;
  engine: string;
  engine_reason: string;
  streams: string[];
  history: Gen;
};
type Credit = { day: number; amount: number; payer: string };
type History = { asOf: string; credits: Credit[]; repayment: number | null };

const DAY = 86_400_000;
const PAYER = "SALARY ACME CONSULTING PTY LTD";
const toDay = (iso: string) =>
  Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY);
export const toIso = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);
const cents = (x: number) => Math.round(x * 100) / 100;

function monthsBefore(iso: string, n: number): number {
  const y = +iso.slice(0, 4),
    m = +iso.slice(5, 7) - 1,
    d = +iso.slice(8, 10);
  const idx = y * 12 + m - n;
  const ty = Math.floor(idx / 12),
    tm = idx - ty * 12;
  const dim = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return Math.floor(Date.UTC(ty, tm, Math.min(d, dim)) / DAY);
}
export function monthWindows(asOf: string) {
  return Array.from({ length: 12 }, (_, k) => ({
    from: monthsBefore(asOf, k + 1) + 1,
    to: monthsBefore(asOf, k),
  }));
}

/** The reviewer's pay schedule, most recent first. */
function schedule(asOf: string, cad: Cad, lastOffset: number): number[] {
  const end = toDay(asOf);
  const start = monthsBefore(asOf, 12) + 1;
  const out: number[] = [];
  if (cad === "monthly") {
    const anchorDay = +toIso(end - lastOffset).slice(8, 10);
    const y = +asOf.slice(0, 4),
      m = +asOf.slice(5, 7) - 1;
    for (let k = 0; k < 14; k++) {
      const idx = y * 12 + m - k;
      const ty = Math.floor(idx / 12),
        tm = idx - ty * 12;
      const dim = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
      const d = Math.floor(Date.UTC(ty, tm, Math.min(anchorDay, dim)) / DAY);
      if (d <= end && d >= start) out.push(d);
    }
  } else {
    const step = cad === "weekly" ? 7 : 14;
    for (let d = end - lastOffset; d >= start; d -= step) out.push(d);
  }
  return out;
}

/**
 * Rebuilds the history from the generator parameters. Family C stored its near-60% month as a
 * factor rounded to 2 dp (cents(per / base)), so those months rebuild only approximately.
 */
export function rebuild(g: Gen): History {
  const wins = monthWindows(g.asOf);
  const skips = new Set(g.skips.map(toDay));
  const cuts = g.cuts.map((c) => {
    const w = wins.find((x) => toIso(x.to).slice(0, 7) === c.month);
    return { ...c, from: w?.from ?? Infinity, to: w?.to ?? -Infinity };
  });
  const amount = (d: number) => {
    const c = cuts.find((x) => d >= x.from && d <= x.to);
    return c ? cents(g.base * c.factor) : g.base;
  };
  const credits = schedule(g.asOf, g.cad, g.lastOffset)
    .filter((d) => !skips.has(d))
    .map((d) => ({ day: d, amount: amount(d), payer: PAYER }))
    .filter((c) => c.amount > 0);
  return { asOf: g.asOf, credits: [...credits, ...g.extra], repayment: g.repayment };
}

/** The plain Amendment 2 §4.1 rule on all income received, unrounded (the reviewer's reference). */
export function reference(h: History, credits = h.credits, rounding = false): string {
  const ms = monthWindows(h.asOf).map((w) =>
    credits.filter((c) => c.day >= w.from && c.day <= w.to).reduce((s, c) => s + c.amount, 0),
  );
  const avg = ms.reduce((s, m) => s + m, 0) / 12;
  const round2 = (x: number) => Math.round((x + Number.EPSILON * Math.sign(x)) * 100) / 100;
  const tr = ms.filter((m) => avg > 0 && (rounding ? round2(m / avg) < 0.6 : m < 0.6 * avg));
  if (h.repayment !== null && tr.some((m) => m < (h.repayment as number))) return "red";
  return tr.length > 0 ? "amber" : "green";
}

function feedOf(h: History): Feed {
  const start = monthsBefore(h.asOf, 12) + 1;
  let n = 0;
  const tx = [
    ...Array.from({ length: Math.floor((toDay(h.asOf) - start) / 3) + 1 }, (_, i) => ({
      accountId: "a1",
      transactionId: `x${++n}`,
      type: "PAYMENT",
      description: "COLES 1234",
      postingDateTime: `${toIso(start + 3 * i)}T09:00:00Z`,
      amount: "-42.10",
    })),
    ...[...h.credits]
      .sort((a, b) => a.day - b.day)
      .map((c) => ({
        accountId: "a1",
        transactionId: `x${++n}`,
        type: "TRANSFER_INCOMING",
        description: c.payer,
        postingDateTime: `${toIso(c.day)}T02:00:00Z`,
        amount: c.amount.toFixed(2),
      })),
  ];
  return {
    accounts: [
      {
        account: { accountId: "a1", productCategory: "TRANS_AND_SAVINGS_ACCOUNTS" },
        detail: { data: { bsb: "062000", accountNumber: "11112222" } },
        transactions: tx,
      },
    ],
  };
}

export function engine(h: History): IncResult {
  return assessInc({
    feed: feedOf(h),
    feed_type: "cdr",
    as_of: h.asOf,
    lookback_months: 6,
    application: h.repayment === null ? {} : { proposed_repayment_monthly: h.repayment },
    gross_up: null,
  });
}

export const xrefDates = (reason: string) =>
  [...reason.matchAll(/Includes a missed pay on (\d{4}-\d{2}-\d{2}); see INC-12/g)].map(
    (m) => m[1] as string,
  );
export const inc12Dates = (reason: string) => {
  const m = reason.match(/expected but not received around ([0-9, -]+?)(\.|$)/);
  return m ? (m[1] as string).split(", ").map((x) => x.trim()) : [];
};
/** The trough windows INC-12 names: "from <date> to <date>" (each month of INC-09's 12 ends on as-of's day). */
export const inc12Windows = (reason: string) =>
  [
    ...reason.matchAll(/(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2}) is a trough month in INC-09/g),
  ].map((m) => ({ from: m[1] as string, to: m[2] as string }));
export const inc12AnyTroughLink = (reason: string) => /is a trough month in INC-09/.test(reason);

export type Verdict = {
  id: string;
  recorded: string;
  now: string;
  reference: string;
  engine: string;
  rebuilt_reference_matches: boolean;
  xref_errors: string[];
  no_stream_green: boolean;
};

/** Classifies one entry at the current engine. */
export function classify(e: Entry): Verdict {
  const h = rebuild(e.history);
  const ref = reference(h);
  const r = engine(h);
  const s = (id: string) => {
    const x = r.signals.find((y) => y.id === id);
    if (!x) throw new Error(`no ${id}`);
    return x;
  };
  const inc09 = s("INC-09");
  const inc12 = s("INC-12");
  const streams = r.income.map((x) => x.payer);
  // The evidence layer's EQ-01 cap gives this reason (src/engines/evidence/checks.ts).
  const eq01Fail = inc09.reason.includes("No recurring salary or benefit credit");
  let now: string;
  if (inc09.state === ref) now = "matches the plain rule";
  else if (inc09.state === "unverified")
    now = eq01Fail
      ? "unverified: EQ-01"
      : streams.length === 0
        ? "unverified: no regular income stream (fix 1)"
        : "unverified: evidence layer (other)";
  else if (reference(h, h.credits, true) === inc09.state) now = "D25 rounding";
  else if (
    reference(
      h,
      h.credits.filter((c) => streams.includes(c.payer)),
    ) === inc09.state
  )
    now = "N-1 regular income only";
  else if (
    reference(
      h,
      h.credits.filter((c) => streams.includes(c.payer)),
      true,
    ) === inc09.state
  )
    now = "N-1 regular income only + D25 rounding";
  else now = "unexplained";

  const errors: string[] = [];
  const fires = inc09.state === "amber" || inc09.state === "red";
  const xref = xrefDates(inc09.reason);
  const reported = inc12Dates(inc12.reason);
  const windows = inc12Windows(inc12.reason);
  const skipped = new Set(e.history.skips);
  if (!fires && inc12AnyTroughLink(inc12.reason))
    errors.push("INC-12 names a trough month while INC-09 doesn't fire");
  if (inc12AnyTroughLink(inc12.reason) && windows.length === 0)
    errors.push("INC-12 names a trough month without its dates");
  for (const d of xref) {
    if (!reported.includes(d)) errors.push(`INC-09 cites ${d}, which INC-12 doesn't report`);
    if (!skipped.has(d)) errors.push(`INC-09 cites ${d}, which isn't a skipped pay day`);
    if (fires && !windows.some((w) => d >= w.from && d <= w.to))
      errors.push(`INC-12 names no trough month holding ${d}`);
  }
  return {
    id: e.id,
    recorded: e.cause,
    now,
    reference: ref,
    engine: inc09.state,
    rebuilt_reference_matches: ref === e.reference,
    xref_errors: errors,
    no_stream_green: streams.length === 0 && inc09.state === "green",
  };
}
