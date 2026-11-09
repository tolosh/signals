# ADR 0009: synthetic set v2.2 and its four leakage limits

Status: ruled (Colin, 9 November 2026, SIG-60 comment 40197). Fitness for each experiment is
decided by the set v2.2 independent review, which follows the merge of PR #44.

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
- **Nothing uses set v2.2 before that review is posted.**
- A future set that removes these limits needs its own pre-registration; this one stays frozen.
