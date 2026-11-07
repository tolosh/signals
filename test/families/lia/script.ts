// Scripted applicants for the SIG-42 tests: CDR-shaped feeds with a steady salary (so EQ-01
// passes), plus the debits, credits and accounts each LIA case needs, and their Enrich categories.
import { dayOf, isoOf } from "../../../src/engines/evidence/dates.js";
import {
  assessLia,
  type LiaApplication,
  type LiaConfig,
  type LiaFeed,
  type LiaResult,
} from "../../../src/engines/families/lia/index.js";

export const AS_OF = "2026-10-31";
const END = dayOf(AS_OF);

export type Line = {
  /** Days before AS_OF. */
  ago: number;
  description: string;
  /** Negative for a debit, positive for a credit. */
  amount: number;
  category?: string;
  billerName?: string;
  type?: string;
  account?: string;
};
export type Script = {
  months?: number;
  lines?: Line[];
  /** Extra accounts in the grant, such as a card or a loan. */
  accounts?: { accountId: string; productCategory: string; productName: string }[];
};

/** `n` lines `every` days apart, the most recent `first` days before AS_OF. */
export const repeat = (n: number, every: number, line: Omit<Line, "ago">, first = 5): Line[] =>
  Array.from({ length: n }, (_, i) => ({ ...line, ago: first + i * every }));

export function build(s: Script): { feed: LiaFeed; categories: Record<string, string> } {
  const months = s.months ?? 12;
  const start = END - Math.round(months * 30.4375);
  const categories: Record<string, string> = {};
  const tx: LiaFeed["accounts"][number]["transactions"] = [];
  let n = 0;
  const add = (l: Line) => {
    const id = `t${String(++n).padStart(5, "0")}`;
    if (l.category) categories[id] = l.category;
    tx.push({
      accountId: l.account ?? "acc-pay",
      transactionId: id,
      type: l.type ?? (l.amount > 0 ? "TRANSFER_INCOMING" : "PAYMENT"),
      description: l.description,
      postingDateTime: `${isoOf(END - l.ago)}T02:00:00Z`,
      amount: l.amount.toFixed(2),
      ...(l.billerName ? { billerName: l.billerName } : {}),
    });
  };
  add({ ago: END - start, description: "WOOLWORTHS SYDNEY", amount: -85.4, category: "groceries" });
  for (let d = 2; d < END - start; d += 14)
    add({ ago: d, description: "SALARY ACME CONSULTING PTY LTD", amount: 3000 });
  for (let d = 3; d < END - start; d += 7)
    add({ ago: d, description: "COLES 4729 PARRAMATTA", amount: -140, category: "groceries" });
  for (const l of s.lines ?? []) if (l.ago < END - start) add(l);
  const byAccount = (id: string) =>
    tx
      .filter((t) => t.accountId === id)
      .sort((a, b) => ((a.postingDateTime ?? "") < (b.postingDateTime ?? "") ? -1 : 1));
  return {
    feed: {
      accounts: [
        {
          account: { accountId: "acc-pay", productCategory: "TRANS_AND_SAVINGS_ACCOUNTS" },
          detail: { data: { bsb: "062000", accountNumber: "11112222" } },
          transactions: byAccount("acc-pay"),
        },
        ...(s.accounts ?? []).map((a) => ({ account: a, transactions: byAccount(a.accountId) })),
      ],
    },
    categories,
  };
}

export function run(
  s: Script,
  application: LiaApplication = { declared_liabilities: [] },
  config: Partial<LiaConfig> = {},
  lookback_months = 6,
): LiaResult {
  const { feed, categories } = build(s);
  return assessLia({
    feed,
    feed_type: "cdr",
    as_of: AS_OF,
    lookback_months,
    categories,
    application,
    config,
  });
}

export function signal(r: LiaResult, id: string) {
  const s = r.signals.find((x) => x.id === id);
  if (!s) throw new Error(`No ${id} in the LIA output`);
  return s;
}
export const stateOf = (r: LiaResult, id: string) => signal(r, id).state;
export const LIA_IDS = ["LIA-01", "LIA-02", "LIA-03", "LIA-04", "LIA-05", "LIA-06"] as const;
