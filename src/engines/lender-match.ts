// SIG-83 (research/preregistrations/SIG-83.json; ruling 40766): the listed lender a text names, as
// LIA's display matching (families/lia/lenders.ts, lenderOf) names one: the longest name on
// LENDER_NAMES 1.2.0 that the text's words start with, tried as written, then with the product
// words skipped, then with the product and sensitive words skipped. A word of digits only is
// dropped first. Read by the detector's category-independent step (d); it never falls back to a
// first word, and it reads no alias table. Kept apart from lenders.ts, whose display output is
// pinned, so that neither moves the other. Pure: no clock, no randomness, relative imports (D3).
import { cleanText, isSensitiveWord } from "./display-mask.js";
import { LENDER_NAMES } from "./lender-names.js";

const LISTED = [...LENDER_NAMES].map((n) => n.split(" ")).sort((a, b) => b.length - a.length);
/** lenders.ts's skipped words: the detector's product words and LIA's transfer words. */
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
const formsOf = (text: string): string[] =>
  (cleanText(text).toUpperCase().match(WORD) ?? [])
    .map((w) => w.normalize("NFKC").toUpperCase())
    .filter((w) => !/^\p{N}+$/u.test(w));
const listed = (forms: string[]) =>
  LISTED.find((n) => n.length <= forms.length && n.every((w, i) => forms[i] === w));

/** The listed lender name the text starts with, or null when it names none. */
export function listedLenderOf(text: string): string | null {
  const forms = formsOf(text);
  const hit =
    listed(forms) ??
    listed(forms.filter((f) => !SKIP.has(f))) ??
    listed(forms.filter((f) => !SKIP.has(f) && !isSensitiveWord(f)));
  return hit ? hit.join(" ") : null;
}
