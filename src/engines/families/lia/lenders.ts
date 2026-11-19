// SIG-42 ruling 2 (10 November 2026, 06:39): how LIA names a lender in text (D29). A short,
// versioned list of known multi-word Australian lender names is matched first; any other name
// falls back to its first word, an interim rule until SIG-57's lender aliases replace it (ADR
// 0006). The list is lender names only: a match returns the list's name, which is also the start
// of the bank's description, so it never echoes more of the description than the name.
//
// Names are upper case ASCII letters and digits, single spaces (a name outside the list keeps
// its Unicode letters from 1.3.4: ZÖP, ÉCO). From 1.1.0 (the 13:00 ruling of
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
/**
 * Sensitive words (SIG-42 ruling 2 of 16 November 2026, on review 10): a displayed name never
 * shows one. In a lender's name they are skipped, so the next word that isn't sensitive names it
 * ("IVF NIMBLE REPAY" is NIMBLE), or "a lender" when none is left; in the applicant's declared
 * text each one shows as "[withheld]". GR-3's groups (medical and pharmacy, religious, unions,
 * political parties, ADR 0007), as words a narrative or an applicant writes. Whole words, after
 * NFC and upper-casing; a stem ending in * covers its endings (PSYCH* for PSYCHOLOGY).
 */
export const SENSITIVE_WORDS: readonly string[] = [
  // medical and pharmacy
  "IVF",
  "FERTILITY",
  "CLINIC",
  "CLINICS",
  "HOSPITAL",
  "HOSPITALS",
  "MEDICAL",
  "MEDICARE",
  "MEDICINE",
  "DOCTOR",
  "DOCTORS",
  "GP",
  "APPT",
  "APPOINTMENT",
  "SURGERY",
  "SURGICAL",
  "ONCOLOG*",
  "CANCER",
  "CHEMO*",
  "RADIOLOG*",
  "PATHOLOG*",
  "DENTAL",
  "DENTIST",
  "DENTISTS",
  "DENTISTRY",
  "ORTHODONT*",
  "SMILE",
  "PSYCH*",
  "COUNSELLING",
  "COUNSELLOR",
  "THERAPY",
  "THERAPIST",
  "REHAB",
  "REHABILITATION",
  "PHYSIO*",
  "CHIRO*",
  "OSTEO*",
  "PODIAT*",
  "OPTOMETR*",
  "AUDIOLOG*",
  "HEARING",
  "HEALTH",
  "PHARMACY",
  "PHARMACIES",
  "CHEMIST",
  "CHEMISTS",
  "DISPENSARY",
  // religious
  "CHURCH",
  "PARISH",
  "DIOCESE",
  "MOSQUE",
  "SYNAGOGUE",
  "TEMPLE",
  "GURDWARA",
  "TITHE",
  // unions and political parties
  "UNION",
  "PARTY",
];
const STEMS = SENSITIVE_WORDS.filter((w) => w.endsWith("*")).map((w) => w.slice(0, -1));
const WORDS = new Set(SENSITIVE_WORDS.filter((w) => !w.endsWith("*")));
/** True when a word, in any case, is sensitive. */
export const isSensitiveWord = (word: string): boolean => {
  const w = word.normalize("NFC").toUpperCase();
  return WORDS.has(w) || STEMS.some((s) => w.startsWith(s));
};
const WORD = /[\p{L}\p{M}\p{N}]+/gu;
/** The applicant's own text, as written, with each sensitive word shown as "[withheld]". */
export const withheld = (text: string): string =>
  text.normalize("NFC").replace(WORD, (w) => (isSensitiveWord(w) ? "[withheld]" : w));
/** The name shown when every word of a lender's name is sensitive. */
export const NO_NAME = "a lender";

/**
 * The description's words, upper case, Unicode letters kept (ZÖP, ÉCO, from 1.3.4): words of
 * digits only (references) and the product words are dropped. They are read only to match the
 * list (no listed name has a sensitive word) and to spell the provider's own first word, which
 * is never sensitive, so sensitive words need no filter here.
 */
const wordsOf = (text: string) =>
  (text.normalize("NFC").toUpperCase().match(WORD) ?? []).filter(
    (w) => !/^\p{N}+$/u.test(w) && !SKIP.has(w),
  );
/** A word in the detector's provider form: A to Z only, anything else a space (ZÖP is "Z P"). */
const asciiOf = (word: string) =>
  word
    .replace(/[^A-Z]+/g, " ")
    .trim()
    .split(" ");
const listed = (words: string[]) => LISTED.find((n) => n.every((w, i) => words[i] === w));

/**
 * The lender a provider names: the longest listed name its description (or, without one, the
 * provider) starts with, else the provider's first word, as the description writes it (so ZÖP
 * keeps its letters). Sensitive words are skipped first (ruling 2 of 16 November 2026); a name
 * with nothing else is "a lender".
 */
export function lenderOf(provider: string, description?: string): string {
  const words = provider.split(" ").filter((w) => w !== "" && !isSensitiveWord(w));
  const described = description === undefined ? [] : wordsOf(description);
  const hit = listed(described) ?? listed(words);
  if (hit) return hit.join(" ");
  const first = words[0];
  if (first === undefined) return NO_NAME;
  // The description's word that the provider form wrote as its first word(s).
  const written = described.find((w) => {
    const ascii = asciiOf(w);
    return ascii[0] === first && ascii.every((a, i) => words[i] === a);
  });
  return written ?? first;
}
