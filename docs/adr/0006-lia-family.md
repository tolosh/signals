# ADR 0006: Family 3 LIA, hidden and stacked credit

Status: ruled (Colin, 8 November 2026, on SIG-42). L-1 to L-8 stand as recorded, with the two
changes below, the independent review's rulings of the same day (1.2.0, below) and the short
re-review's ruling (1.3.0, below). Where a ruling changes an interpretation, the ruling wins, and
the interpretation is kept as it was recorded. The engine is at 1.3.0.

## Short re-review ruling, 8 November 2026, 19:40 (LIA 1.3.0)

The re-review at `11e2ef4` found that the fallback could hide an undisclosed liability as green.
The ruling and the architect's direction, as built (tests first, `test/families/lia/re-review.test.ts`
and `test/repo/gr3.test.ts`):

1. **"Possibly declared" is amber, never green.** The reason is "Possibly the declared <name>
   (<amount> a month): confirm with the applicant", after the lender and type found, and review
   is required. Only an exact name match (after SIG-57, an alias-table match) is green. This
   supersedes 1.2.0's "possibly declared on its own is green".
2. **Strict matching.**
   - **Exact types only.** The detector's "loan" family is typed from the loan account's product
     name or the repayments' narratives: CAR, AUTO, VEHICLE or MOTOR is a car loan; PERSONAL a
     personal loan; MORTGAGE or HOME LOAN a mortgage. A loan the data doesn't type, or types two
     ways, is "loan" and matches only a declaration typed "loan" (interpretation, for the
     re-check).
   - **Duplicates removed first:** two declarations with the same type, normalised name and
     repayment count once.
   - **Closest amount first, one-to-one:** every (liability, declaration) pair within the 15%
     candidate tolerance is ranked by the difference in monthly repayment, and paired greedily.
     The review's WBC/AMEX probe now pairs WBC with the declared Westpac card, and AMEX stays
     undisclosed, in either order.
   - Every review probe is a test, with a 320-case sweep (4 types found × 4 declared × 4 amounts
     × 5 ratios) in which a liability not declared under its name is never green.
3. **Lookback.** LIA reads within the requested lookback: LIA-01's detector gets the window's
   transactions (accounts in the grant still count), and LIA-02, LIA-04, LIA-05 and LIA-06 read
   the window. LIA-03 keeps its 12 months. LIA-05's "rising" is judged only when both 90-day
   windows lie inside the lookback and the history inside it covers the earlier window to EQ-03's
   pass share (90%, so it reaches 171 days back). The reviewer's grocery line 200 days old no
   longer lets a 3-month request judge it.
4. **D29 text.** A BNPL is named by its lender, the first word of the narrative ("HUMM", not
   "HUMM SMILE DENTAL"), in reasons and in `liabilities`; LIA-05 counts lenders. Other lenders'
   narratives name only the lender, with digits and references removed (interpretation, for the
   re-check).
5. **NFC.** Text is normalised to NFC before keyword matching, and a combining mark counts as part
   of its letter, so JOSE + U+0301 + LOAN doesn't match.
6. **Versions.** LIA 1.3.0; each result records `gr3_gate_version` (1.1.0, ADR 0007).

**Mutation checks at 1.3.0** (LIA tests, 124): keyword boundaries removed, 16 fail; the fallback
green again, 17; types merged by family, 2; alphabetical instead of closest, 3; no
de-duplication, 1; the detector reading the whole feed, 1; rising without the coverage check, 2.
**One survives:** without NFC, no test fails, because the boundary class already treats a
combining mark as part of its letter; NFC is kept as the ruling asks.

**Corrected count:** at 1.2.0, removing the boundaries failed 15 of **104** LIA tests, not 15 of
99 as reported on SIG-42.

Set v1 records at 1.3.0:

- `research/runs/2026-11-08-synthetic-v1-lia-family-v1.3.0.json`, at a 6-month request.
- `research/runs/2026-11-08-synthetic-v1-lia-family-v1.3.0-request-3.json`, at a 3-month request.

## Independent review rulings, 8 November 2026 (LIA 1.2.0)

The review at `516a5af` reproduced the work with four discrepancies (SIG-42, 12:39). The rulings,
as built:

1. **LIA-01 matching.**
   - When names differ but the type matches and the detected repayment is within 15% of a
     declared repayment (`declared_amount_tolerance`, a candidate), the liability is "possibly
     declared: review", not undisclosed.
   - One declaration matches one liability, and an exact name match keeps its declaration.
   - Possibly declared on its own is green with review required. The reason names both names.
   - **LIA-01 is amber at most**, and the assessed surplus isn't read, until SIG-57 (aliases) is
     Supported and SIG-58 wires the surplus. That supersedes L-1's red.
   - SIG-18's detector is unchanged at 1.0.0.
2. **GR-3 and LIA-06.**
   - The GR-3 gate and its repo-wide test are in ADR 0007.
   - **LIA-06 is parked.** It returns `unverified`, "Private-loan detection is not yet supported
     on categorised data" (as a missing input, so an evidence cap's reason still wins), until
     Enrich supplies a private-transfer category that excludes sensitive payees (ENR-30).
   - The 1.1.0 rules and their tests stay behind `private_loans: "detect"`, which a lender's
     policy can't set.
3. **Findings show; absence needs history.**
   - This is EQ method 4, through EQ-R4 (ADR 0002, E-12). A LIA signal that found something,
     amber or red, shows below its 6-month minimum when the evidence checks allow. Nothing found
     still needs the minimum.
   - With E-12 the waiver applies to presence signals only, and INC's output is byte-identical.
   - Because LIA-05 can now show on a short history, its "rising" is judged only when the
     history covers both 90-day windows. Without that, a 3-month history read its first days as
     a low prior window (syn-v1-0285 in set v1).
4. **Keywords.**
   - A keyword is whole when no Unicode letter or digit touches it. So an underscore separates
     words (LOAN_REPAY), and an accented letter is a letter (JOSÉLOAN doesn't match).
   - LIA-02 reads the reference.
   - Tests pin LIA-03's 12-month read and L-7: shared transaction and savings accounts only, and
     no BSB-account lines.
5. **Housekeeping.**
   - LIA-05's monthly figure uses LIA-01's method: the detector's cadence-based monthly where
     repayments recur, otherwise the last 90 days divided by 3.
   - The mock fixture's header is corrected.
   - `lia-detect.ts`, `eq-unverified.ts` and `generate-synthetic.ts` use the shared run-record
     helpers.

Set v1 records at 1.2.0:

- `research/runs/2026-11-08-synthetic-v1-lia-family-v1.2.0.json`, at a 6-month request.
- `research/runs/2026-11-08-synthetic-v1-lia-family-v1.2.0-request-3.json`, at a 3-month request.

## Rulings, 8 November 2026

1. **Keywords match whole words only,** case-insensitively: LIA-02's LOAN, DISBURSEMENT and
   DRAWDOWN (L-2), and LIA-06's LOAN, REPAY, REPAYMENT, OWE, OWED and IOU (L-6). "OWEN", "LOANS4U"
   and "BIOU" don't match. The 1.0.0 patterns already matched on word boundaries
   (`\b`, on upper-cased text), so no output changes; `test/families/lia/rulings.test.ts` now pins
   one positive and one near-miss case per keyword, and a mutation check (the boundaries removed)
   fails every near-miss case. A word boundary in these patterns falls between a letter or digit
   and anything else, so "LOAN-REPAY" matches both words and "LOAN4U" matches neither.
2. **The candidate thresholds are workspace defaults a lender can override:** LIA-05's 25% rise
   (`bnpl_rising`, L-5), and LIA-06's $500 monthly mean (`private_large_monthly`) and 25% increase
   (`private_increasing`, L-6). They are listed in `LIA_CANDIDATES` and saved on the lender's
   policy as `liability_signals`, as INC's `income_signals` are. That is a contract change, so the
   contract is **1.8.0** (minor: one optional policy field). A save that leaves it out keeps the
   previous version's values. `liaConfigFromPolicy` maps the policy onto the engine's config.

## Interpretations, as recorded at 1.0.0

Product Specification §7.2 (LIA-01 to LIA-06) and Amendment 2 §4.2 (LIA-R1) define the
signals. Those pages are the source of truth. This record lists where the engine
(`src/engines/families/lia/`, version 1.0.0) had to interpret them. Every threshold is an
illustrative starting point the lender calibrates. "Candidate" marks a number the specifications
don't give.

Every signal goes through the evidence-quality layer. With nothing found it returns
`none_observed`, never "none" (EQ-R2, LIA-R1). When EQ-02 fails, every LIA signal is `unverified`,
because transfers to accounts outside the grant could hide what it looks for.

| ID  | Signal                         | Interpretation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-1 | LIA-01 Undisclosed liabilities | **SIG-18's detector at 1.0.0, unchanged,** with its pre-registered primary configuration: minimum 3 occurrences, 15% amount tolerance. Amber when any liability found is missing from the application. Red when the undisclosed liabilities' monthly repayments move the affordability engine's assessed surplus below zero. The surplus is an input; without it, the signal is at most amber. A card or loan found only from its account in the grant has no repayment amount, so it adds nothing to that sum. **Reliability, so the officer isn't over-trusting it:** confidence is `medium`, and the reason says that detection rests on lender names in the narratives, tested on synthetic, template-written data only (SIG-18 review: a realistic floor of 20 of 69), and that declarations are matched by **exact provider name only**. The `reliability` block has no field for this (as for INC-10, N-11). Review is required whenever an undisclosed liability is found. |
| L-2 | LIA-02 Loan stacking           | A **disbursement** is a credit whose narrative says LOAN, DISBURSEMENT or DRAWDOWN, or names a lender the detector found (a loan or SACC provider). The lender is the narrative without those words. Amber for 1 disbursement in 90 days; red for 2 or more **lenders** in 90 days. Older disbursements in the window are green.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| L-3 | LIA-03 Payday and SACC         | Repayments categorised `sacc_loan`, over **12 months** (or the window, if longer), whatever lookback was requested. Amber for any. Red for any in the last 90 days, or **concurrent**: two or more SACC lenders whose repayment spans, from first to last, overlap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| L-4 | LIA-04 Wage advance            | Enrich categorises repayments, not advances (ER-5: direction separates them). An **advance** is a credit from a provider whose debits are categorised `wage_advance`. Amber for occasional advances, or for repayments with no advance seen. Red for "every pay cycle": 3 or more advances in the last 90 days with a median gap of 35 days or less.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| L-5 | LIA-05 BNPL                    | Distinct providers among debits categorised `bnpl`, in the window. Amber for 2 providers; red for 3 or more, or **rising** outflow: the last 90 days more than 25% above the 90 days before (candidate), when the earlier period had any. One provider is green.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| L-6 | LIA-06 Private loans           | A transfer out (type `TRANSFER…`), not categorised, whose narrative or reference carries LOAN, REPAY, REPAYMENT, OWE, OWED or IOU, made at least twice to the same payee. Amber when present. Red when **large** (a monthly mean of $500 or more over the last 90 days, candidate) or **increasing** (the latest more than 25% above the first, candidate).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| L-7 | Shared accounts only           | Every LIA signal reads only shared transaction and savings accounts, and ignores narratives carrying a BSB and account number (own-account transfers, as for EQ-02). Card and loan accounts count only for LIA-01, through the detector.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| L-8 | Roll-up classes                | As in the registry (§7.5): LIA-01 is `knockout`, LIA-02 and LIA-03 are `refer`, and LIA-04 to LIA-06 are `standard`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Known limits:**

- LIA-01 carries SIG-18's limits: template dependence, exact-name declaration matching, and
  BNPL, SACC and wage-advance recall that rests on Enrich recognising the lender (ENR-28).
  SIG-57 tests a lender-alias table on set v2.
- LIA-02, LIA-04 and LIA-06 read credit and transfer narratives, which set v1 doesn't label. They
  are tested on scripted feeds only.
- BPAY biller codes (ER-3) are used through the biller name, as in SIG-18. Set v1's biller codes
  aren't mapped to lenders.
