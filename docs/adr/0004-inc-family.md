# ADR 0004: Family 1 INC, income integrity and continuity

Status: ruled (Colin, 7 November 2026, on SIG-41). The rulings are below; where one changes an
interpretation, the ruling wins, and the interpretation is kept as it was recorded.

## Rulings, 7 November 2026

1. **INC-09 and INC-12 (changes N-10).** A missed pay counts once, in INC-12. A trough month that
   pays INC-12 has flagged as missed fully explain isn't a trough in INC-09. The engine adds each
   flagged pay back, at its stream's median, before judging the month. One missed fortnightly pay
   gives INC-12 amber and INC-09 green.
2. **`household_earners` (changes N-9).** It is on the applicant's `FinancialPosition` in contract
   1.7.0. When it's absent, INC-07 is `unverified`, with `resolve_with` "Confirm how many people
   in the household earn an income". It isn't green.
3. **Loan sizes (N-7, N-9).** $20,000 "wage-sized" (INC-03) and $500,000 "large loan" (INC-07) are
   workspace defaults, marked as candidates (`INC_CANDIDATES`). Each lender can change them in its
   policy (`income_signals`, contract 1.7.0). INC-04's red stays unset until a lender sets its
   policy loan size (N-5, as built).
4. **N-13.** It stays in the INC family for now. After SIG-39 closes, it moves into the
   evidence-quality layer as part of EQ-R4, in a separate PR, and INC's output must be
   byte-identical before and after.

N-1 to N-6, N-8, N-10 to N-12 and N-14 stand as recorded. The caveat on N-2: gig payers are
recognised only from the synthetic fixtures' list until Enrich keeps its own, so any INC-10 result
on real data carries that limit.

Product Specification Amendment 2 §4.1 (INC-06 to INC-13, INC-R1 to INC-R3) and Product
Specification §7.2 (INC-01 to INC-05) define the signals. Those pages are the source of truth;
this records where the engine (`src/engines/families/inc/`) had to interpret them. Every
threshold is an illustrative starting point the lender calibrates. "Candidate" marks a number the
specifications don't give.

## Inputs

- **N-1 Streams.** The family reads SIG-16's streams (`deriveIncome`, method 1.0.0, minimum 3
  occurrences, as pre-registered) over up to 12 months, the longest history any INC signal needs.
  It does not re-derive income. Each signal still judges its own window.
- **N-2 Stream type (AF-I2).** The type comes from the payer name:
  - gig and platform, from the workspace list;
  - government benefit (Services Australia, Centrelink);
  - commission, overtime or bonus, and rental, from words in the narrative;
  - otherwise salary.

  Until Enrich curates gig payers, the gig list is the synthetic fixtures' three payers.

- **N-3 Evidence.** A stream's credits are the credits in its accounts whose normalised narrative
  is its payer, excluding own-account transfers. They are cited as each signal's evidence.
- **N-13 Missing inputs.** When an input a signal needs is absent, the family returns
  `unverified` with `resolve_with`. Examples are INC-06 without an occupation or a pay band, and
  INC-02 without a stated salary or a gross-up. This is applied after the evidence-quality layer,
  in the family, because the layer (SIG-39) is under independent review at `2a3d9d3` and isn't
  changed here. Proposal: fold it into the layer as part of EQ-R4 ("the accounts or feed it
  needs").

## Signals

| ID   | Interpretation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N-4  | **INC-01:** the variation is the largest cycle-to-cycle change on the largest stream over the last 6 months. Red when the last pay is more than 1.5 cycles before the as-of date. **INC-11:** on each salary-like stream, the last 4 pays must not rise; the fall is 1 minus the latest pay divided by the pay 3 cycles earlier. A one-off dip followed by a recovery is not a fall.                                                                                                                                                                                                                                                                                                            |
| N-5  | **INC-04:** the current employer is the salary-like stream paid most recently. Tenure runs from its first credit. When that credit falls within one cycle of the start of the history, tenure is reported as "at least" and is green. Red needs the workspace's policy loan size, which is unset by default, so INC-04 is never red until a lender sets one.                                                                                                                                                                                                                                                                                                                                    |
| N-6  | **INC-05:** "income-like" means a credit whose narrative carries a pay word (salary, wage, payroll, pay) and that comes from the applicant's own account. Own is a BSB and number in the narrative, or a same-day debit of the same amount in another shared account. The window is the requested lookback. Material is 5% or more of observed income, as for EQ-02 (D23). Material is red; anything less is amber.                                                                                                                                                                                                                                                                             |
| N-7  | **INC-03:** variable means overtime or bonus, commission, gig and rental. Shares use observed (unshaded) amounts; the shading appears in the income table. Red when benefits are the only income and the loan is at least the workspace's "wage-sized" amount (candidate: **$20,000**).                                                                                                                                                                                                                                                                                                                                                                                                         |
| N-8  | **INC-06:** the band is the workspace's net monthly pay range per occupation, with none by default. Outside the band is amber. Red when an occupation is stated and there is no salary-like payer. With no occupation, or no band for it, the signal is `unverified` (N-13).                                                                                                                                                                                                                                                                                                                                                                                                                    |
| N-9  | **INC-07:** a single payer means one stream. A single income needs a new application field, `household_earners` (1), because the specifications name no field for it. A large loan is candidate **$500,000**. Without `household_earners` the signal stays green and says so.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| N-10 | **INC-09:** income in each of the 12 months ending on the as-of date. A trough month is below 60% of the average month. Red when a trough month's income is below the proposed monthly repayment. The "no buffer" part (savings) isn't assessed here; it needs LIQ or RES. **Finding:** a single missed fortnightly pay also makes a trough month, so INC-09 overlaps INC-12. Telling seasonality apart from interruption ("same month a year earlier") needs 24 months of history.                                                                                                                                                                                                             |
| N-11 | **INC-10:** declining means the last 3 months' gig income is more than 10% below the 3 months before. The fixture-list limit can't be recorded in the `reliability` block, which has no field for it, so the signal's confidence is `medium` and its reason states the limit.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| N-12 | **INC-02:** the gap is relative to the stated gross salary, comparing salary-like streams grossed up. The gross-up is SIG-46's, passed in as a function. SIG-46 is on hold until set v2 (SIG-54), so production passes none and INC-02 is `unverified` ("needs gross-up", D24). The thresholds are tested with a stand-in gross-up of net × 1.3. No stated salary also gives `unverified`.                                                                                                                                                                                                                                                                                                      |
| N-14 | **INC-12:** a gap over 1.5 cycles counts round(gap ÷ cycle) − 1 missed pays, and a pay more than half a cycle overdue counts as missed. Gig streams are excluded, because they have no regular cadence. The window is the last 6 months. Red when 2 or more pays are missed, or one is missed in the last 60 days. **INC-13:** a change is either (a) a salary-like stream whose cadence band in the last 90 days differs from before, with 3 or more credits each side, or (b) a salary-like payer first paid in the last 90 days, with at least 30 days of history before it. Red when monthly-equivalent pay after the change is more than 10% below pay before it (the INC-11 amber level). |

## Shading (INC-R1)

The income table uses the contract's `AffordabilityTrace.income` row shape and the AF-I3 defaults.

| Type                                        | Shading                                    |
| ------------------------------------------- | ------------------------------------------ |
| Salary                                      | 1.0                                        |
| Overtime and bonus, commission, rental, gig | 0.8                                        |
| Government benefits                         | 0 (excluded until the lender enables them) |

Every value is workspace configuration. Advances (`wage_advance` and BNPL inflows) never count as
income (INC-R2). The trace lists each exclusion count.
