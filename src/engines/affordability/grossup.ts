// Gross annual income from observed net pay (SIG-46; D24; Product Specification 6.5): the
// resident tax schedule and Medicare levy, inverted, for the financial year holding the end of the
// observation window. Pre-registered in research/preregistrations/SIG-46.json. Affordability
// takes gross as an input (I-2); a caller passes this result. Badges still follow net (D24).
// Pure: no clock, no randomness, relative imports (D3).
import { TAX_TABLES, type TaxTable } from "./tax-tables.js";

export const GROSSUP_METHOD_VERSION = "1.0.0";

export type NetByKind = {
  /** Net annual salary and wages. */
  salary_wage: number;
  /** Net annual variable income, already shaded (INC-R1). */
  variable?: number;
  /** Net annual benefits, treated as untaxed. */
  benefits?: number;
};
export type GrossUpInput = {
  net: NetByKind | { state: "unverified" } | null;
  /** End of the observation window (YYYY-MM-DD). */
  as_of: string;
  /** Replay: the table a previous assessment recorded. */
  pinned?: { id: string; version: number };
};
export type GrossUpStep = { step: string; value: number | string | null; detail?: string };
export type GrossUpResult =
  | {
      state: "verified";
      method_version: string;
      gross_income_annual: number;
      basis: "inferred";
      table: { id: string; version: number };
      trace: GrossUpStep[];
      resolve_with: string[];
    }
  | { state: "unverified"; method_version: string; reason: string; trace: GrossUpStep[] };

const cents = (x: number) => Math.round(x * 100) / 100;

export function taxOn(g: number, t: TaxTable): number {
  let tax = 0;
  t.brackets.forEach((b, i) => {
    const next = t.brackets[i + 1]?.from ?? Infinity;
    if (g > b.from) tax += b.rate * (Math.min(g, next) - b.from);
  });
  return tax;
}

export function levyOn(g: number, t: TaxTable): number {
  const m = t.medicare;
  return g <= m.lower ? 0 : Math.min(m.shade_rate * (g - m.lower), m.rate * g);
}

const netOf = (g: number, t: TaxTable) => g - taxOn(g, t) - levyOn(g, t);

/** The table in force: the pinned one, or the latest version effective by as_of in its year. */
export function tableFor(
  as_of: string,
  tables: readonly TaxTable[],
  pinned?: { id: string; version: number },
): TaxTable | null {
  if (pinned) return tables.find((t) => t.id === pinned.id && t.version === pinned.version) ?? null;
  const inForce = tables
    .filter((t) => t.fy_start <= as_of && as_of <= t.fy_end && t.effective_from <= as_of)
    .sort((a, b) =>
      a.effective_from === b.effective_from
        ? b.version - a.version
        : a.effective_from < b.effective_from
          ? 1
          : -1,
    );
  return inForce[0] ?? null;
}

/**
 * The gross whose net is the given net. Net is continuous, increasing and linear between the
 * breakpoints (tax thresholds, the levy's lower threshold, and where the shaded levy meets the
 * full rate), so the answer is exact on the segment that holds it.
 */
export function invert(net: number, t: TaxTable): { gross: number; segment: [number, number] } {
  const m = t.medicare;
  const meet = (m.shade_rate * m.lower) / (m.shade_rate - m.rate);
  const points = [0, ...t.brackets.map((b) => b.from), m.lower, meet]
    .filter((x, i, xs) => x >= 0 && xs.indexOf(x) === i)
    .sort((a, b) => a - b);
  for (let i = 0; i < points.length; i++) {
    const lo = points[i] as number;
    const last = i === points.length - 1;
    const hi = last ? lo + 1_000_000 : (points[i + 1] as number);
    const nLo = netOf(lo, t);
    const nHi = netOf(hi, t);
    if (net <= nHi || last)
      return {
        gross: lo + ((net - nLo) * (hi - lo)) / (nHi - nLo),
        segment: [lo, last ? Infinity : hi],
      };
  }
  return { gross: net, segment: [0, 0] };
}

export function grossUp(
  input: GrossUpInput,
  tables: readonly TaxTable[] = TAX_TABLES,
): GrossUpResult {
  const trace: GrossUpStep[] = [];
  const unverified = (reason: string): GrossUpResult => ({
    state: "unverified",
    method_version: GROSSUP_METHOD_VERSION,
    reason,
    trace,
  });
  const net = input.net;
  if (net == null || "state" in net) return unverified("net income unverified");
  const taxable = net.salary_wage + (net.variable ?? 0);
  const benefits = net.benefits ?? 0;
  if (!(taxable + benefits > 0) || taxable < 0 || benefits < 0)
    return unverified("net income not positive");
  const t = tableFor(input.as_of, tables, input.pinned);
  if (!t) return unverified("no tax table for the observation window");
  trace.push({
    step: "table",
    value: `${t.id} v${t.version}`,
    detail: "the version in force at the end of the observation window, or as pinned for replay",
  });
  trace.push({ step: "taxable_net", value: cents(taxable), detail: "salary_wage + variable" });
  const { gross: g, segment } = invert(taxable, t);
  const taxableGross = cents(g);
  trace.push({
    step: "invert",
    value: taxableGross,
    detail: `segment ${segment[0]} to ${segment[1]}; tax ${cents(taxOn(g, t))}, levy ${cents(levyOn(g, t))}`,
  });
  trace.push({ step: "benefits", value: cents(benefits), detail: "untaxed, added unchanged" });
  const gross = cents(taxableGross + benefits);
  trace.push({ step: "gross_income_annual", value: gross });
  return {
    state: "verified",
    method_version: GROSSUP_METHOD_VERSION,
    gross_income_annual: gross,
    basis: "inferred",
    table: { id: t.id, version: t.version },
    trace,
    resolve_with: [
      "HELP and other study-debt repayments are not modelled; gross may be understated",
      "salary sacrifice is not modelled; gross may be understated",
      "non-resident rates are not modelled",
      "tax offsets (LITO among them) and deductions are not modelled; with them, real net is higher and gross may be overstated",
      ...(t.medicare.provisional
        ? ["Medicare low-income thresholds for this year are provisional (the previous year's)"]
        : []),
    ],
  };
}
