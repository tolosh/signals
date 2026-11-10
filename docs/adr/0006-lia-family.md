# ADR 0006: Family 3 LIA, hidden and stacked credit

Status: ruled (Colin, 8 November 2026, on SIG-42). L-1 to L-8 stand as recorded, with the two
changes below, the independent review's rulings of the same day (1.2.0, below) and the short
re-review's ruling (1.3.0, below), review 9's rulings (1.3.1, below) and the 10 November
rulings (1.3.2 and 1.3.3, below). Where a ruling changes an interpretation, the ruling wins, and
the interpretation is kept as it was recorded. The engine is at 1.3.3.

## Rulings, 10 November 2026, 13:00 (LIA 1.3.3)

Colin's rulings on #48 (comment 40215).

1. **A declared plain `loan` is green against a typed personal or car loan.** This answers the
   third interpretation under 1.3.2 below. With an exact name, a plain `loan` declaration matches
   a loan the data types as personal or car: a plain declaration doesn't conflict with a typed
   loan. Mortgages and cards still never match a loan declaration.
2. **Money3 shows as "MONEY3".** `LENDER_NAMES` 1.1.0 adds MONEY3, and the list is now matched on
   the bank's description with digits kept, before the provider form strips them. Words of digits
   only (reference numbers) and the detector's product words are skipped, as in the provider form.
   The fallback is unchanged: the provider's first word.
3. **Reserved names** (SIG-60, comment 40216): from the next synthetic set, reserved unseen-lender
   names are invented lenders, checked against the ASIC credit registers. Set v2.2 stays as run,
   and its reserved names stay off the list while it is used (the README records the limit).

**Tests first** (`a75a50e`, 18 failed on assertions): `rulings-1110-1300.test.ts`, the sweep's
oracle and the version pins. A leading-reference case was added after the mutation check below
(`2e40682`): without it, keeping reference numbers survived.

**The 7,500-case sweep (seed 9),** oracle updated to this ruling's text:

| Engine         | Green leaks | Over-flags (matching, not green) | Red |
| -------------- | ----------- | -------------------------------- | --- |
| 1.3.2 (before) | 0           | 43                               | 0   |
| 1.3.3          | **0**       | **0**                            | 0   |

All 43 were typed personal or car loans with the exact name, declared as a plain loan.

**Mutation checks** (LIA, GR-3 and lender-name tests, 303): plain rule removed, 5 fail; plain
loans also match a mortgage, 4; the description ignored (Money3 back to "MONEY"), 3; reference
numbers kept, 1 (with the added case).

**Set v1 at 1.3.3** (records `2026-11-10-synthetic-v1-lia-family-v1.3.3*.json`): every signal's
counts, by tag, at both requests, are identical to 1.3.2's (and so to 1.3.0's). The set v1
generator declares no plain `loan`, so ruling 1 moves nothing there. MONEY3 is one of set v1's
car-loan lenders: its reasons now say "MONEY3" rather than "MONEY", which the records (counts
only) don't show.

**Pre-registrations:** none records an LIA or lender-list version, and this change moves no gate
or income version.

## Rulings, 10 November 2026, 06:39 (LIA 1.3.2)

Colin's rulings on #47's three questions.

1. **A loan the data doesn't type is green when nothing conflicts.** This refines review 9's
   ruling 1. With an exact name, a loan whose account and narratives carry no type word ("HARMONEY
   LOAN REPAYMENT") matches a declared `personal_loan`, `car_loan` or `loan` as green: missing type
   data isn't a conflict. Amber "possibly declared" stays for a real conflict, where the data shows
   one type and the declaration another. Mortgages and cards never match a loan declaration, or
   each other. **Interpretations, for the reviewer:**
   - A loan whose data carries two type words (say CAR and PERSONAL) is a conflict, not missing
     data: it matches only a declared `loan`, as before.
   - The rule is for the exact-name path only. On the amount-only path an untyped loan under
     another name still matches no typed declaration (the re-review's ruling, 8 November).
   - A loan the data types (say a personal loan) against a declared `loan` stays amber, as the
     ruling's text gives only the untyped case. **For Colin:** say if a declared `loan` should
     also accept any typed loan.
2. **Lender names.** `lenders.ts` holds a short, versioned list (`LENDER_NAMES` 1.0.0) of known
   multi-word Australian lender names, matched on whole words before the first-word rule: American
   Express, Bank of Melbourne, Bank of Queensland, Bendigo Bank, Cash Converters, Commonwealth Bank,
   Great Southern Bank, Macquarie Bank, St George, Wallet Wizard. A match returns the list's name,
   which is the start of the bank's description, so the list never extends the echoed text; the
   D29 keyword test still runs over every reason. LIA results record `lender_names_version`.
   **Interim rule (until SIG-57's lender aliases replace it):** a name not on the list is shown by
   its first word. Matching still uses the whole name. Limits:
   - One-word lenders (Nimble, Plenti, Latitude) need no entry.
   - The detector's provider form drops digits, so Money3 shows as "MONEY" (fixed in 1.3.3).
   - **Reserved names.** No reserved unseen-lender name of synthetic sets v1, v2.1 or v2.2 is on
     the list, and none is shown differently because of it (`test/research/lender-names.test.ts`).
     So NOW Finance, from the ruling's examples, is left off and shows as "NOW". Most reserved
     names are real lenders; this is raised on SIG-60.
3. **Versions** (ADR 0007): INC 1.2.2, observed income 1.0.1 and observed expenses 1.1.1 keep their
   versions under gate 1.2.0. Each result and run record carries the gate version, and the set v1
   replay tests pin both versions.

**Tests first:** `rulings-1110.test.ts`, the sweep's oracle and `lender-names.test.ts`. 24 tests
failed on assertions before the change. Two of the 24 were the INC replay pins, which failed only
because the test helper was unfinished; with it finished they pass, since INC's output is unchanged.

**The 7,500-case sweep (seed 9),** with the oracle updated to this ruling's text:

| Engine         | Green leaks | Over-flags (matching, not green) | Red |
| -------------- | ----------- | -------------------------------- | --- |
| 1.3.1 (before) | 0           | 49                               | 0   |
| 1.3.2          | **0**       | **0**                            | 0   |

All 49 over-flags were untyped loans with the exact name, declared as a personal or car loan.

**Mutation checks** (LIA, GR-3 and lender-name tests, 289):

| Mutant                                   | Tests that fail |
| ---------------------------------------- | --------------- |
| Untyped rule removed                     | 5               |
| Untyped loans also match a mortgage      | 3               |
| Any typed loan matches loan declarations | 7               |
| List emptied                             | 11              |
| List matched on part words               | 1               |
| List echoes the rest of the description  | 4               |

**Set v1 at 1.3.2** (records `2026-11-09-synthetic-v1-lia-family-v1.3.2*.json`): every signal's
counts, by tag, at both requests, are identical to 1.3.0's. On the salaried base at a 6-month
request, LIA-01 is 75 green and 0 amber (27 amber at 1.3.1). The ambers that remain, 41 at a 6-month
request, are all "undisclosed", and all are in the four tags built with an undisclosed liability:
undisclosed-card 12, bnpl 8, sacc 11, wage-advance 10.

## Review 9 rulings, 9 November 2026, 20:29 (LIA 1.3.1)

Review 9 (the independent re-check at `0e30841`) found the fuzzy path clean but 257 green leaks in
its 7,500-case sweep, all through the exact-name path: an exact name with the wrong exact type
(140); names differing only by digits or "Pty Ltd" (117); and collisions (ZÖP against Zíp, both
reduced to "Z P"; an empty name against "-"). A `mortgage` declaration could never exact-match.
It also found loan, SACC, wage-advance and disbursement reasons echoing narrative remainders
("MACQUARIE IVF CLINIC REF", "NIMBLE REPAY ONCOLOGY BILL").

1. **Green needs the exact name and the exact type.** The detector's own match (by family, on its
   ASCII-only name) is no longer used: LIA matches every liability found. A right name with
   another type is amber, "Possibly the declared <name> (<amount>): confirm with the applicant",
   with review; without a declared amount the parenthesis is left out. Pairs by name come before
   pairs by amount, then closest amount, one-to-one. A `mortgage` declaration matches a loan the
   data types as a mortgage (a home-loan or mortgage narrative).
2. **Names compare by `exactName`.** NFC, case folding, every digit removed, the legal suffixes
   Pty, Ltd and Limited removed, punctuation collapsed to spaces. Letters stay letters, accents
   included. A name with fewer than 3 letters is never exact. A found liability's name is the one
   its card or loan account and its repayments' narratives (or a card's biller) agree on; if they
   disagree there is no name. **Interpretations, for the reviewer:**
   - The detector's product words (loan, repayment, instalment, payment, credit, card, BPAY) and
     the loan-type words (personal, car, auto, vehicle, motor, mortgage, home) are removed on
     both sides, as the detector already did, so "HARMONEY PERSONAL LOAN" names Harmoney.
   - Punctuation and spacing differences are not "other differences": "SOCIETY-ONE" and
     "SOCIETY ONE" are one name. "SOCIETYONE" and "Society One" are not (fuzzy path).
3. **D29: every liability is named by its lender only.** Reasons, resolve text, LIA-02's and
   LIA-03's lender lists and the `liabilities` list all name the lender. **Candidate (the 9
   November 07:22 ruling's item 2, extended):** the lender is the first word of the narrative, for
   every family, until there is an Australian lender register. A liability known only from an
   account in the grant is named by the account's product. So Cash Converters shows as "CASH",
   and "MACQUARIE LEASING" as "MACQUARIE". Matching still uses the whole name.

**Tests first** (`bc1deba`, 33 failed): `test/families/lia/review9.test.ts` (rulings 1 to 3),
`test/families/lia/sweep.test.ts` and the D29 keyword test in `test/repo/gr3.test.ts`.

**The 7,500-case sweep** (`sweep.test.ts`, seed 9) is my re-implementation, not the reviewer's
harness. It has random types (the eight below), lenders, name variants (digits, Pty Ltd, Limited,
decomposed accents, other lenders, empty, "-", "Bank"), up to two declarations and amounts. Its
oracle is written from the ruling's text, independently of the engine: green exactly when a
declaration has the exact type and the same normalised name of at least 3 letters.

| Engine         | Green leaks | Over-flags (exact, not green) | Red |
| -------------- | ----------- | ----------------------------- | --- |
| 1.3.0 (before) | 158         | 947                           | 0   |
| 1.3.1          | **0**       | **0**                         | 0   |

The sweep's lender pool lost LATITUDE after the first run, because it is a reserved unseen-lender
name (the set v2.1 check); 147 and 962 were the first run's figures with it in.

**Mutation checks** (LIA and GR-3 tests, 228): exact type not required, 7 fail; no 3-letter
minimum, 4; accents dropped, 3; legal suffixes kept, 6; the lender named by the whole narrative, 11.

**Found on the set v1 re-run, fixed with a test first (`be09491`):** a liability's name took in
the product name of the everyday account its repayments leave ("Everyday Account"), so no
liability in a named card or loan account could exact-match. The two records made before the fix
were withdrawn (`79a6bdc`) and regenerated.

**Set v1 at 1.3.1** (sanity records `2026-11-09-synthetic-v1-lia-family-v1.3.1*.json`). Only
LIA-01 changes; every other signal's counts are identical to 1.3.0. On the salaried base at a
6-month request, LIA-01 is 48 green and **27 amber** (was 75 green). Across the tags without an
undisclosed liability, all 40 ambers are "possibly declared": a loan declared as personal or car
whose set v1 narrative ("HARMONEY LOAN REPAYMENT") doesn't name its type. That is ruling 1 as
written (the review counted an untyped loan declared as `car_loan` as a leak), not a false
"undisclosed". **For Colin:** say if an untyped loan with the exact name should instead be green
for a personal or car declaration.

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
