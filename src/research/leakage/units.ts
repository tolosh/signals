// SIG-60: units, features and labels for the adversarial leakage test (pre-registered in
// research/preregistrations/SIG-60.json). Features come from the feed and the application only,
// as a detector would see them; the ground truth is read only for labels, pools and links (which
// repayment lines belong to which liability). Works on sets v2, v2.1 and v2.2 alike.
import { createHash, createHmac } from "node:crypto";
import type { GeneratedApplicant, Transaction } from "../generator/index.js";
import type { Value } from "./classifiers.js";
import { genuinelyDifferent } from "./validity.js";

export type UnitKind = "applicant" | "liability" | "declaration" | "line";
export type Unit = {
  kind: UnitKind;
  /** The applicant: the fold key, so one applicant never trains and tests at once. */
  group: string;
  id: string;
  /** Feature values, by feature name. */
  x: Record<string, Value>;
  /** Labels and pool memberships, by label ID: true, false, or absent (not in the pool). */
  y: Record<string, boolean>;
};

const DAY = 86_400_000;
const dayOf = (t: Transaction) => Math.floor(Date.parse(t.postingDateTime ?? "") / DAY);
const amt = (t: Transaction) => Number(t.amount);
const absCents = (t: Transaction) => Math.round(Math.abs(amt(t)) * 100);
const log10 = (x: number) => (x > 0 ? Math.log10(x) : 0);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : (s[Math.floor((s.length - 1) / 2)] ?? NaN);
};
const mean = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);
const cv = (xs: number[]) => {
  const m = mean(xs);
  return xs.length < 2 || !m ? NaN : Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) / m;
};
const share = (n: number, d: number) => (d === 0 ? NaN : n / d);
const b = (v: boolean) => (v ? 1 : 0);

/** A narrative or reference with digit runs as #, other letters kept: the payee's template. */
export const template = (s: string) => s.toUpperCase().replace(/\d+/g, "#").replace(/\s+/g, " ");
/** A string's shape: letters A, digits 9, runs collapsed, separators kept. */
export const shape = (s: string) =>
  s
    .replace(/[A-Za-z]+/g, "A")
    .replace(/\d+/g, (m) => `9{${m.length}}`)
    .replace(/\s+/g, " ")
    .trim();
const maxDigitRun = (s: string) => Math.max(0, ...[...s.matchAll(/\d+/g)].map((m) => m[0].length));
const dateLike = (s: string) =>
  /\d{4}-\d{2}-\d{2}|\b\d{4}\b(?!\d)|\b\d{1,2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/i.test(
    s,
  );
const caseStyle = (s: string) => {
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (!letters) return "none";
  if (letters === letters.toUpperCase()) return "upper";
  if (letters === letters.toLowerCase()) return "lower";
  const words = s.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.every((w) => /^[^a-z]*[A-Z][a-z]*$/.test(w.replace(/[^A-Za-z]/g, "")))) return "title";
  return "mixed";
};
const firstWord = (s: string) => (s.toUpperCase().match(/[A-Z0-9]+/) ?? [""])[0];
const normName = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
const TYPE_SUFFIX = /\b(credit card|card|personal loan|car loan|home loan|loan|mortgage)\s*$/i;
const LEGAL_SUFFIX = /\b(pty|ltd|limited|group|corporation|corp|co|inc|plc)\b\.?/i;
const trailingInt = (s: string) => {
  const m = s.match(/(\d+)$/);
  return m ? Number(m[1]) : NaN;
};
const weekday = (day: number) => ((day % 7) + 7 + 4) % 7; // 0 = Sunday
const isWeekend = (day: number) => weekday(day) === 0 || weekday(day) === 6;

type Acc = GeneratedApplicant["feed"]["accounts"][number];
const accData = (a: Acc) => a.account as Record<string, string>;
const bsbOf = (a: Acc) => String((a.detail as { data?: { bsb?: string } }).data?.bsb ?? "");
const LOAN_CATS = new Set(["PERS_LOANS", "RESIDENTIAL_MORTGAGES", "CRED_AND_CHRG_CARDS"]);

/** Every published ID scheme of these sets, tried against an applicant ID with the set's seed. */
function invertId(id: string, seed: number, n: number): number {
  const seq = id.match(/^syn-v2-(\d{4})$/);
  if (seq) return Number(seq[1]);
  const v21 = id.match(/^syn-v21-([0-9a-f]{12})$/);
  if (v21)
    for (let k = 1; k <= n; k++)
      if (
        createHash("sha256").update(`${seed}|applicant|${k}`).digest("hex").slice(0, 12) === v21[1]
      )
        return k;
  const v22 = id.match(/^syn-v22-([0-9a-f]{16})$/);
  if (v22)
    for (let k = 0; k < n; k++)
      if (
        createHmac("sha256", String(seed)).update(`applicant|${k}`).digest("hex").slice(0, 16) ===
        v22[1]
      )
        return k + 1;
  return NaN;
}

// --- labels from the truth -----------------------------------------------------------------
type Truth = GeneratedApplicant["truth"];
type TruthLiability = NonNullable<Truth["v2"]>["liabilities"][number] & {
  account_id?: string | null;
};
type V22Extras = {
  pay_transaction_ids?: string[];
  drift?: { mode: string; alias: string; transaction_ids: string[] } | null;
  dishonour_lines?: { debit: string; returned: string; fee: string | null }[];
  declared_link?: (string | null)[];
};
const extras = (t: Truth) => (t.v2 ?? {}) as unknown as V22Extras;

/** The pay credits: by ID where the truth lists them (v2.2), else by the payers' descriptors. */
function payIds(a: GeneratedApplicant, lines: Transaction[]): Set<string> {
  const listed = extras(a.truth).pay_transaction_ids;
  if (listed) return new Set(listed);
  const aliases = new Set((a.truth.v2?.payers ?? []).flatMap((p) => p.aliases));
  return new Set(
    lines.filter((t) => amt(t) > 0 && aliases.has(t.description)).map((t) => t.transactionId),
  );
}
/**
 * The drift alias lines: listed (v2.2), else, for a drifted applicant, pay under any descriptor
 * other than the one on its earliest pay in the account that receives most of its pay.
 */
function driftIds(a: GeneratedApplicant, lines: Transaction[], pay: Set<string>): Set<string> {
  const d = extras(a.truth).drift;
  if (d !== undefined) return new Set(d?.transaction_ids ?? []);
  const tags = a.truth.tags;
  if (!tags.includes("drift-over-time") && !tags.includes("drift-across-banks")) return new Set();
  const payLines = lines.filter((t) => pay.has(t.transactionId));
  const counts = new Map<string, number>();
  for (const t of payLines) counts.set(t.accountId, (counts.get(t.accountId) ?? 0) + 1);
  const main = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0];
  const original = payLines
    .filter((t) => t.accountId === main)
    .sort((x, y) => dayOf(x) - dayOf(y))[0]?.description;
  return new Set(payLines.filter((t) => t.description !== original).map((t) => t.transactionId));
}

/** Declarations linked to the truth's liabilities: listed (v2.2), else in the truth's order. */
function declaredLinks(a: GeneratedApplicant): (string | null)[] {
  const listed = extras(a.truth).declared_link;
  if (listed) return listed;
  const declared = a.truth.liabilities.items.filter((l) => l.declared).map((l) => l.id);
  return a.application.declared_liabilities.map((_, i) => declared[i] ?? null);
}

// --- set-wide context ----------------------------------------------------------------------------
type SetContext = {
  amountApplicants: Map<number, number>;
  namesPerCode: Map<string, number>;
  codesPerName: Map<string, number>;
};
function setContext(set: GeneratedApplicant[]): SetContext {
  const amountSets = new Map<number, Set<string>>();
  const codeNames = new Map<string, Set<string>>();
  const nameCodes = new Map<string, Set<string>>();
  for (const a of set)
    for (const acc of a.feed.accounts)
      for (const t of acc.transactions) {
        const c = absCents(t);
        let s = amountSets.get(c);
        if (!s) amountSets.set(c, (s = new Set()));
        s.add(a.truth.applicant_id);
        if (t.billerCode) {
          const n = t.billerName ?? "";
          let cn = codeNames.get(t.billerCode);
          if (!cn) codeNames.set(t.billerCode, (cn = new Set()));
          cn.add(n);
          let nc = nameCodes.get(n);
          if (!nc) nameCodes.set(n, (nc = new Set()));
          nc.add(t.billerCode);
        }
      }
  const size = <K>(m: Map<K, Set<string>>) => new Map([...m].map(([k, v]) => [k, v.size]));
  return {
    amountApplicants: size(amountSets),
    namesPerCode: size(codeNames),
    codesPerName: size(nameCodes),
  };
}

// --- extraction ---------------------------------------------------------------------------------
export type SetInput = { name: string; seed: number; applicants: GeneratedApplicant[] };

export function extractUnits(set: SetInput): Unit[] {
  const ctx = setContext(set.applicants);
  const ids = set.applicants.map((a) => a.truth.applicant_id).sort();
  const rankOf = new Map(ids.map((id, i) => [id, i / ids.length]));
  const units: Unit[] = [];
  for (const a of set.applicants) units.push(...applicantUnits(a, set, ctx, rankOf));
  return units;
}

function applicantUnits(
  a: GeneratedApplicant,
  set: SetInput,
  ctx: SetContext,
  rankOf: Map<string, number>,
): Unit[] {
  const id = a.truth.applicant_id;
  const truth = a.truth;
  const accounts = a.feed.accounts;
  const accOf = new Map(accounts.map((acc) => [accData(acc).accountId ?? "", acc]));
  const allLines = accounts.flatMap((acc) => acc.transactions);
  const lineById = new Map(allLines.map((t) => [t.transactionId, t]));
  const pay = payIds(a, allLines);
  const drift = driftIds(a, allLines, pay);
  const tLiabs = (truth.v2?.liabilities ?? []) as TruthLiability[];
  const items = truth.liabilities.items;
  const repaymentOf = new Map<string, string>();
  for (const l of tLiabs) for (const tid of l.repayment_transaction_ids) repaymentOf.set(tid, l.id);
  const dishonour = extras(truth).dishonour_lines;
  const feeIds = new Set(
    dishonour
      ? dishonour.flatMap((d) => (d.fee ? [d.fee] : []))
      : (truth.v2?.dishonour_events ?? []).map((e) => e.transaction_id),
  );
  const eventIds = new Set(
    dishonour ? dishonour.flatMap((d) => [d.debit, d.returned, ...(d.fee ? [d.fee] : [])]) : feeIds,
  );
  const bouncedIds = new Set(dishonour ? dishonour.map((d) => d.debit) : []);
  // Applicant features read the feed without the dishonour event's own lines (its intended
  // evidence), so a dishonour can't show through counts the event itself adds.
  const lines = allLines.filter((t) => !eventIds.has(t.transactionId));
  const salaried = truth.archetype === "salaried";
  const singlePayer = (truth.v2?.payers.length ?? 0) === 1;

  // Accounts.
  const txAccounts = accounts.filter(
    (acc) => accData(acc).productCategory === "TRANS_AND_SAVINGS_ACCOUNTS",
  );
  const primary = [...accounts].sort((x, y) => y.transactions.length - x.transactions.length)[0];
  const primaryId = primary ? (accData(primary).accountId ?? "") : "";
  const payLines = lines.filter((t) => pay.has(t.transactionId));
  const payAccounts = [...new Set(payLines.map((t) => t.accountId))];
  const payByAccount = new Map<string, number>();
  for (const t of payLines) payByAccount.set(t.accountId, (payByAccount.get(t.accountId) ?? 0) + 1);
  const mainPayAccount = [...payByAccount].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "";
  const second = txAccounts
    .filter((acc) => (accData(acc).accountId ?? "") !== primaryId)
    .sort((x, y) => y.transactions.length - x.transactions.length)[0];
  const secondLines = second?.transactions ?? [];
  const days = lines.map(dayOf);
  const span = days.length ? (Math.max(...days) - Math.min(...days) + 1) / 30.44 : NaN;
  const credits = lines.filter((t) => amt(t) > 0);
  const debits = lines.filter((t) => amt(t) < 0);
  const fees = lines.filter((t) => t.type === "FEE");
  const dd = lines.filter((t) => t.type === "DIRECT_DEBIT" && amt(t) < 0);
  const bpay = lines.filter((t) => t.billerCode);
  const recurring = new Map<string, number>();
  for (const t of debits) {
    if (t.merchantCategoryCode) continue;
    const k = template(t.description);
    recurring.set(k, (recurring.get(k) ?? 0) + 1);
  }
  const payAmounts = [...payLines].sort((x, y) => dayOf(x) - dayOf(y)).map(amt);
  const third = Math.floor(payAmounts.length / 3);
  const payDescriptors = [...new Set(payLines.map((t) => t.description))];
  const refShapes = new Map<string, number>();
  for (const t of payLines)
    refShapes.set(shape(t.reference), (refShapes.get(shape(t.reference)) ?? 0) + 1);
  const accountIds = accounts.map((acc) => accData(acc).accountId ?? "");
  const suffixes = accountIds.map((x) =>
    (x.startsWith(id) ? x.slice(id.length) : "").replace(/\d+/g, "#"),
  );
  const declared = a.application.declared_liabilities;
  const links = declaredLinks(a);
  const lenderOf = new Map(tLiabs.map((l) => [l.id, l.lender]));
  const different = (provider: string, link: string | null) => {
    const lender = link ? lenderOf.get(link) : undefined;
    if (lender === undefined) return NaN;
    return b(genuinelyDifferent(provider, lender));
  };
  const balance = Number(
    (primary?.balance as { data?: { currentBalance?: string } } | undefined)?.data
      ?.currentBalance ?? NaN,
  );
  const months = new Set(lines.map((t) => (t.postingDateTime ?? "").slice(0, 7))).size;

  const app: Record<string, Value> = {
    // ids
    id_numeric_suffix: trailingInt(id),
    id_rank: rankOf.get(id) ?? NaN,
    id_inverted_counter: invertId(id, set.seed, set.applicants.length) / set.applicants.length,
    account_id_max_index: Math.max(-1, ...accountIds.map(trailingInt).filter(Number.isFinite)),
    account_id_suffixes: [...new Set(suffixes)].sort().join(","),
    // accounts
    n_shared_accounts: accounts.length,
    n_transaction_accounts: txAccounts.length,
    n_bsbs: new Set(accounts.map(bsbOf)).size,
    second_account_display: second ? (accData(second).displayName ?? "") : "∅",
    second_account_bsb: second ? bsbOf(second) : "∅",
    second_account_lines: secondLines.length,
    second_account_credit_share: share(
      secondLines.filter((t) => amt(t) > 0).length,
      secondLines.length,
    ),
    // liability_accounts
    has_loan_account: b(
      accounts.some((acc) =>
        ["PERS_LOANS", "RESIDENTIAL_MORTGAGES"].includes(accData(acc).productCategory ?? ""),
      ),
    ),
    has_card_account: b(
      accounts.some((acc) => accData(acc).productCategory === "CRED_AND_CHRG_CARDS"),
    ),
    // split
    n_pay_accounts: payAccounts.length,
    second_account_pay_share: share(
      secondLines.filter((t) => pay.has(t.transactionId)).length,
      secondLines.filter((t) => amt(t) > 0).length,
    ),
    // pay_amount
    pay_step_ratio:
      third > 0 ? median(payAmounts.slice(-third)) / median(payAmounts.slice(0, third)) : NaN,
    pay_cv: cv(payAmounts),
    pay_distinct_share: share(new Set(payAmounts).size, payAmounts.length),
    pay_max_over_median: payAmounts.length ? Math.max(...payAmounts) / median(payAmounts) : NaN,
    pay_count: payAmounts.length,
    // pay_descriptor
    n_pay_descriptors: payDescriptors.length,
    pay_descriptor_shape: shape(template(payDescriptors[0] ?? "")).replace(/A/g, "W"),
    // pay_reference
    pay_ref_share: share(payLines.filter((t) => t.reference).length, payLines.length),
    pay_ref_shape: [...refShapes].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "∅",
    nonpay_credit_payref_share: share(
      credits.filter((t) => !pay.has(t.transactionId) && /PAY|SAL|WAGE/i.test(t.reference)).length,
      credits.filter((t) => !pay.has(t.transactionId)).length,
    ),
    // fees
    n_fees: fees.length,
    max_fee: fees.length ? Math.max(...fees.map((t) => -amt(t))) : 0,
    n_fees_ge9: fees.filter((t) => -amt(t) >= 9).length,
    n_fee_descriptions: new Set(fees.map((t) => t.description)).size,
    // obligations
    n_direct_debits: dd.length,
    n_bpay: bpay.length,
    n_recurring_payees: [...recurring.values()].filter((n) => n >= 3).length,
    dd_cents_share: share(dd.filter((t) => absCents(t) % 100 !== 0).length, dd.length),
    dd_amount_mean_log: log10(mean(dd.map((t) => -amt(t)))),
    // declaration
    n_declared: declared.length,
    declared_upper_share: share(
      declared.filter((d) => caseStyle(d.provider) === "upper").length,
      declared.length,
    ),
    declared_type_suffix_share: share(
      declared.filter((d) => TYPE_SUFFIX.test(d.provider)).length,
      declared.length,
    ),
    declared_legal_suffix_share: share(
      declared.filter((d) => LEGAL_SUFFIX.test(d.provider)).length,
      declared.length,
    ),
    declared_types: declared
      .map((d) => d.type)
      .sort()
      .join(","),
    declared_repayment_log: log10(declared.reduce((s, d) => s + d.repayment_monthly, 0)),
    // declaration_identity
    declared_different_share: mean(
      declared.map((d, i) => different(d.provider, links[i] ?? null)).filter(Number.isFinite),
    ),
    // flows
    credits_per_month: share(credits.length, span),
    debits_per_month: share(debits.length, span),
    pos_share: share(lines.filter((t) => t.merchantCategoryCode).length, lines.length),
    history_months: span,
    months_with_lines: months,
    request_lookback: truth.v2?.request.lookback_months ?? NaN,
    closing_balance_log: Math.sign(balance) * log10(Math.abs(balance) + 1),
    // narrative_shape
    long_digit_run_share: share(
      lines.filter((t) => maxDigitRun(t.description) >= 6).length,
      lines.length,
    ),
    date_like_share: share(lines.filter((t) => dateLike(t.description)).length, lines.length),
    // timing
    weekend_share: share(lines.filter((t) => isWeekend(dayOf(t))).length, lines.length),
  };
  const appX = Object.fromEntries(Object.entries(app).map(([k, v]) => [`app_${k}`, v]));

  // Applicant labels and pools.
  const visible = items.filter((l) => {
    const t = tLiabs.find((x) => x.id === l.id);
    return (t?.repayment_transaction_ids.length ?? 0) > 0;
  });
  const appY: Record<string, boolean> = {};
  if (visible.length > 0) appY["A-undisclosed"] = visible.some((l) => !l.declared);
  if (allLines.some((t) => t.type === "DIRECT_DEBIT" && amt(t) < 0))
    appY["A-dishonour"] = (truth.v2?.dishonour_events.length ?? 0) > 0 || bouncedIds.size > 0;
  if (salaried && singlePayer) {
    appY["A-drift-over-time"] = truth.tags.includes("drift-over-time");
    appY["A-irregular-pay"] =
      !truth.tags.includes("drift-over-time") &&
      !truth.tags.includes("drift-across-banks") &&
      ["overtime", "bonus", "pay-rise"].some((t) => truth.tags.includes(t));
    if (payAccounts.length >= 2)
      appY["A-drift-across-banks"] = truth.tags.includes("drift-across-banks");
  }
  if (declared.length >= 2) appY["A-natural-group"] = truth.tags.includes("natural-declarations");
  appY["A-repaid-from-unshared"] = tLiabs.some((l) => !l.paid_from_shared);
  const units: Unit[] = [{ kind: "applicant", group: id, id, x: appX, y: appY }];

  // Liabilities with visible repayments.
  for (const l of tLiabs) {
    const item = items.find((i) => i.id === l.id);
    const rep = l.repayment_transaction_ids.flatMap((tid) => {
      const t = lineById.get(tid);
      return t ? [t] : [];
    });
    if (!item || rep.length === 0) continue;
    const first = rep[0] as Transaction;
    const repDays = rep.map(dayOf).sort((x, y) => x - y);
    const gaps = repDays.slice(1).map((d, i) => d - (repDays[i] ?? d));
    const loanAccount = l.account_id
      ? accOf.get(l.account_id)
      : accounts.find(
          (acc) =>
            LOAN_CATS.has(accData(acc).productCategory ?? "") &&
            (accData(acc).accountId ?? "").match(
              new RegExp(`-(l${Number(item.id.replace("liab-", ""))}|ccd)$`),
            ) &&
            (item.type === "credit_card") ===
              (accData(acc).productCategory === "CRED_AND_CHRG_CARDS"),
        );
    const x: Record<string, Value> = {
      ...appX,
      lia_liability_type: item.type,
      lia_line_type: first.type,
      lia_amount_log: log10(Math.abs(amt(first))),
      lia_amount_cv: cv(rep.map((t) => Math.abs(amt(t)))),
      lia_cents: absCents(first) % 100,
      lia_round_dollar: b(absCents(first) % 100 === 0),
      lia_amount_reuse: log10(ctx.amountApplicants.get(absCents(first)) ?? 0),
      lia_cadence_days: median(gaps),
      lia_dom: Number((first.postingDateTime ?? "").slice(8, 10)),
      lia_weekday: weekday(dayOf(first)),
      lia_digit_run: maxDigitRun(first.description),
      lia_template: template(first.description),
      lia_first_word: firstWord(first.description),
      lia_ref_shape: shape(first.reference),
      lia_has_biller: b(Boolean(first.billerCode)),
      lia_biller_code: first.billerCode ?? "∅",
      lia_biller_name: first.billerName ?? "∅",
      lia_names_per_code: first.billerCode ? (ctx.namesPerCode.get(first.billerCode) ?? 0) : 0,
      lia_account_in_grant: b(item.account_shared),
      lia_loan_account_index: loanAccount ? trailingInt(accData(loanAccount).accountId ?? "") : NaN,
      lia_declared: b(item.declared),
      lia_txn_id_numeric: trailingInt(first.transactionId),
    };
    const y: Record<string, boolean> = {
      "L-undisclosed": !item.declared,
      [`L-undisclosed:${item.type}`]: !item.declared,
      "L-unseen-lender": l.unseen_lender,
      "L-narrative-reference": l.narrative_ref !== null,
    };
    if (item.type === "credit_card") y["L-no-card-cue"] = !l.biller_cue;
    if (["credit_card", "personal_loan", "car_loan", "mortgage"].includes(item.type))
      y["L-account-in-grant"] = item.account_shared;
    units.push({ kind: "liability", group: id, id: `${id}|${l.id}`, x, y });
  }

  // Declarations.
  declared.forEach((d, i) => {
    const link = links[i] ?? null;
    const diff = different(d.provider, link);
    if (!Number.isFinite(diff)) return;
    units.push({
      kind: "declaration",
      group: id,
      id: `${id}|decl${i}`,
      x: {
        ...appX,
        decl_case: caseStyle(d.provider),
        decl_type_suffix: b(TYPE_SUFFIX.test(d.provider)),
        decl_legal_suffix: b(LEGAL_SUFFIX.test(d.provider)),
        decl_tokens: normName(d.provider).length,
        decl_length: d.provider.length,
        decl_type: d.type,
        decl_repayment_log: log10(d.repayment_monthly),
        decl_first_token_equal: 1 - diff,
        decl_first_token: normName(d.provider)[0] ?? "",
      },
      y: { "D-natural-form": diff === 1 },
    });
  });

  // Lines.
  const fullDayOrder = new Map<string, number>();
  for (const acc of accounts) {
    const byDay = new Map<number, Transaction[]>();
    for (const t of acc.transactions) {
      const list = byDay.get(dayOf(t)) ?? [];
      list.push(t);
      byDay.set(dayOf(t), list);
    }
    for (const list of byDay.values())
      list.forEach((t, k) =>
        fullDayOrder.set(t.transactionId, list.length > 1 ? k / (list.length - 1) : 0.5),
      );
  }
  const idRankVsChrono = new Map<string, number>();
  for (const acc of accounts) {
    const byId = [...acc.transactions].sort((x, y) => (x.transactionId < y.transactionId ? -1 : 1));
    const byDay = [...acc.transactions].sort((x, y) => dayOf(x) - dayOf(y));
    const chrono = new Map(byDay.map((t, k) => [t.transactionId, k]));
    byId.forEach((t, k) =>
      idRankVsChrono.set(
        t.transactionId,
        (k - (chrono.get(t.transactionId) ?? k)) / Math.max(1, byId.length),
      ),
    );
  }
  const feeMonths = new Map<string, Set<string>>();
  for (const t of allLines.filter((t) => t.type === "FEE")) {
    const k = `${t.description}|${t.amount}`;
    let s = feeMonths.get(k);
    if (!s) feeMonths.set(k, (s = new Set()));
    s.add((t.postingDateTime ?? "").slice(0, 7));
  }
  const templateCount = new Map<string, number>();
  for (const t of allLines)
    templateCount.set(
      template(t.description),
      (templateCount.get(template(t.description)) ?? 0) + 1,
    );
  // Own-account transfers: a credit matched by a debit of the same amount, the same day, in
  // another of the applicant's shared accounts.
  const ownTransfer = new Set(
    allLines
      .filter(
        (t) =>
          amt(t) > 0 &&
          allLines.some(
            (u) => u.accountId !== t.accountId && amt(u) === -amt(t) && dayOf(u) === dayOf(t),
          ),
      )
      .map((t) => t.transactionId),
  );
  const allDays = allLines.map(dayOf);
  const lastDay = Math.max(...allDays);
  for (const t of allLines) {
    const out = amt(t) < 0;
    const y: Record<string, boolean> = {};
    if (
      out &&
      (t.type === "DIRECT_DEBIT" ||
        t.billerCode ||
        (t.type === "PAYMENT" && !t.merchantCategoryCode))
    )
      y["T-repayment"] = repaymentOf.has(t.transactionId);
    if (!out && !ownTransfer.has(t.transactionId)) y["T-pay"] = pay.has(t.transactionId);
    if (t.type === "FEE") {
      const f = feeMonths.get(`${t.description}|${t.amount}`)?.size ?? 0;
      if (!(f >= 3 && f >= months / 2)) y["T-dishonour-fee"] = feeIds.has(t.transactionId);
    }
    if (pay.has(t.transactionId) && salaried && singlePayer) {
      if (t.accountId === mainPayAccount) y["T-drift-line-main"] = drift.has(t.transactionId);
      else y["T-drift-line-second"] = drift.has(t.transactionId);
    }
    if (t.billerCode) {
      const lid = repaymentOf.get(t.transactionId);
      y["T-card-repayment"] =
        lid !== undefined && items.find((i) => i.id === lid)?.type === "credit_card";
    }
    if (dishonour && t.type === "DIRECT_DEBIT" && out)
      y["T-bounced-debit"] = bouncedIds.has(t.transactionId);
    if (Object.keys(y).length === 0) continue;
    const day = dayOf(t);
    const acc = accOf.get(t.accountId);
    const reversal = allLines.some(
      (u) =>
        u.accountId === t.accountId &&
        u.transactionId !== t.transactionId &&
        Math.sign(amt(u)) === -Math.sign(amt(t)) &&
        absCents(u) === absCents(t) &&
        Math.abs(dayOf(u) - day) <= 5,
    );
    units.push({
      kind: "line",
      group: id,
      id: t.transactionId,
      x: {
        app_id_numeric_suffix: app.id_numeric_suffix ?? NaN,
        app_id_inverted_counter: app.id_inverted_counter ?? NaN,
        app_n_shared_accounts: app.n_shared_accounts ?? NaN,
        app_n_transaction_accounts: app.n_transaction_accounts ?? NaN,
        app_history_months: app.history_months ?? NaN,
        app_request_lookback: app.request_lookback ?? NaN,
        line_type: t.type,
        line_amount_log: log10(Math.abs(amt(t))),
        line_cents: absCents(t) % 100,
        line_round_dollar: b(absCents(t) % 100 === 0),
        line_amount_reuse: log10(ctx.amountApplicants.get(absCents(t)) ?? 0),
        line_dom: Number((t.postingDateTime ?? "").slice(8, 10)),
        line_weekday: weekday(day),
        line_days_before_end: lastDay - day,
        line_digit_run: maxDigitRun(t.description),
        line_date_like: b(dateLike(t.description)),
        line_template: template(t.description),
        line_first_word: firstWord(t.description),
        line_ref_shape: shape(t.reference),
        line_ref_empty: b(!t.reference),
        line_biller_code: t.billerCode ?? "∅",
        line_biller_name: t.billerName ?? "∅",
        line_merchant: t.merchantName ?? "∅",
        line_names_per_code: t.billerCode ? (ctx.namesPerCode.get(t.billerCode) ?? 0) : 0,
        line_codes_per_name: t.billerCode ? (ctx.codesPerName.get(t.billerName ?? "") ?? 0) : 0,
        line_account_category: acc ? (accData(acc).productCategory ?? "") : "∅",
        line_account_display: acc ? (accData(acc).displayName ?? "") : "∅",
        line_account_bsb: acc ? bsbOf(acc) : "∅",
        line_account_is_primary: b(t.accountId === primaryId),
        line_id_numeric: trailingInt(t.transactionId),
        line_id_rank_vs_chrono: idRankVsChrono.get(t.transactionId) ?? NaN,
        line_day_position: fullDayOrder.get(t.transactionId) ?? NaN,
        line_recurrence: templateCount.get(template(t.description)) ?? 0,
        line_reversal_nearby: b(reversal),
        line_fee_nearby: b(
          allLines.some((u) => u.type === "FEE" && u !== t && Math.abs(dayOf(u) - day) <= 3),
        ),
      },
      y,
    });
  }
  return units;
}
