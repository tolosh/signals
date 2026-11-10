// SIG-42 ruling 2 (10 November 2026, 06:39): how LIA names a lender in text (D29). A short,
// versioned list of known multi-word Australian lender names is matched first; any other name
// falls back to its first word, an interim rule until SIG-57's lender aliases replace it (ADR
// 0006). The list is lender names only: a match returns the list's name, which is also the start
// of the bank's description, so it never echoes more of the description than the name.
//
// Names are in the detector's provider form (normaliseProvider: upper case ASCII letters, digits
// and punctuation gone, single spaces). A one-word lender (Nimble, Plenti) needs no entry: the
// first-word rule already names it. Money3 loses its digit in that form and shows as "MONEY".
//
// No reserved unseen-lender name of the synthetic sets may be added here (catalog.ts; checked
// by test/research/lender-names.test.ts), or those groups stop testing lenders the engines have
// never named.

export const LENDER_NAMES_VERSION = "1.0.0";

export const LENDER_NAMES: readonly string[] = [
  "AMERICAN EXPRESS",
  "BANK OF MELBOURNE",
  "BANK OF QUEENSLAND",
  "BENDIGO BANK",
  "CASH CONVERTERS",
  "COMMONWEALTH BANK",
  "GREAT SOUTHERN BANK",
  "MACQUARIE BANK",
  "ST GEORGE",
  "WALLET WIZARD",
];

const LISTED = [...LENDER_NAMES].map((n) => n.split(" ")).sort((a, b) => b.length - a.length);

/** The lender a provider names: the longest listed name it starts with, else its first word. */
export function lenderOf(provider: string): string {
  const words = provider.split(" ");
  const hit = LISTED.find((n) => n.every((w, i) => words[i] === w));
  return hit ? hit.join(" ") : (words[0] ?? provider);
}
