// SIG-57 (H2): resolves a provider string to a lender through the pre-registered alias table
// (research/aliases/lender-aliases-1.0.0.json; research/preregistrations/SIG-57.json, method).
// The table is an input: this module holds no lender name (T8). Pure; relative imports (D3).

export const SIG57_ALIAS_METHOD_VERSION = "1.0.0";

export type AliasTable = {
  version: string;
  lenders: { id: string; canonical: string; families: string[]; aliases: { text: string }[] }[];
};
export type AliasIndex = {
  version: string;
  /** Alias token sequences, longest first; lender null when the table lists it under two. */
  aliases: { tokens: string[]; lender: string | null }[];
  families: ReadonlyMap<string, readonly string[]>;
};
export type Resolution = { lender: string | null; identity: string };

/** Words the identity drops: SIG-18's product words, then the pre-registered additions. */
const DROP = new Set([
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
  "REF",
  "REFERENCE",
  "LIMITED",
  "AUSTRALIA",
  "AUST",
  "ACN",
]);

export const tokens = (text: string): string[] =>
  text
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w.length > 0);

/** The canonical name counts as an alias. Sharing is computed from the lenders, not listed. */
export function aliasIndex(table: AliasTable): AliasIndex {
  const owners = new Map<string, Set<string>>();
  for (const l of table.lenders)
    for (const text of [l.canonical, ...l.aliases.map((a) => a.text)]) {
      const key = tokens(text).join(" ");
      if (key === "") continue;
      const s = owners.get(key) ?? new Set<string>();
      s.add(l.id);
      owners.set(key, s);
    }
  const aliases = [...owners.entries()]
    .map(([key, ids]) => ({
      tokens: key.split(" "),
      lender: ids.size === 1 ? ([...ids][0] as string) : null,
    }))
    .sort(
      (a, b) =>
        b.tokens.length - a.tokens.length ||
        b.tokens.join(" ").length - a.tokens.join(" ").length ||
        (a.tokens.join(" ") < b.tokens.join(" ") ? -1 : 1),
    );
  return {
    version: table.version,
    aliases,
    families: new Map(table.lenders.map((l) => [l.id, l.families])),
  };
}

const contains = (words: string[], seq: string[]) => {
  for (let i = 0; i + seq.length <= words.length; i++)
    if (seq.every((w, j) => words[i + j] === w)) return true;
  return false;
};

/**
 * The longest alias the text holds on whole words names the lender (none when that alias is
 * shared). Without a lender, the identity is the text without words carrying a digit and without
 * the dropped words.
 */
export function resolve(text: string, index: AliasIndex): Resolution {
  const words = tokens(text);
  const hit = index.aliases.find((a) => contains(words, a.tokens));
  if (hit?.lender) return { lender: hit.lender, identity: hit.lender };
  const identity = words.filter((w) => !/\p{N}/u.test(w) && !DROP.has(w)).join(" ");
  return { lender: null, identity };
}
