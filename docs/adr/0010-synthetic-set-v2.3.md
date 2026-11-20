# ADR 0010: synthetic set v2.3, its T7 result and its fitness

Status: ruled (Colin, 20 November 2026, SIG-63 comment 40483), on independent review 13 (comment
40477, pinned at `48e3f25`). Set v2.3 is adopted as the working synthetic set for every use, under
the caveats below. Set v2.2 stays as run (ADR 0009).

## Context

SIG-63 builds set v2.3 to remove review 11's channels from set v2.2: biller codes that encode the
answer (D-L4-1), drift lines that don't exist or are a coin flip (T3, L5), formulaic declarations
(D-L4-2, D-L4-3), real lenders among the reserved names, and 14 realism flags. T7 is SIG-60's,
carried unchanged by hash, plus a structure family (code shape, code rank, cross-applicant
code-to-name links, ID arithmetic) that is never intended evidence.

- Pre-registration `research/preregistrations/SIG-63.json` (T8, `3912ae7`, before any generator
  change), with pre-run amendments A1 to A5 (`4fbddf6`).
- Set v2.3: seed 623, generator 2.3.0, 780 applicants, `69dcc096…` (`491a075`). The generator is
  frozen after `4fbddf6`.
- Re-registration `research/preregistrations/SIG-63-r2.json` (`3fdb29b`, `6fe2bbf`) of two v2.2
  channels, after the first v2.2 control failed (comment 40468).

## Decision

1. **T7 on set v2.3 is recorded as FAILED, as run.** The record
   `research/runs/2026-11-19-sig63r2-leakage-v2.3.json` lists 8 labels. Under the ruling of comment
   40470 (a family-level flag fails a label), 10 labels fail. The record is not edited, and CI
   asserts that it reproduces (D28).
2. **Most failures are test-design issues, not generator artefacts** (review 13, L3). T7's
   false-alarm rate breaks for clustered labels: labels drawn at random per biller are flagged in
   10 of 10 runs, and per applicant in 4 to 17 of 20, against a nominal 0.1%. The registered
   false-alarm control draws only per line, so it couldn't see this. T7's scoring is fixed in
   SIG-65 (a new pre-registration, low priority, behind SIG-61).
3. **Set v2.3 is adopted for every use** under the caveats below. It replaces v2.2 as the working
   set.
4. **No v2.4.** No artefact is both cheap to fix and blocking a named experiment.

## T7 as run

| Label               | Review 13 class (A artefact, B realistic signal, C test design) |
| ------------------- | --------------------------------------------------------------- |
| L-unseen-lender     | C (some B)                                                      |
| L-no-card-cue       | C                                                               |
| L-account-in-grant  | C, plus minor A                                                 |
| T-repayment         | B + C + minor A                                                 |
| T-pay               | B                                                               |
| T-card-repayment    | B + C                                                           |
| T-bounced-debit     | C                                                               |
| T-drift-pair-main   | C                                                               |
| T-dishonour-fee     | C (ruled failure: family flag)                                  |
| T-drift-pair-second | C (ruled failure: family flag)                                  |

Validity checks V1 to V11 pass. Compared like for like under the r2 harness (review 13, L2), v2.2
fails 6 labels and v2.3 fails 10, but by cause v2.3 is better: v2.2's code signal survives on codes
never seen in training (AUC 1.0), so it is in the code values; v2.3's falls to about 0.5 on unseen
codes, so it is memorised identity of individual billers.

## Fitness (review 13, F)

**v2.3 is preferred for every use; it ties with v2.2 for SIG-46.** Every use carries these caveats:

- **No cross-applicant code statistics.** Lender codes are shared by far fewer applicants than bill
  codes (code-level AUC 0.985, review 13 L4).
- **Cluster by lender or issuer** for the unseen-lender and no-card-cue groups: the BPAY cue is a
  property of the issuer (amendment A2), and there are few unseen-lender billers.
- **Drift is scored per applicant**, not per line.
- **Salaried pay is identical to the cent.**
- **No sensitive merchants**, so the GR-3 exclusion can't be tested on this set.
- **Dishonour scoring is NOT FIT for prediction from balances**: dishonours and overdrawn fees are
  unrelated to the running balance (recorded unfixed in SIG-63.json).
- **Any SIG-57 re-run on v2.3 is a new pre-registration** that discloses that v2.3 was designed
  after SIG-57's v2.2 result (see the order of work below). Review 13 checked circularity: 5.4% of
  v2.3's declared names appear word for word in SIG-57's table, against 18.7% for v2.2.

Minor artefacts, noted for any future set: too few bill billers (28 for 780 applicants); lenders
always use their legal biller name; dining placement depends on whether the card is shared (AUC
0.69); dishonours unrelated to balance.

## Order of work (review 13, O: MATCH, with notes)

1. **SIG-57's pre-registration (`73c7301`) is on a separate branch**, so that it came before any
   v2.3 generator work rests on commit times, not on one branch's history.
2. **SIG-57 had already run, and been refuted on v2.2, before v2.3 was designed**, by the same
   author. v2.3's declaration generator was therefore built knowing SIG-57's failure modes.
3. **V9 was tuned before the run, and disclosed:** the strict count went 183, 187, 194, 203 as the
   alias generator was enlarged (amendment A5), all before set v2.3 was generated.

**V9 clears narrowly.** It passes at 203 distinct pairs with at most 3 repeats (at least 200 and at
most 4 required). Review 13 found that a slightly stricter count gives 184 pairs and 5 repeats,
which would fail.

## Consequences

- Experiments use set v2.3 with the caveats above, stated in each pre-registration.
- T7's scoring for clustered labels is SIG-65's work; set v2.3's T7 record stays as run.
- A future set needs its own pre-registration; v2.3's generator stays frozen.
- Real data (SIG-61) is where the effort goes next, once Colin confirms N-2, N-3, N-11, N-12 and
  the go-ahead.
