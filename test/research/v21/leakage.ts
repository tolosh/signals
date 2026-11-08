// SIG-54 set v2.1: the leakage measures. Each one is a channel the set v2 review (8 November
// 2026, 14:20) found a detector could use to recover the truth from the feed by construction.
// Each returns a number that is high on a leaky set; leakage.test.ts runs every measure on set v2
// (the negative control, which must be caught) and on set v2.1 (which must be clean).
import type { GeneratedApplicant, Transaction } from "../../../src/research/generator/index.js";

const txs = (a: GeneratedApplicant): Transaction[] =>
  a.feed.accounts.flatMap((acc) => acc.transactions);
const primaryTag = (a: GeneratedApplicant) => a.truth.tags[0] ?? "";
const amountOf = (t: Transaction) => Math.abs(Number(t.amount));
const share = (n: number, d: number) => (d === 0 ? 0 : n / d);

/** 1. IDs: with applicants sorted by ID, how often neighbours share a group, over the base rate. */
export function idGroupAdjacency(set: GeneratedApplicant[]): { observed: number; base: number } {
  const sorted = [...set].sort((a, b) => (a.truth.applicant_id < b.truth.applicant_id ? -1 : 1));
  let same = 0;
  for (let i = 1; i < sorted.length; i++)
    if (primaryTag(sorted[i]!) === primaryTag(sorted[i - 1]!)) same++;
  const counts = new Map<string, number>();
  for (const a of set) counts.set(primaryTag(a), (counts.get(primaryTag(a)) ?? 0) + 1);
  const base = [...counts.values()].reduce((s, c) => s + (c / set.length) ** 2, 0);
  return { observed: share(same, sorted.length - 1), base };
}
/** 1b. IDs carry a sequential number (syn-v2-0073), from which the allocation block is read. */
export const sequentialIds = (set: GeneratedApplicant[]) =>
  share(set.filter((a) => /-\d{4}$/.test(a.truth.applicant_id)).length, set.length);

/** Every labelled loan, card, BNPL, SACC and wage-advance repayment's transaction ID. */
const repaymentIds = (set: GeneratedApplicant[]) =>
  new Set(
    set.flatMap((a) => (a.truth.v2?.liabilities ?? []).flatMap((l) => l.repayment_transaction_ids)),
  );

/** 2. Type and amount: the share of direct debits that are loan repayments (the rule's precision). */
export function directDebitPrecision(set: GeneratedApplicant[]): number {
  const ids = repaymentIds(set);
  const dd = set.flatMap(txs).filter((t) => t.type === "DIRECT_DEBIT");
  return share(dd.filter((t) => ids.has(t.transactionId)).length, dd.length);
}
/** 2b. The share of direct-debit repayments covered by the five most common amounts. */
export function topAmountsShare(set: GeneratedApplicant[]): number {
  const ids = repaymentIds(set);
  const amounts = set
    .flatMap(txs)
    .filter((t) => t.type === "DIRECT_DEBIT" && ids.has(t.transactionId))
    .map(amountOf);
  const c = new Map<number, number>();
  for (const x of amounts) c.set(x, (c.get(x) ?? 0) + 1);
  const top = [...c.values()].sort((x, y) => y - x).slice(0, 5);
  return share(
    top.reduce((s, x) => s + x, 0),
    amounts.length,
  );
}

/** 3. Pay references: precision and recall of "the reference reads PAY <date>" for pay credits. */
export function payReference(set: GeneratedApplicant[]): { precision: number; recall: number } {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const a of set) {
    const aliases = new Set((a.truth.v2?.payers ?? []).flatMap((p) => p.aliases));
    for (const t of txs(a)) {
      if (Number(t.amount) <= 0) continue;
      const isPay = aliases.has(t.description);
      const rule = /^PAY \d{4}-\d{2}-\d{2}$/.test(t.reference);
      if (rule && isPay) tp++;
      else if (rule) fp++;
      else if (isPay) fn++;
    }
  }
  return { precision: share(tp, tp + fp), recall: share(tp, tp + fn) };
}

/** 4. Biller codes: card issuers sharing one code, and card cues in the no-cue group. */
export function billerCodes(set: GeneratedApplicant[]): {
  sharedCodes: number;
  cueInNoCue: number;
} {
  const issuers = new Map<string, Set<string>>();
  let cueInNoCue = 0;
  for (const a of set) {
    const noCue = a.truth.tags.includes("no-card-biller-cue");
    // The issuer is the truth's lender for the liability this repayment belongs to.
    const lenderOf = new Map(
      (a.truth.v2?.liabilities ?? []).flatMap((l) =>
        l.repayment_transaction_ids.map((id) => [id, l.lender] as const),
      ),
    );
    for (const b of a.truth.v2?.bpay ?? []) {
      if (b.kind !== "card_repayment") continue;
      const issuer = lenderOf.get(b.transaction_id ?? "") ?? b.biller_name;
      issuers.set(b.biller_code, (issuers.get(b.biller_code) ?? new Set()).add(issuer));
      if (noCue && /\bCARDS?\b/i.test(b.biller_name)) cueInNoCue++;
    }
  }
  return { sharedCodes: [...issuers.values()].filter((s) => s.size > 1).length, cueInNoCue };
}

/** 5. Second-bank accounts: the share of applicants outside drift-across-banks whose shared
 * transaction accounts sit at two or more institutions (distinct BSB bank codes). */
export function secondBankElsewhere(set: GeneratedApplicant[]): number {
  const others = set.filter((a) => !a.truth.tags.includes("drift-across-banks"));
  const banks = (a: GeneratedApplicant) =>
    new Set(
      a.feed.accounts
        .filter(
          (x) =>
            (x.account as { productCategory?: string }).productCategory ===
            "TRANS_AND_SAVINGS_ACCOUNTS",
        )
        .map((x) => ((x.detail as { data?: { bsb?: string } })?.data?.bsb ?? "").slice(0, 2)),
    ).size;
  return share(others.filter((a) => banks(a) >= 2).length, others.length);
}

const normalise = (name: string) =>
  name
    .toUpperCase()
    .replace(/\b(PTY|LTD|LIMITED|GROUP|BANK OF|THE)\b/g, " ")
    .replace(/\b(CREDIT CARD|CARD|PERSONAL LOAN|CAR LOAN|LOAN|FINANCE|BNPL)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
/** 6. Declarations: mixed case outside the natural and unseen groups; genuine difference within. */
export function declarations(set: GeneratedApplicant[]): {
  mixedCaseElsewhere: number;
  genuinelyDifferentNatural: number;
} {
  let elsewhere = 0;
  let elsewhereMixed = 0;
  let natural = 0;
  let different = 0;
  for (const a of set) {
    const isNatural = a.truth.tags.includes("natural-declarations");
    const isUnseen = a.truth.tags.includes("unseen-lenders");
    for (const d of a.application.declared_liabilities) {
      if (!isNatural && !isUnseen) {
        elsewhere++;
        if (/[a-z]/.test(d.provider)) elsewhereMixed++;
      }
    }
    if (isNatural)
      for (const l of a.truth.v2?.liabilities ?? []) {
        if (!l.declared_as) continue;
        natural++;
        // Genuinely different: not the feed name plus a suffix or a loan type. "Plenti Finance"
        // for PLENTI or "Zip Co" for ZIP PAY is the same name; "Commonwealth Bank" for CBA isn't.
        const lead = (x: string) => normalise(x).split(" ")[0] ?? "";
        if (lead(l.declared_as) !== lead(l.lender)) different++;
      }
  }
  return {
    mixedCaseElsewhere: share(elsewhereMixed, elsewhere),
    genuinelyDifferentNatural: share(different, natural),
  };
}

/** 8. Dishonours: the share of FEE lines that are dishonour fees, and the variety of fee amounts. */
export function dishonours(set: GeneratedApplicant[]): {
  feeIsDishonour: number;
  feeAmounts: number;
  withReturnedDebit: number;
} {
  let fees = 0;
  let dishonourFees = 0;
  const amounts = new Set<number>();
  let events = 0;
  let returned = 0;
  for (const a of set) {
    const ids = new Set((a.truth.v2?.dishonour_events ?? []).map((e) => e.transaction_id));
    const all = txs(a);
    for (const t of all)
      if (t.type === "FEE") {
        fees++;
        if (ids.has(t.transactionId)) {
          dishonourFees++;
          amounts.add(amountOf(t));
        }
      }
    for (const e of a.truth.v2?.dishonour_events ?? []) {
      events++;
      const day = e.date;
      if (
        all.some(
          (t) =>
            t.type !== "FEE" &&
            Number(t.amount) > 0 &&
            (t.postingDateTime ?? "").startsWith(day) &&
            /RETURN|DISHONOUR|REVERS/i.test(t.description),
        )
      )
        returned++;
    }
  }
  return {
    feeIsDishonour: share(dishonourFees, fees),
    feeAmounts: amounts.size,
    withReturnedDebit: share(returned, events),
  };
}

/** 9. Payer drift: distinct employer pairs, and how often amount or reference alone links them. */
export function payerDrift(set: GeneratedApplicant[]): {
  pairs: number;
  linkedByAmount: number;
  linkedByReference: number;
} {
  const pairs = new Set<string>();
  let drifted = 0;
  let byAmount = 0;
  let byRef = 0;
  for (const a of set) {
    if (!a.truth.tags.includes("salaried-payer-drift")) continue;
    for (const p of a.truth.v2?.payers ?? []) {
      if (p.aliases.length < 2) continue;
      drifted++;
      pairs.add(p.aliases.slice().sort().join(" | "));
      const [first, second] = p.aliases;
      const credits = (name: string | undefined) =>
        txs(a).filter((t) => t.description === name && Number(t.amount) > 0);
      const x = credits(first);
      const y = credits(second);
      const amountsX = new Set(x.map(amountOf));
      if (y.length > 0 && y.every((t) => amountsX.has(amountOf(t)))) byAmount++;
      const fmt = (r: string) => r.replace(/\d/g, "9");
      const refsX = new Set(x.map((t) => fmt(t.reference)));
      if (y.length > 0 && y.every((t) => t.reference !== "" && refsX.has(fmt(t.reference))))
        byRef++;
    }
  }
  return {
    pairs: pairs.size,
    linkedByAmount: share(byAmount, drifted),
    linkedByReference: share(byRef, drifted),
  };
}
