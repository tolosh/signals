// How LIA names a lender in text (D29; SIG-42 ruling 2 of 10 November 2026; SIG-64). A known
// lender name (lender-names.ts) is matched first and shown in full; any other name falls back to
// the provider's first word that isn't sensitive, as the bank's description writes it (an
// interim rule until SIG-57's lender aliases replace it, ADR 0006). The list is lender names
// only: a match returns the list's name, which is also the start of the bank's description, so it
// never echoes more of the description than the name.
//
// SIG-64 (LIA 1.3.5, LENDER_NAMES 1.2.0): the sensitive words are the shared keyword list
// (display-mask.ts, matched after NFKC with format characters removed); a listed name is never
// masked; the name shown is NFC and carries no reference digits (NIMBLE4417 shows NIMBLE; the
// regression of 1.3.4, review 12 E3), though a listed name keeps its own (MONEY3); a word written
// in NFD is still found (ZÖP). This is display only: what LIA counts reads lenderKeyOf
// (lender-key.ts), LIA 1.3.4's rule, unchanged.
//
// SIG-74 (LIA 1.3.6; review 16, E6): a narrative or product name is read joined, with every
// invisible character removed, so a split keyword is masked whole and never shown in pieces.
import { SENSITIVE_KEYWORDS, cleanText, isSensitiveWord, maskText } from "../../display-mask.js";
import { LENDER_NAMES, LENDER_NAMES_VERSION } from "../../lender-names.js";
import { accountProvider, normaliseProvider } from "../../liabilities/index.js";

export { LENDER_NAMES, LENDER_NAMES_VERSION, isSensitiveWord };
export { lenderKeyOf } from "./lender-key.js";
/** The sensitive words LIA's displayed text never shows: the shared list (SIG-64). */
export const SENSITIVE_WORDS: readonly string[] = SENSITIVE_KEYWORDS;
/** The applicant's own text, as written, with each sensitive word shown as "[withheld]". */
export const withheld = (text: string): string => maskText(text);
/** The name shown when every word of a lender's name is sensitive. */
export const NO_NAME = "a lender";

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
const WORD = /[\p{L}\p{M}\p{N}]+/gu;
type Word = { shown: string; form: string };
/** A description's words, references (digits only) left out: as shown (NFC) and as matched. */
const wordsOf = (text: string): Word[] =>
  (cleanText(text).toUpperCase().match(WORD) ?? [])
    .map((w) => ({ shown: w, form: w.normalize("NFKC").toUpperCase() }))
    .filter((w) => !/^\p{N}+$/u.test(w.form));
/** A word in the detector's provider form: A to Z only, anything else a space (ZÖP is "Z P"). */
const asciiOf = (word: string) =>
  word
    .replace(/[^A-Z]+/g, " ")
    .trim()
    .split(" ");
const listed = (forms: string[]) =>
  LISTED.find((n) => n.length <= forms.length && n.every((w, i) => forms[i] === w));
/** The name with its digit runs taken out, unless that leaves nothing. */
const noDigits = (name: string) => name.replace(/\p{N}+/gu, "") || name;

/** A text in the detector's provider form, without the words the provider form drops. */
const providerWords = (text: string) =>
  normaliseProvider(text)
    .split(" ")
    .filter((w) => w !== "" && !SKIP.has(w));
/** The same, read as a person reads it: invisible characters removed first (SIG-74). */
const joinedWords = (text: string) => providerWords(cleanText(text).normalize("NFKC"));
/**
 * Provider words with each run that an invisible character split put back together (SIG-74):
 * adjacent words whose letters, joined, are one word of the text read joined ("IV F" from
 * "IV<ZWSP>F" is IVF). Every other word is left as it was, so text without invisible characters
 * names its lender exactly as LIA 1.3.5 did.
 */
const healed = (words: string[], text: string): string[] => {
  const joined = new Set(joinedWords(text));
  const out: string[] = [];
  for (let i = 0; i < words.length;) {
    let j = words.length;
    while (j > i + 1 && !joined.has(words.slice(i, j).join(""))) j--;
    out.push(j > i + 1 ? words.slice(i, j).join("") : (words[i] ?? ""));
    i = j > i + 1 ? j : i + 1;
  }
  return out;
};
/** True when `name` is a proper piece of a sensitive word of `text`, read joined (SIG-74). */
const pieceOfSensitive = (name: string, text: string) =>
  wordsOf(text).some((w) => w.form !== name && w.form.includes(name) && isSensitiveWord(w.form));

/**
 * How LIA names lenders and accounts for display. `joined` (on from LIA 1.3.6, SIG-74) reads a
 * narrative or a product name with its invisible characters removed, so a keyword split by one
 * ("IV<ZWSP>F") is the whole keyword, and masked, never a fragment ("IV"); `joined: false` is LIA
 * 1.3.5, for the mutation test (T5).
 */
export function makeLenderDisplay(o: { joined: boolean }) {
  /**
   * The lender a provider names, for display: the longest listed name its description (or,
   * without one, the provider) starts with, as written or with product or sensitive words
   * skipped; else the provider's first word that isn't sensitive, as the description writes it
   * (NFC, digits taken out), or "a lender" when none is left.
   */
  function lenderOf(provider: string, description?: string): string {
    // SIG-74: a word an invisible character split is put back together before it is read.
    const written0 = provider.split(" ").filter((w) => w !== "");
    const words = (
      o.joined && description !== undefined ? healed(written0, description) : written0
    ).filter((w) => !isSensitiveWord(w));
    const described = description === undefined ? [] : wordsOf(description);
    const forms = described.map((w) => w.form);
    const hit =
      listed(forms) ??
      listed(forms.filter((f) => !SKIP.has(f))) ??
      listed(forms.filter((f) => !SKIP.has(f) && !isSensitiveWord(f))) ??
      listed(wordsOf(provider).map((w) => w.form)) ??
      listed(words);
    if (hit) return hit.join(" ");
    const first = words[0];
    if (first === undefined) return NO_NAME;
    // The description's word that the provider form wrote as its first word(s), in NFC or NFD.
    const written = described.find((w) =>
      [w.shown, w.shown.normalize("NFD")].some((s) => {
        const ascii = asciiOf(s);
        return ascii[0] === first && ascii.every((a, i) => words[i] === a);
      }),
    );
    const name = noDigits(written?.shown ?? first);
    // SIG-74: a name that is a piece of a sensitive word, read joined, is never shown.
    if (o.joined && pieceOfSensitive(name, description ?? provider)) return NO_NAME;
    return name;
  }

  /**
   * An account's name, for display, from its product name: shown whole unless it has a sensitive
   * word, then named as a lender is. From 1.3.6 the product name is read joined, so "I<ZWSP>VF
   * Lending" is IVF, masked, never "I VF LENDING".
   */
  function accountNameOf(productName: string, provider: string): string {
    const shown = o.joined ? accountProvider(cleanText(productName).normalize("NFKC")) : provider;
    return maskText(shown) !== shown ? lenderOf(shown) : shown;
  }

  return { lenderOf, accountNameOf };
}

const display = makeLenderDisplay({ joined: true });
export const lenderOf = display.lenderOf;
export const accountNameOf = display.accountNameOf;
