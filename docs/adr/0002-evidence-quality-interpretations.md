# ADR 0002: Evidence-quality layer interpretations

Status: ruled by Colin on 7 November 2026 (Decision Record D22 and D23; comment on SIG-39).
E-1 accepted: the contract's names stand, and Amendment 2 is corrected to match. E-2 accepted
as ruled: EQ-02 fails at 3 or more months and 5% or more of observed income ($250 a month floor);
the proposed "or every month covered when fewer" is dropped. E-3 to E-8 stand. E-4 is refined
by D22 (below).

Product Specification Amendment 2 §2 and §3 (D12, D13, D20) define the evidence-quality layer.
Amendment 2 is the source of truth; this record only lists where the engine had to interpret
it, so that each choice can be confirmed or changed by a dated decision. The code cites these as
E-1 to E-8 in `src/engines/evidence/` and `src/engines/signals/definitions.ts`.

| ID  | Where                     | Amendment 2 says                                          | The engine does                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-1 | Contract names (EQ-R1)    | `resolve[]`, `review`, feed type `statement`              | Keeps the names published in contract 1.1.0 and Build Spec 3.4: `resolve_with`, `review_required` with `review_reason`, and `uploaded_statement`. The checks are `evidence_checks[]`, each with `result`.                                                                                                                                 |
| E-2 | EQ-02 "regular, material" | Not quantified                                            | Regular: in at least 3 calendar months, or every month covered when fewer. Material: a monthly mean of at least 5% of observed recurring income, or $250 when none is observed. Any other unmatched account is `partial`.                                                                                                                 |
| E-3 | EQ-02 matching            | "Matched by BSB and account number where available"       | A narrative carrying a BSB and number is an own-account transfer; it is matched when the number is a shared account's. A transfer without a number is internal when a same-day, same-amount debit and credit sit in two shared accounts; an unpaired one is not counted. `unshared_own_account_transfers` counts accounts, not transfers. |
| E-4 | EQ-03 and EQ-R4 windows   | "Sync returned 90% or more of the lookback window"        | The lookback is the window requested (an input; 6 months by default). Coverage runs from the first transaction returned to `as_of`. A signal's minimum history is met at 90% of its months, the same tolerance as EQ-03.                                                                                                                  |
| E-5 | Minimum history           | Stated for INC-06 to INC-13, POS, and 12 months for trend | INC-01 to INC-05, LIA-01 to LIA-06 and CMT take the default lookback, 6 months; CMT-02 and CMT-06 (annual items) take 12.                                                                                                                                                                                                                 |
| E-6 | EQ-01 rule                | "A recurring salary or benefit credit"                    | At least 3 credits from the same payer narrative, a median gap of 35 days or less and a mean of $100 or more, in a transaction or savings account; own-account transfers, advances, loans, refunds and interest never count (AF-I5, INC-R2). SIG-16 derives income itself; EQ-01 only asks whether an income account is present.          |
| E-7 | EQ-R5 detection           | "An adverse category that is not recognised"              | Each family evaluator reports how many debits it could not classify that could be adverse. The layer caps signals that detect adverse categories (LIA, CMT-02) on statement feeds when that count is above zero.                                                                                                                          |
| E-8 | Absence and POS (EQ-R2)   | Absence is never proof; POS is evidenced or not observed  | A signal that depends on absence and found nothing returns `none_observed`. A POS evaluator returning a colour, or a non-POS evaluator returning a POS state, is refused.                                                                                                                                                                 |

## Consequence (ruled: D22)

Under E-4, a 3-month history against the default 6-month lookback covers about 50% of the window,
so EQ-03 fails and the assessment is _unverified_ (RU-4). In synthetic set v1 that is 131 of 380
applicants (the 3-month histories; corrected 7 November 2026, after the independent review: set
v1 has no 1-month histories). That follows Amendment 2 as written. If a lender who
asks for only 3 months should not be capped, the lookback input should be what that lender
requested, which the engine already supports.

**Reporting (ruling, 7 November 2026, on the independent review):** set v1's result is 138
unverified (36.3%) at the D22 default 6-month request. The 7 / 138 / 254 figures, for assumed
requests of 3, 6 and 12 months, are a sensitivity range only, never a result, because set v1 records
no lender request. 2 of 3 months stays `partial`. Run records:
`research/runs/2026-11-07-synthetic-v1-eq-unverified-request-6.json` and
`research/runs/2026-11-07-synthetic-v1-eq-unverified-sensitivity.json`.

**Ruled 7 November 2026 (D22):** EQ-03 is judged against the lookback the lender requested. The
default request is 6 months, and a lender may request less, but never under 3; the engine refuses
a smaller request. A shortfall against the requested window still fails, and signals keep their
own minimum history (EQ-R4).

## SIG-55: gaps in the middle of the window (EQ methods 2 and 3), ruled

**Ruled 8 November 2026 (Colin, on SIG-55).** E-9 and E-10 below are kept as they were recorded;
where the ruling changes one, the ruling wins.

- **E-9: per feed, as built.** A day is covered when any shared account has a transaction.
- **E-10: the relative rule stands, plus an absolute ceiling.** A silence over 21 days that is
  more than 1.5 times each adjacent silence is a gap, as built; and **any single silence over 60
  days is always a gap**, whatever its neighbours. That closes the known limit below (two long
  holes separated by one day of activity). All three numbers (21, 1.5, 60) are candidates.
- **EQ method 3** (`EQ_METHOD_VERSION`, EQ-R6) adds the ceiling, because it changes results for
  affected inputs; method 2 still replays. Set v1's evidence contexts are identical under methods
  2 and 3 at 6- and 12-month requests, and INC's output is byte-identical over set v1 and
  `asm_income` (`test/engines/evidence/gap-ceiling.test.ts`, `test/families/inc/n13-identity.test.ts`).
- A consequence to know: a feed whose only activity is evenly spaced more than 60 days apart
  (an account used every other month, say) now has a gap at each silence, where method 2 found
  none because each silence matched its neighbours. A monthly account that skips one month was
  already a gap under method 2.

### As recorded (method 2), for ruling

The SIG-39 review found that coverage under E-4 runs from the first transaction to `as_of`, so a
hole in the middle of the window passes. EQ method 2 (`EQ_METHOD_VERSION`, EQ-R6) subtracts the
days inside a gap. Method 1 is kept, so an assessment made under it replays unchanged
(`eq_version: 1`). EQ-03's thresholds are unchanged: 90% passes, 60% to 90% is partial.

| ID   | Question                | The engine does (proposed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-9  | Per account or per feed | **Per feed.** The question EQ-03 asks is whether the data holder returned the period, so a day is active when any shared account has a transaction. A quiet account while another is active is not a gap. The cost: a hole in one account's history is missed while another account is busy.                                                                                                                                                                                                   |
| E-10 | What counts as a gap    | A silence between active days (or from the last one to `as_of`) is a gap when it is **longer than 21 days and more than 1.5 times each adjacent silence**. Both numbers are candidates. Judging a silence against its neighbours means a change of cadence (fortnightly to monthly pay) is not read as missing data, and an account active once a month is not penalised, while a 31-day hole in a busy feed is. The `detail` names each gap by date, and `resolve_with` asks for that period. |

**Known limit of E-10:** two long holes in a row, separated by a single day of activity, are each
about as long as their neighbour, so neither is flagged. A rule judged against the feed's median
silence avoids that, but it read a legitimate change from fortnightly to monthly pay in a pay-only
feed as a 49% window (seen on the INC-13 amber script), so it was not used.

**Set v1 is unchanged:** every EQ-03 result at the 6-month request is the same under methods 1
and 2, and 138 of 380 are still unverified. Set v1 has no mid-window gaps.

## SIG-41 ruling 4: missing inputs in the layer (EQ-R4), for ruling

N-13 (ADR 0004) moved from the INC family into the layer. An evaluator that lacks an input it
needs (an occupation, a pay band, a stated salary, the gross-up, the household's earners, a
regular income stream) sets `missing_input` on its output, and the layer makes the signal
`unverified` with that reason and `resolve_with`, under EQ-R4 ("the accounts or feed it needs").

| ID   | Question                                                                                                      | The engine does (proposed)                                                                                                                                                                                                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-11 | A missing input and an evidence cap together (**accepted for now**, Colin, 8 November 2026; follow-up SIG-59) | **The evidence cap wins and the missing input adds nothing**: no reason and no `resolve_with`. This is what INC did before the move, so INC's output is byte-identical (the ruling's condition). The cost: an officer asked to share 12 months of history isn't also told the occupation is missing until the history is shared. Merging both is a later change that would alter INC's output. |

The move doesn't change `EQ_METHOD_VERSION`: no existing input changes its result. INC's output is
byte-identical over set v1 at both SIG-41 lookbacks and over the mock's `asm_income`
(`test/families/inc/n13-identity.test.ts`, hashes taken at `d2e59a0`).

## SIG-42 review ruling 3: findings show, absence needs history (EQ method 4), for ruling

The ruling (Colin, 8 November 2026): a found liability (amber or red) shows on any history the
evidence checks allow, and only `none_observed` needs the signal's full minimum history (EQ-R2:
absence is never proof; presence is). It applies to every family through EQ-R4. EQ-01, EQ-02 and
EQ-03 caps still apply. **EQ method 4** applies it; the checks are unchanged from method 3, and
methods 1 to 3 replay.

| ID   | Question                                                  | The engine does (proposed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-12 | Which signals' findings show below their minimum history? | **Signals that look for something's presence** (`depends_on_absence` in the registry: LIA-01 to LIA-06 and INC-05), when amber or red. Green, `evidenced` and nothing found still need the minimum. **Not** signals judged over months, whose amber can come from the missing months themselves. Applied to every amber or red, the rule changed INC over set v1: INC-09 (seasonality, 12 months) became amber on 72 salaried 6-month histories, and on 63 salaried 3-month histories at a 3-month request, reading the months with no data as trough months ("6 months fell below 60% of the annual average"). That is absence read as a finding. Gig and variable-income 3-month histories also gained INC-01, INC-03 and INC-10 amber (10, 10 and 10 gig; 3 variable INC-01), which look genuine. With E-12, **INC's output is byte-identical** over set v1 at both lookbacks and over `asm_income`. If the wider reading is wanted for INC-01, INC-03 and INC-10, it needs a per-signal flag, not the whole family. |
