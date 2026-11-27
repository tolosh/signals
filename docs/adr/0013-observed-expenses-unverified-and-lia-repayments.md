# ADR 0013: observed expenses 1.2.0, unrecognised essential spend and LIA's repayments (SIG-81, narrow)

Status: built on Colin's ruling of 27 November 2026 (SIG-81 comment 40741), which follows
independent review 18's E13 (SIG-70 comment 40739). For review with SIG-81. The rest of SIG-81's
scope (gambling and crypto inflows never income, full grouping by classification) follows after
1 December.

## Context

Signals groups expenses by Enrich category only (SIG-17's mapping). Enrich 1.8.0, the pinned build,
puts the BPAY bill payments it no longer calls transfers into specific categories where it can. Where
it can't, it puts them in `other_expenses` (classed essential, confidence 0.3, unverified), and
Enrich's consumer rule is to never treat that as discretionary. Observed expenses 1.1.1 mapped
`other_expenses` to discretionary, outside living expenses. So rent paid to agents, childcare,
telco, council rates and lender repayments under legal names all fell out of living expenses, and
observed living expenses came out well below truth.

## Decision

Observed expenses 1.2.0 (`src/engines/affordability/observed-expenses.ts`):

1. **`other_expenses` counts inside living expenses**, as its own line, `unverified_monthly`. A
   credit officer sees how much of the total is unrecognised spend. Living expenses are committed,
   basic and unverified.
   - Above the one-off threshold, an `other_expenses` debit is a one-off, listed and not averaged,
     as committed and basic debits are (AF-E2). This is an interpretation: the ruling puts
     `other_expenses` inside living expenses, and AF-E2 applies to living expenses.
2. **No double counting.** The caller passes the transaction IDs LIA counts as repayments
   (`liability_repayments`: its liabilities' evidence). Each such debit is excluded as a debt
   repayment, whatever its category, so it is never also a living expense.
   - `lia_repayments_in_other_categories` counts those Enrich put outside the debt categories.
   - The input is optional, and omitting it means none. The assessment composition (SIG-82,
     `assessApplicant`) runs LIA before observed expenses and passes them.
3. **Versioned and replayed.** The version moves from 1.1.1 to 1.2.0.
   `scripts/sig81-replay.ts` replays sets v1, v2.2 and v2.3 on the pinned build, before and after,
   as run (`research/runs/sig81-observed-expenses-<version>.json`). Tests whose baselines were taken
   at 1.1.1 read 1.2.0's result in 1.1.1's shape (`test/engines/sig81/as-v111.ts`), and every one
   reproduces: with no LIA repayments given, only `other_expenses` moves.

**Pre-registrations that record observed expenses:**

- **SIG-17** pre-registers 1.1.1's mapping, `other_expenses` discretionary. Its result stands as
  run, and 1.2.0 is a new method, not a re-run.
- **SIG-76** records the expense method `observed`. Its expected states are recomputed on 1.2.0
  (SIG-76 40745).

No other pre-registration records the version.

## Known limits

1. **Unrecognised discretionary spend is now counted as essential.** A gym, for example, is
   `other_expenses` (Snap Fitness on set v2.3's scenario C). This overstates living expenses, the
   conservative direction for affordability (ruling 40741, 3).
2. **Rule 2 removes only what LIA finds.** Before SIG-83, LIA finds lender repayments by debt
   category, or by a BPAY biller naming a credit card. So a regular repayment to a lender in
   `other_expenses` (set v2.3's scenario B, a personal loan by direct debit) stays in the unverified
   line until SIG-83 fixes LIA's detection.
3. **A rent that ends at settlement (AF-E5) comes off committed only.** Rent paid to an agent in
   `other_expenses` is in the unverified line, so it isn't removed.
