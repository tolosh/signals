// SIG-17 miss analysis: tags every applicant outside the 15% tolerance in a scored run with a
// cause, as the ticket's method requires. Causes are tested in a fixed order, and the first that
// explains the error's sign is recorded:
//   bill_paid_as_transfer: committed bills paid by BPAY that the categoriser called "transfer"
//     (excluded as own-account) when the error is an understatement
//   one_off: a committed or basic debit above the threshold was excluded (understatement)
//   lumpy_cadence: the applicant has annual or quarterly items whose timing in the window moves
//     the average away from its expected value
//   other
// Usage: npx tsx scripts/sig17-miss-analysis.ts --run <run record path> [--lookback 6] [--one-off 5000]
import { readFileSync, writeFileSync } from "node:fs";
import {
  deriveObservedExpenses,
  type ExpenseFeed,
} from "../src/engines/affordability/observed-expenses.js";
import { AS_OF_DATE, generateApplicant, population } from "../src/research/generator/index.js";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const runPath = arg("run", "");
const lookback = Number(arg("lookback", "6"));
const oneOff = Number(arg("one-off", "5000"));
const run = JSON.parse(readFileSync(runPath, "utf8")) as {
  run_id: string;
  misses: {
    applicant_id: string;
    measure: string;
    truth: number;
    derived: number;
    error: number;
  }[];
};
const cache = JSON.parse(readFileSync("research/enrich/synthetic-v1-categories.json", "utf8")) as {
  categories: Record<string, string>;
};
const byId = new Map(population(42).map((s) => [s.id, s]));

const rows = run.misses
  .filter((m) => m.measure === "expenses")
  .map((m) => {
    const spec = byId.get(m.applicant_id);
    if (!spec) throw new Error(`unknown ${m.applicant_id}`);
    const a = generateApplicant(spec, 42);
    const feed = a.feed as unknown as ExpenseFeed;
    const derived = deriveObservedExpenses({
      feed,
      categories: cache.categories,
      as_of: AS_OF_DATE,
      lookback_months: lookback,
      one_off_threshold_aud: oneOff,
    });
    const billsAsTransfer = feed.accounts
      .flatMap((acc) => acc.transactions)
      .filter(
        (t) =>
          Number(t.amount) < 0 &&
          cache.categories[t.transactionId] === "transfer" &&
          /^BPAY /.test(t.description) &&
          !/CREDIT CARD/.test(t.description),
      )
      .reduce((s, t) => s - Number(t.amount), 0);
    const lumpy = a.truth.expenses.items.some(
      (i) => (i.cadence === "annual" || i.cadence === "quarterly") && i.group !== "discretionary",
    );
    const under = m.error < 0;
    const cause =
      under && billsAsTransfer > 0
        ? "bill_paid_as_transfer"
        : under && derived.one_offs.length > 0
          ? "one_off"
          : lumpy
            ? "lumpy_cadence"
            : "other";
    return {
      applicant_id: m.applicant_id,
      tags: a.truth.tags,
      error: Math.round(m.error * 1000) / 1000,
      cause,
      bills_paid_as_transfer_in_window: Math.round(billsAsTransfer),
      one_offs: derived.one_offs.length,
    };
  });
const counts: Record<string, number> = {};
for (const r of rows) counts[r.cause] = (counts[r.cause] ?? 0) + 1;
const out = { run_id: run.run_id, misses: rows.length, by_cause: counts, rows };
writeFileSync(runPath.replace(/\.json$/, "-misses.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ misses: rows.length, by_cause: counts }));
