// SIG-42 ruling 2 (10 November 2026, 06:39): how LIA names a lender in text (D29). A short,
// versioned list of known multi-word Australian lender names is matched first; any other name
// falls back to its first word, an interim rule until SIG-57's lender aliases replace it (ADR
// 0006). The list is lender names only: a match returns the list's name, which is also the start
// of the bank's description, so it never echoes more of the description than the name.
//
// Names are upper case ASCII letters and digits, single spaces. From 1.1.0 (the 13:00 ruling of
// 10 November) the list is matched on the bank's description before digits are stripped, so
// Money3 shows as "MONEY3"; the detector's provider form drops digits. Reference numbers (words
// of digits only) and the detector's product words are skipped, as in the provider form. A
// one-word lender without a digit (Nimble, Plenti) needs no entry: the first-word rule names it.
//
// No reserved unseen-lender name of the synthetic sets may be added here (catalog.ts; checked
// by test/research/lender-names.test.ts), or those groups stop testing lenders the engines have
// never named.

export const LENDER_NAMES_VERSION = "1.1.0";

export const LENDER_NAMES: readonly string[] = [
  "AMERICAN EXPRESS",
  "BANK OF MELBOURNE",
  "BANK OF QUEENSLAND",
  "BENDIGO BANK",
  "CASH CONVERTERS",
  "COMMONWEALTH BANK",
  "GREAT SOUTHERN BANK",
  "MACQUARIE BANK",
  "MONEY3",
  "ST GEORGE",
  "WALLET WIZARD",
];

const LISTED = [...LENDER_NAMES].map((n) => n.split(" ")).sort((a, b) => b.length - a.length);

/** Words the provider form drops: the detector's product words and LIA's transfer words. */
const SKIP = new Set([
  "LOAN",
  "REPAYMENT",
  "REPAYMENTS",
  "INSTALMENT",
  "PAYMENT",
  "CREDIT",
  "CARD",
  "PTY",
  "LTD",
  "BPAY",
  "DISBURSEMENT",
  "DRAWDOWN",
  "FUNDS",
  "ADVANCE",
  "TRANSFER",
  "TO",
  "FROM",
]);
/** The provider form with digits kept: words of digits only (references) are dropped. */
const wordsOf = (text: string) =>
  text
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^\d+$/.test(w) && !SKIP.has(w));
const listed = (words: string[]) => LISTED.find((n) => n.every((w, i) => words[i] === w));

/**
 * The lender a provider names: the longest listed name its description (or, without one, the
 * provider) starts with, else the provider's first word.
 */
export function lenderOf(provider: string, description?: string): string {
  const words = provider.split(" ");
  const hit =
    (description === undefined ? undefined : listed(wordsOf(description))) ?? listed(words);
  return hit ? hit.join(" ") : (words[0] ?? provider);
}
