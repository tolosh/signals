// SIG-74: the all-positions corpus, and an oracle for keywords and keyword fragments that reads
// only the committed word list (words.ts), never src/.
//
// Each applicant carries one keyword K, split by one invisible character at every interior
// position (or unsplit, for its plain control). Each position is its own slot, with its own
// lender word, in five contexts: a loan repayment narrative, a SACC and a BNPL narrative, a loan
// and a card account's product name, a declaration, and a payer.
//
// The oracle normalises every output string as a person reads it (NFKC; every Unicode
// default-ignorable code point and U+2800 removed; upper case). A leak is either a keyword from the
// committed list outside a known lender name or CREDIT UNION, or a fragment of K (2 or more
// letters, either side of a split) that the output shows more often than the plain control's
// output does. Counting against the plain control keeps ordinary words (ON, AN) out.
import { LENDER_NAMES } from "../../../src/engines/families/lia/lenders.js";
import { repeat, type Line } from "../../families/lia/script.js";
import { runProbe, strings, type ProbeRun } from "../sig64/probes.js";
import { ORACLE_WORDS } from "./words.js";

/** The invisible characters SIG-74 T1 splits with. */
export const SPLITTERS: readonly [string, string][] = [
  ["ZWSP", "\u200b"],
  ["ZWNJ", "\u200c"],
  ["ZWJ", "\u200d"],
  ["SHY", "\u00ad"],
  ["U+2060", "\u2060"],
  ["U+034F", "\u034f"],
  ["U+FE0F", "\ufe0f"],
  ["U+2800", "\u2800"],
];
export const KEYWORDS: readonly string[] = ORACLE_WORDS.map((w) => w.replace(/\*$/, ""));

const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\u2800]/gu;
const TOKEN = /[\p{L}\p{M}\p{N}]+/gu;
/** A text as a person reads it, as tokens. */
export const tokensOf = (s: string): string[] =>
  s.normalize("NFKC").replace(INVISIBLE, "").toUpperCase().match(TOKEN) ?? [];

const stems = ORACLE_WORDS.filter((w) => w.endsWith("*")).map((w) => w.slice(0, -1));
const words = new Set(ORACLE_WORDS.filter((w) => !w.endsWith("*")));
const hit = (t: string) => words.has(t) || stems.some((s) => t.startsWith(s));
const phrases = [...LENDER_NAMES, "CREDIT UNION"].map((p) => p.split(" "));

/** The keywords a text shows outside a known lender name or CREDIT UNION. */
export function keywordsIn(text: string): string[] {
  const tokens = tokensOf(text);
  const exempt = new Set<number>();
  for (const p of phrases)
    for (let i = 0; i + p.length <= tokens.length; i++)
      if (p.every((w, j) => tokens[i + j] === w))
        for (let j = 0; j < p.length; j++) exempt.add(i + j);
  return tokens.filter(
    (t, i) =>
      !exempt.has(i) && (hit(t) || (t.match(/\p{L}+/gu) ?? []).some((r) => r !== t && hit(r))),
  );
}

/** The fragments of K a split can leave: each side of each interior position, 2 letters or more. */
export const fragmentsOf = (k: string): string[] => [
  ...new Set(
    Array.from({ length: k.length - 1 }, (_, i) => [k.slice(0, i + 1), k.slice(i + 1)])
      .flat()
      .filter((f) => f.length >= 2),
  ),
];

/** A distinct, non-sensitive lender word per slot: XAVOAA, XAVOBA, ... */
export const lenderWord = (n: number) =>
  `XAVO${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + Math.floor(n / 26))}`;

/** K split by `c` at every interior position, or K at each slot when `c` is null. */
export const writtenForms = (k: string, c: string | null): string[] =>
  Array.from({ length: Math.max(1, k.length - 1) }, (_, i) =>
    c === null || k.length < 2 ? k : `${k.slice(0, i + 1)}${c}${k.slice(i + 1)}`,
  );

/** One applicant for keyword K and splitter c (null: the plain control). */
export function applicantFor(k: string, c: string | null): ProbeRun {
  const forms = writtenForms(k, c);
  const lines: Line[] = forms.flatMap((w, n) => {
    const l = lenderWord(n);
    return [
      ...repeat(6, 30, {
        description: `${w} ${l} PERSONAL LOAN 88123`,
        amount: -(300 + 37 * n),
        category: "loan_repayment",
      }),
      ...repeat(
        13,
        14,
        { description: `${w} ${l} REPAY`, amount: -(40 + n), category: "sacc_loan" },
        3,
      ),
      ...repeat(13, 14, { description: `${w} ${l} BNPL`, amount: -(20 + n), category: "bnpl" }, 4),
      ...repeat(6, 14, { description: `${w} ${l} PAYROLL`, amount: 900 + 11 * n }, 1),
    ];
  });
  const declared = forms.map((w, n) => ({
    type: "personal_loan",
    provider: `${w} ${lenderWord(n)} loan`,
    repayment_monthly: 300 + 37 * n,
  }));
  const accounts = forms.flatMap((w, n) => [
    {
      accountId: `acc-l${n}`,
      productCategory: "PERS_LOANS",
      productName: `${w} ${lenderWord(n)} Lending`,
    },
    {
      accountId: `acc-c${n}`,
      productCategory: "CRED_AND_CHRG_CARDS",
      productName: `${w} ${lenderWord(n)} Visa`,
    },
  ]);
  return runProbe(lines, declared, accounts);
}

const count = (tokens: string[]) => {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
};
/** Keywords, and fragments of K shown more often than in the plain control, in a run's output. */
export function leaksOf(k: string, split: ProbeRun, plain: ProbeRun): string[] {
  const out = strings(split);
  const keywords = out.flatMap(keywordsIn);
  const now = count(out.flatMap(tokensOf));
  const base = count(strings(plain).flatMap(tokensOf));
  const fragments = fragmentsOf(k).filter((f) => (now.get(f) ?? 0) > (base.get(f) ?? 0));
  return [...new Set([...keywords, ...fragments.map((f) => `fragment ${f}`)])];
}
