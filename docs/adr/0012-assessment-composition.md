# ADR 0012: composing one assessment from the engines (SIG-82, part 1)

Status: approved as built, I1 to I7, with the five known limits below kept and disclosed (SIG-82
ruling 40765, 27 November 2026). Built on Colin's answers of 27 November 2026: build the composition as SIG-82's first part,
with the requests SIG-76 pre-registers (the proposed defaults, with the expense method `observed`).
For review with SIG-82. Decision Record D3, D13, D22, D42, D58 and D59; SIG-70; SIG-76 ruling 40732.

## Context

Each engine is built and tested on its own: the evidence layer (SIG-39), INC (SIG-41), LIA
(SIG-42), observed expenses (SIG-17), affordability (AF-T1) and the roll-up class rule. Until now
nothing ran them together on one applicant. The mock serves fixtures, and runs the real engines for
a few of them. The hosted demo stage (SIG-82) needs the composition, and SIG-76's expected states
must be computed by that same code (ruling 40732), not by a separate script.

## Decision

`src/assessment/assess.ts`, composition 1.0.0: `assessApplicant(input)`.

1. **Enrich.** Every transaction goes through the SIG-70 adapter (`categoriseForAssessment`) on the
   local path, with the pinned build (`pinnedLocalEnrich`: 1.8.0, moroku-enrich `8cdb0d9`). The API
   is never called: there is no client, the path is forced local for the demo (D58), and synthetic
   data is refused on it (D42): the request marks a feed `real_consented` only for real, consented
   data, and the adapter sends nothing else to the API (SIG-70 O4). The record is kept with the assessment, and the engines read the
   categories stored in it (`categoriesFrom`).
   - Credits are categorised too, not only debits, because the GR-3 gate and LIA read categories on
     credits. The research fixtures hold debits only.
2. **The engines**, each on the same feed and categories, with the request's as-of date and
   lookback:
   - the evidence layer (`assessEvidence`), with its EQ checks and its roll-up contribution
     (`evidenceRollup`);
   - INC, whose application gets the stated gross (a value of 0 or less counts as none), the
     occupation if given, the loan amount, and the proposed repayment at the assessment rate
     (product rate plus buffer, or the floor), in whole dollars;
   - LIA, with the declared liabilities;
   - observed expenses, with one-offs above $5,000.
3. **The affordability engine's input** (`affordabilityInputOf`):
   - **Income:** INC's income rows, each as a monthly stream of its observed amount and its type.
     The affordability engine shades them with the policy's shading. Stated gross is the
     application's.
   - **Expenses:** observed committed and basic from observed expenses; the request's confirmed
     figure and benchmark, when it gives them (SIG-76's requests give neither, and use the
     `observed` method).
   - **Liabilities:**
     - every **declared** liability, at its stated repayment, typed from the declaration
       (`loan` is a personal loan; an unknown type is `declared_only`);
     - every liability **LIA found that matches no declaration exactly** (`declared: false`), at
       LIA's observed monthly repayment, typed from LIA's family (`loan` is a personal loan).

     BNPL, SACC and wage-advance commitments use the 3-month average outflow (Product
     Specification 6.4), so that is set to the same repayment. A liability LIA found and matched
     exactly is counted once, through its declaration.

   - **Benchmark:** the request's, or, when there is none, a labelled "none" (version 0), since the
     `observed` method reads none.
4. **The roll-up** is the evidence layer's state (RU-4: unverified when EQ-01 or EQ-03 fails) and
   the signals that move it (RU-1: amber or red in a knockout, refer or standard class). The full
   roll-up (RU-4 to RU-7, one overall state) is phase 2 (D13), and is not invented here.
5. **What is returned:**
   - the composition version and the Enrich record;
   - the evidence checks and roll-up;
   - INC's, LIA's, observed expenses' and affordability's results, in full;
   - the roll-up.

   The same input gives byte-identical output.

## Known limits

1. **A liability LIA pairs only fuzzily ("possibly declared") is counted twice:** once as the
   declaration and once as found. That is the conservative side for serviceability. Matching
   declared to found liabilities is SIG-57's question, and it was refuted on set v2.2.
2. **Cards found only from narratives carry no limit,** so their commitment is their stated
   repayment, which is 0 when undeclared (Product Specification 6.4: the higher of the stated
   repayment and the factor times the limit).
3. **LIA's typed loan (car, personal, mortgage) isn't in its output,** so a found loan is a personal
   loan. A declared one keeps its declared type.
4. **The gross ratios use the stated gross,** because the gross-up (SIG-46) isn't applied in live
   use (D24).
5. **There is no single roll-up state** until RU-4 to RU-7 are built (D13).
