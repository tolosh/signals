// SIG-63: the structure family of T7 (research/preregistrations/SIG-63.json, structure_family):
// code shape, code rank, cross-applicant code-to-name links, and ID arithmetic. These features are
// never intended evidence for any label. They are computed from the feed alone, never from a label
// or the truth, except that a liability unit reads its first repayment line (the truth's link, as
// SIG-60's liability features do). Cross-applicant features read every applicant in the set, in
// both halves of the split, as a real detector could.
import { readFileSync } from "node:fs";
import type { GeneratedApplicant, Transaction } from "../generator/index.js";
import type { Value } from "./classifiers.js";
import type { Unit } from "./units.js";

export const SIG63_PREREGISTRATION = "research/preregistrations/SIG-63.json";
export const STRUCTURE_FAMILIES: Record<string, string[]> = (
  JSON.parse(readFileSync(SIG63_PREREGISTRATION, "utf8")) as {
    structure_family: { families: Record<string, string[]> };
  }
).structure_family.families;

export type CodeStats = {
  length: number;
  lead1: number;
  lead2: string;
  last1: number;
  digit_sum_mod9: number;
  rank_in_set: number;
  rank_in_length: number;
  gap_to_nearest: number;
  step_share: number;
};

/** Shape and rank features of every distinct code, by structure_family.definitions. */
export function codeStats(codes: Iterable<string>): Map<string, CodeStats> {
  const distinct = [...new Set(codes)].filter((c) => /^\d+$/.test(c));
  const num = (c: string) => Number(c);
  const all = [...distinct].sort((a, b) => num(a) - num(b) || (a < b ? -1 : 1));
  const rankAll = new Map(all.map((c, i) => [c, all.length > 1 ? i / (all.length - 1) : 0]));
  const byLength = new Map<number, string[]>();
  for (const c of all) byLength.set(c.length, [...(byLength.get(c.length) ?? []), c]);
  const out = new Map<string, CodeStats>();
  for (const same of byLength.values()) {
    const diffs = same.map((c, i) => (i === 0 ? NaN : num(c) - num(same[i - 1] ?? c)));
    same.forEach((c, i) => {
      const lower = i > 0 ? num(c) - num(same[i - 1] ?? c) : Infinity;
      const upper = i < same.length - 1 ? num(same[i + 1] ?? c) - num(c) : Infinity;
      const gap = Math.min(lower, upper);
      const d = diffs[i] ?? NaN;
      const digits = [...c].map(Number);
      out.set(c, {
        length: c.length,
        lead1: digits[0] ?? NaN,
        lead2: c.slice(0, 2),
        last1: digits[digits.length - 1] ?? NaN,
        digit_sum_mod9: digits.reduce((a, b) => a + b, 0) % 9,
        rank_in_set: rankAll.get(c) ?? NaN,
        rank_in_length: same.length > 1 ? i / (same.length - 1) : 0,
        gap_to_nearest: Number.isFinite(gap) ? Math.log10(1 + gap) : NaN,
        step_share: Number.isFinite(d) ? diffs.filter((x) => x === d).length / same.length : NaN,
      });
    });
  }
  return out;
}

const MISSING_CODE: Record<keyof CodeStats, Value> = {
  length: NaN,
  lead1: NaN,
  lead2: "∅",
  last1: NaN,
  digit_sum_mod9: NaN,
  rank_in_set: NaN,
  rank_in_length: NaN,
  gap_to_nearest: NaN,
  step_share: NaN,
};

/** The numeric or hexadecimal part of an ID: its last segment, when all digits or all hex. */
function idPart(id: string): { value: number; text: string } | null {
  const last = id.split("-").pop() ?? "";
  const digits = last.match(/(\d+)$/)?.[1];
  if (digits && /^[a-z]?\d+$/i.test(last)) return { value: Number(digits), text: digits };
  if (/^[0-9a-f]+$/i.test(last)) return { value: parseInt(last.slice(-12), 16), text: last };
  return null;
}
const digitSumMod9 = (text: string) => [...text].reduce((a, ch) => a + parseInt(ch, 16), 0) % 9;

type Acc = GeneratedApplicant["feed"]["accounts"][number];
const accountId = (acc: Acc) => String((acc.account as { accountId?: string }).accountId ?? "");
const dayOf = (t: Transaction) => Math.floor(Date.parse(t.postingDateTime ?? "") / 86_400_000);
type Links = { names: Map<string, Set<string>>; applicants: Set<string> };

/**
 * Adds the structure family to SIG-60's units: code features to line and liability units, ID
 * arithmetic to every unit. The units are changed in place and returned.
 */
export function addStructureFeatures(units: Unit[], applicants: GeneratedApplicant[]): Unit[] {
  const lines = new Map<string, { t: Transaction; app: string }>();
  const links = new Map<string, Map<string, Links>>(); // code -> applicant -> names
  const repaymentFirst = new Map<string, string>(); // `${app}|${liab}` -> first repayment line
  const appFeatures = new Map<string, Record<string, Value>>();
  const lineIdGap = new Map<string, number>();
  for (const a of applicants) {
    const app = a.truth.applicant_id;
    for (const acc of a.feed.accounts) {
      const ordered = [...acc.transactions].sort((x, y) => dayOf(x) - dayOf(y));
      ordered.forEach((t, k) => {
        const prev = k > 0 ? idPart(ordered[k - 1]?.transactionId ?? "") : null;
        const cur = idPart(t.transactionId);
        lineIdGap.set(t.transactionId, prev && cur ? cur.value - prev.value : NaN);
      });
      for (const t of acc.transactions) {
        lines.set(t.transactionId, { t, app });
        if (!t.billerCode) continue;
        let byApp = links.get(t.billerCode);
        if (!byApp) links.set(t.billerCode, (byApp = new Map()));
        let l = byApp.get(app);
        if (!l) byApp.set(app, (l = { names: new Map(), applicants: new Set() }));
        const n = t.billerName ?? "";
        l.names.set(n, new Set([...(l.names.get(n) ?? []), app]));
      }
    }
    for (const l of a.truth.v2?.liabilities ?? []) {
      const first = l.repayment_transaction_ids.find((id) => lines.has(id));
      if (first) repaymentFirst.set(`${app}|${l.id}`, first);
    }
    const primary = [...a.feed.accounts].sort(
      (x, y) => y.transactions.length - x.transactions.length,
    )[0];
    const part = idPart(app);
    const accPart = primary ? idPart(accountId(primary)) : null;
    appFeatures.set(app, {
      app_id_digit_sum_mod9: part ? digitSumMod9(part.text) : NaN,
      app_id_hex_lead: part ? (part.text[0] ?? "∅") : "∅",
      app_account_id_mod7: accPart ? accPart.value % 7 : NaN,
    });
  }
  const stats = codeStats(links.keys());
  const codeFeatures = (prefix: "lia" | "line", t: Transaction | undefined, app: string) => {
    const code = t?.billerCode;
    const s: Record<string, Value> = code
      ? { ...(stats.get(code) ?? MISSING_CODE) }
      : { ...MISSING_CODE };
    const others = code
      ? [...(links.get(code) ?? new Map<string, Links>())].filter(([k]) => k !== app)
      : [];
    const names = new Set(others.flatMap(([, l]) => [...l.names.keys()]));
    const x: Record<string, Value> = {};
    for (const k of ["length", "lead1", "lead2", "last1", "digit_sum_mod9"] as const)
      x[`${prefix}_code_${k}`] = s[k] as Value;
    for (const k of ["rank_in_set", "rank_in_length", "gap_to_nearest", "step_share"] as const)
      x[`${prefix}_code_${k}`] = s[k] as Value;
    x[`${prefix}_code_names_elsewhere`] = code ? names.size : NaN;
    x[`${prefix}_code_card_name_elsewhere`] = code
      ? [...names].some((n) => /CARD/i.test(n))
        ? 1
        : 0
      : NaN;
    x[`${prefix}_code_applicants`] = code ? Math.log2(1 + others.length) : NaN;
    return x;
  };
  for (const u of units) {
    Object.assign(u.x, appFeatures.get(u.group) ?? {});
    if (u.kind === "line") {
      const t = lines.get(u.id)?.t;
      const part = idPart(u.id);
      Object.assign(u.x, codeFeatures("line", t, u.group), {
        line_id_mod7: part ? part.value % 7 : NaN,
        line_id_mod91: part ? part.value % 91 : NaN,
        line_id_gap_to_previous: lineIdGap.get(u.id) ?? NaN,
      });
    } else if (u.kind === "liability") {
      const first = repaymentFirst.get(u.id);
      Object.assign(u.x, codeFeatures("lia", first ? lines.get(first)?.t : undefined, u.group));
    }
  }
  return units;
}
