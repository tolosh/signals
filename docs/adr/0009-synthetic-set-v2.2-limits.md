# ADR 0009: synthetic set v2.2 and its four leakage limits

Status: ruled (Colin, 9 November 2026, SIG-60 comment 40197). Independent review 11 (comment
40328, 16 November 2026) and Colin's rulings on it (comment 40386, 16 November 2026) are recorded
below: set v2.2 may be used for experiments, under the caveats in the fitness table.

## Context

SIG-60 builds set v2.2 with label-blind generation and tests it with T7, a generic adversarial
leakage test whose features, classifiers, margins and intended evidence per label were frozen in
`research/preregistrations/SIG-60.json` before any generator change (T8). Sets v2 and v2.1, the
negative controls, are caught on every channel their reviews found (10 of 10, 17 of 17).

On set v2.2, T7 finds 23 of 27 labels within margin and all six validity checks passing. **Four
labels exceed the margin:** T-pay, T-card-repayment, T-repayment and T-drift-line-main
(`research/runs/2026-11-09-sig60-leakage-v2.2.json`).

## Decision

1. **T7's verdict stands as run: fails on 4 of 27 labels.** The pre-registration is not amended.
   Moving features into a label's intended evidence after seeing the result would be a post-hoc
   rescue.
2. **CI asserts that the recorded result reproduces (D28), not that it passes.**
   `test/research/v22/leakage-v22.test.ts` pins the recorded verdict: any change, in either
   direction, fails and needs a new record and a new ruling.
3. **The four are recorded as limits of set v2.2**, with the stratified evidence below. That
   evidence is a post-hoc diagnostic (`src/research/leakage/limits.ts`, record
   `research/runs/2026-11-09-sig60-leakage-v2.2-limits.json`, checked to reproduce by
   `test/research/v22/limits.test.ts`). It describes the limits; it changes nothing T7 decides.

## The four limits

Univariate AUCs in the diagnostic are taken over every unit, in either direction, not over T7's
held-out folds; T7's own AUCs are given alongside.

| Label             | T7 held-out AUC (tree / logistic) | Carrier                                                         | Stratified evidence                                                                                                                                                                                                                      |
| ----------------- | --------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-pay             | 0.709 / 0.737                     | `line_amount_reuse` (how many applicants share an exact amount) | AUC **0.53** within 20 equal-count magnitude bands (`line_amount_log`), against **0.69** overall. Amount reuse stands in for magnitude, which is intended evidence.                                                                      |
| T-card-repayment  | 0.610 / 0.615                     | `line_amount_reuse`                                             | **0.55** within the bands, against **0.64** overall. The same mechanism.                                                                                                                                                                 |
| T-repayment       | 0.585 / 0.636                     | **Diffuse**: no single family flags                             | T7's best stump is `app_n_shared_accounts >= 5`, lift **1.13** over the base rate (the stump margin is 1.5). A liability's own account in the grant adds to the count. Amount reuse is not the carrier: 0.52 overall, 0.56 within bands. |
| T-drift-line-main | 0.697 / 0.815                     | `line_recurrence`                                               | AUC **0.84**: a renamed descriptor recurs less often, which is the second descriptor itself. The 144 positive lines sit in **23 applicants**, so the per-line p-values treat clustered lines as independent and are too optimistic.      |

**Correction.** SIG-60 comment 40191 and the ruling give 24 applicants for T-drift-line-main.
The diagnostic counts 23. 24 is the number of applicants labelled A-drift-over-time in the T7
record, which I carried over by mistake.

**Also disclosed (within margin):** T-drift-line-second's attribution-only families flag timing
and flows. That is the same clustered-line effect.

## Consequences

- **Fitness is per experiment, decided by the independent review.** The architect's expectation
  (comment 40197):
  - **Fit:** H2 / SIG-57 (undisclosed liabilities, aliases, unseen lenders and declarations, all
    within margin), dishonour scoring, and EQ-03 against the request.
  - **Fit with a stated caveat:** any experiment that must first identify pay lines (the SIG-16
    re-run, SIG-46) or drift lines.
  - **SIG-46's tax arithmetic** is unaffected (the X-3 caveat as before).
- A future set that removes these limits needs its own pre-registration; this one stays frozen.
  That set is v2.3 (SIG-63).

## Review 11 and the rulings of 16 November 2026

Independent review 11 (comment 40328, pinned at `5114112`) reproduced T7 exactly, negative controls
first, and found none of the v2 or v2.1 channels. It recorded three discrepancies:

- **T3:** 3 drift-tagged applicants have no drift line, because the generator's label pool doesn't
  exclude applicants with an unshared salary account or a history too short for the split.
- **L4, D-L4-1:** BPAY biller codes encode the answer. Lender codes have 4 digits and bill codes 5
  or 6; the leading digit gives the type; codes step by 91 within a type; reserved unseen lenders
  take the top codes; and a no-cue card's code carries "CREDIT CARD" on other applicants' lines.
  T7 couldn't see this, because the biller code is intended evidence for those labels and is
  excluded from their classifiers. It affects 26% of repayment lines, 22 of 105 visible
  unseen-lender liabilities and 42 of 127 no-cue cards. Statement feeds carry no codes.
- **L5:** T-drift-line-main is arbitrary by construction: which side of a rename counts as
  "drifted" is a coin flip in the generator (`driftBefore`).

It also recorded D-L4-2 (descriptor words only on "same" names, within margin), D-L4-3 (268
natural declarations use only 83 alias pairs, repeated up to 12 times) and 14 realism flags.

**Rulings (comment 40386):**

1. **Biller codes: use v2.2 now, fix the codes in v2.3.** Experiments may start on v2.2. Each one
   pre-registers that no rule or feature uses biller-code length, prefix, digit arithmetic or code
   rank, or learns code-to-name links across applicants, with a static check where practical.
   Unseen-lender and no-card-cue results are reported with BPAY code features off, and again with
   BPAY lines excluded. Set v2.3 is SIG-63. v2.2 stays as run, and its T7 result is unchanged.
2. **Drift: per applicant only; the 3 unobservable applicants are excluded.** On v2.2 drift is
   never scored per line, and T-drift-line-main is not a target. The pre-registered exclusion list
   is `research/datasets/synthetic-v2.2.drift-exclusions.json` (`syn-v22-7620cc69c71d8ce9`,
   `syn-v22-ceb6a90aecba2b61`, `syn-v22-e5410aea343dffbb`), reported in every run. The full IDs are
   derived from the regenerated truths and match the review's prefixes, which
   `test/research/v22/drift-exclusions.test.ts` checks. Observable counts are 23 over time and 22
   across banks; both minimums of 20 hold.
3. **The fitness table below is accepted as the record.** Every experiment on v2.2 copies its row's
   caveats into its own pre-registration, and its results carry them. SIG-57's references to set
   v2 now read set v2.2 (comment 40387, before any run).

## Fitness per experiment (review 11, accepted 16 November 2026)

| Use                                          | Fitness         | Caveat                                                                                                                                                   |
| -------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIA detection; SIG-18 re-run                 | Fit with caveat | No rule keys on biller-code length, prefix or arithmetic; audit before the run. Report the unseen-lender stratum separately.                             |
| SIG-57 (alias matching, H2)                  | Fit with caveat | Pre-register the alias table without reading `catalog.ts` or this set. Report name-only matching.                                                        |
| SIG-16 re-run (income, drift, irregular pay) | Fit with caveat | Score drift per applicant, not per line. Exclude and report the 3 unobservable applicants. Pay stability is an upper bound.                              |
| SIG-17 re-run (expenses)                     | Fit with caveat | Don't separate bills from repayments by code length. No sensitive merchants are present, so GR-3 isn't exercised. Categorisation results are optimistic. |
| SIG-46 (gross from net)                      | Fit with caveat | Under X-3 the gross-up is an exact inversion, so error will be near zero.                                                                                |
| Dishonour scoring                            | Fit with caveat | Fit for detection, counting and recency. **Not fit** for anything that predicts dishonours from balances or flows.                                       |
| H2: natural declarations                     | Fit with caveat | The alias pairs repeat (D-L4-3). Compare within the pool of applicants with 2 or more declared liabilities.                                              |
| H2: unseen lenders                           | Fit with caveat | Disable BPAY code features, or exclude BPAY lines.                                                                                                       |
| H2: reference noise                          | Fit             | None.                                                                                                                                                    |
| H2: no card cue                              | Fit with caveat | Disable code-prefix rules and learning code-to-name links across applicants.                                                                             |
| H2: repaid from unshared                     | Fit with caveat | Declared amounts equal the truth to the cent, which makes it easier; report name-based results.                                                          |
| H2: account in or out of grant               | Fit             | None.                                                                                                                                                    |

The architect's expectation of 9 November (above) is superseded by this table. In particular,
H2 / SIG-57 and dishonour scoring are fit only with the caveats it states.

## Superseded for use, 20 November 2026

Set v2.3 replaces v2.2 as the working synthetic set (ruling, SIG-63 comment 40483; ADR 0010). Set
v2.2 stays as run, and this record is unchanged above.
