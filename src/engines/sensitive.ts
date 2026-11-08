// GR-3 (Product Specification §9.2; SIG-42 review ruling 2, 8 November 2026): spending at medical
// providers, pharmacies, religious organisations, unions and political parties is excluded from
// every signal input. Enrich may categorise it; the engine must not read it. Every engine entry
// that reads transactions removes these lines first, with withoutSensitive; the exclusion list is
// below, and test/repo/gr3.test.ts enforces it. Interpretations G-1 to G-3 are in
// docs/adr/0007-gr3-sensitive-spending.md. Pure: no clock, no randomness, relative imports (D3).

/**
 * 1.1.0 (SIG-42 re-review direction 5, 8 November 2026): a liability repayment is never removed
 * as sensitive spending, whatever its merchant code. Each engine records this version.
 */
export const SENSITIVE_METHOD_VERSION = "1.1.0";

/**
 * Enrich categories for repayments of a loan, card, BNPL, SACC, mortgage or wage advance. They
 * are credit, not spending, so the gate never removes them (a BNPL repayment for a dental bill
 * carries the dentist's MCC, but it is still a liability the lender must see).
 */
export const LIABILITY_CATEGORIES: ReadonlySet<string> = new Set([
  "loan_repayment",
  "credit_card",
  "bnpl",
  "sacc_loan",
  "mortgage",
  "wage_advance",
]);

/**
 * Enrich category codes that are sensitive. Enrich taxonomy 1.4 has one: `healthcare`, which
 * covers medical providers and pharmacies (Enrich rule HLTH). The other five are reserved for
 * when Enrich adds them; `sensitive` is reserved for a payee Enrich marks sensitive, which
 * Enrich can't do yet (G-2; raised with the ENR private-transfer ticket).
 */
export const SENSITIVE_CATEGORIES: ReadonlySet<string> = new Set([
  "healthcare",
  "medical",
  "pharmacy",
  "religious",
  "union",
  "political",
  "sensitive",
]);

/**
 * Merchant category codes (ISO 18245) for the same five groups (G-3). Read when Enrich gives no
 * sensitive category, so a card payment at a pharmacy is excluded even if it's miscategorised.
 */
export const SENSITIVE_MCCS: Readonly<Record<string, string>> = Object.freeze({
  "4119": "medical (ambulance services)",
  "5122": "pharmacy (drugs and druggists' sundries)",
  "5912": "pharmacy (drug stores and pharmacies)",
  "5975": "medical (hearing aids)",
  "5976": "medical (orthopaedic goods)",
  "8011": "medical (doctors)",
  "8021": "medical (dentists and orthodontists)",
  "8031": "medical (osteopaths)",
  "8041": "medical (chiropractors)",
  "8042": "medical (optometrists)",
  "8043": "medical (opticians)",
  "8049": "medical (podiatrists)",
  "8050": "medical (nursing and personal care)",
  "8062": "medical (hospitals)",
  "8071": "medical (medical and dental laboratories)",
  "8099": "medical (medical services, not elsewhere classified)",
  "8651": "political organisations",
  "8661": "religious organisations",
  "8699": "unions (membership organisations, not elsewhere classified)",
});

type Tx = { transactionId: string; merchantCategoryCode?: string };

/** Medical and pharmacy: the codes and MCCs D29 lets into the living-expense total, unitemised. */
const HEALTH_CATEGORIES: ReadonlySet<string> = new Set(["healthcare", "medical", "pharmacy"]);
const isHealthMcc = (mcc: string | undefined) =>
  mcc !== undefined && /^(medical|pharmacy)/.test(SENSITIVE_MCCS[mcc] ?? "");

/**
 * D29: a sensitive line that is health spending (medical or pharmacy). It counts towards the
 * living-expense total as an aggregate only; it never feeds a signal or a decisioning input.
 */
export function isHealth(t: Tx, categories?: Readonly<Record<string, string>>): boolean {
  const category = categories?.[t.transactionId];
  if (category !== undefined && LIABILITY_CATEGORIES.has(category)) return false;
  if (category !== undefined && SENSITIVE_CATEGORIES.has(category))
    return HEALTH_CATEGORIES.has(category);
  return isHealthMcc(t.merchantCategoryCode);
}

/**
 * True when GR-3 excludes the transaction: by its Enrich category, or by its MCC. A liability
 * repayment is never excluded (1.1.0).
 */
export function isSensitive(t: Tx, categories?: Readonly<Record<string, string>>): boolean {
  const category = categories?.[t.transactionId];
  if (category !== undefined && LIABILITY_CATEGORIES.has(category)) return false;
  if (category !== undefined && SENSITIVE_CATEGORIES.has(category)) return true;
  return t.merchantCategoryCode !== undefined && t.merchantCategoryCode in SENSITIVE_MCCS;
}

/** The feed with every GR-3 line removed, in both directions; accounts and their order kept. */
export function withoutSensitive<F extends { accounts: { transactions: Tx[] }[] }>(
  feed: F,
  categories?: Readonly<Record<string, string>>,
): F {
  return {
    ...feed,
    accounts: feed.accounts.map((a) => ({
      ...a,
      transactions: a.transactions.filter((t) => !isSensitive(t, categories)),
    })),
  };
}
