// SIG-83's negative control (ruling 40766, 2; research/preregistrations/SIG-83.json): every listed
// lender name (LENDER_NAMES 1.2.0) in a debit's narrative and biller name is replaced by its
// ROT13, so no debit names a listed lender. Amounts, dates, categories, IDs and declarations are
// unchanged. Synthetic data only. Pure: no clock, no randomness.
import { LENDER_NAMES } from "../../engines/lender-names.js";

/** ROT13: letters shifted 13 places, case kept; digits and everything else unchanged. */
export const rot13 = (s: string): string =>
  s.replace(/[A-Za-z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const BY_LENGTH = [...LENDER_NAMES].sort((a, b) => b.length - a.length);
/** A listed name as whole words, any case, spaces as any run of spaces. */
const nameRe = (name: string) =>
  new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}])${name.split(" ").map(escape).join("\\s+")}(?![\\p{L}\\p{M}\\p{N}])`,
    "giu",
  );
const PATTERNS = BY_LENGTH.map((n) => ({ name: n, re: nameRe(n) }));

/** The text with every listed lender name, longest first, replaced by its ROT13. */
export function rotateListed(text: string): string {
  let out = text;
  for (const { re } of PATTERNS) out = out.replace(re, (m) => rot13(m));
  return out;
}

/** True when a listed lender name occurs anywhere in the text, as whole words, in any case. */
export const namesListed = (text: string): boolean =>
  PATTERNS.some(({ re }) => {
    re.lastIndex = 0;
    const hit = re.test(text);
    re.lastIndex = 0;
    return hit;
  });

type Tx = { amount: string; description: string; billerName?: string };
type Feed<T extends Tx> = { accounts: { transactions: T[] }[] };

/** The feed with every debit's listed lender names rotated. Credits are left as they are. */
export function rotatedFeed<T extends Tx, F extends Feed<T>>(feed: F): F {
  return {
    ...feed,
    accounts: feed.accounts.map((a) => ({
      ...a,
      transactions: a.transactions.map((t) =>
        Number(t.amount) < 0
          ? {
              ...t,
              description: rotateListed(t.description),
              ...(t.billerName !== undefined ? { billerName: rotateListed(t.billerName) } : {}),
            }
          : t,
      ),
    })),
  };
}

/**
 * The pre-registered check: after rotation no debit names a listed lender, and no rotated name is
 * itself listed. Throws, so the run stops, if either fails.
 */
export function checkRotation<T extends Tx>(feeds: readonly Feed<T>[]): { debits: number } {
  const listed = new Set(LENDER_NAMES);
  for (const n of LENDER_NAMES)
    if (listed.has(rot13(n))) throw new Error("a rotated lender name is itself listed");
  let debits = 0;
  for (const f of feeds)
    for (const a of f.accounts)
      for (const t of a.transactions) {
        if (!(Number(t.amount) < 0)) continue;
        debits++;
        if (namesListed(t.description) || namesListed(t.billerName ?? ""))
          throw new Error("a rotated debit still names a listed lender");
      }
  return { debits };
}
