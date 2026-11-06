# ADR 0002: Evidence-quality layer interpretations

Status: E-1 to E-8 proposed for review on SIG-39

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

## Consequence worth ruling on

Under E-4, a 3-month history against the default 6-month lookback covers about 50% of the window,
so EQ-03 fails and the assessment is _unverified_ (RU-4). In synthetic set v1 that is 131 of 380
applicants (the 1- and 3-month histories). That follows Amendment 2 as written. If a lender who
asks for only 3 months should not be capped, the lookback input should be what that lender
requested, which the engine already supports.
