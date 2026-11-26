# ADR 0007: GR-3, sensitive spending excluded from every signal input

Status: ruled (Colin, 8 November 2026, on SIG-42). G-1 is ruled as Decision Record **D29**;
G-2 and G-3 are accepted. The interpretations below are kept as they were recorded.

## Rulings, 8 November 2026

- **D29 (G-1).** Sensitive categories never feed any signal, any decisioning or scorecard input,
  or anything shown or explained per category. Health spending still counts towards the
  living-expense total (AF-E1) as an aggregate amount only: never broken out, labelled or used to
  judge. Religious, union and political spending, and payees Enrich marks sensitive, are not
  living expenses and don't enter the totals. As built: observed living expenses 1.1.0 count a
  health line (Enrich's `healthcare`, or a medical or pharmacy MCC) in basic, never as a one-off;
  the other sensitive lines are removed first. `test/repo/gr3.test.ts` checks that no breakdown,
  trace line or reason from any engine names a sensitive category, word or transaction ID.
  Mutation checks: without the removal, 2 tests fail; without the health aggregate, 3 fail.
- **G-2 accepted.** Until Enrich has a sensitive marker, the gate uses `healthcare`, the reserved
  codes and the MCC list. Raised with Enrich as **ENR-31** (a sensitive-payee flag), linked to
  ENR-30.
- **G-3 accepted** as a candidate, versioned with the definitions (`SENSITIVE_METHOD_VERSION`).

## SIG-74, 26 November 2026 (split keywords; gate unchanged at 1.2.0)

Review 16 (SIG-64 comment 40700, E6) found SIG-64's known limit 4 understated. A keyword split by
an invisible character showed fragments of 2 or more letters ("IV", "CARDIO", "HOSP"): as the
lender's name in LIA, and as both halves of a loan or card account's product name ("I VF
LENDING"). A default-ignorable character that isn't Cf (U+034F, U+FE0F, U+2800) also split a word
without being masked, in LIA and in observed income's payer, which the review didn't test. Colin's
ruling of 26 November (comment 40705, and his answers of the same day):

- **One normalisation** (keyword list 1.1.0, the same words): NFKC, then every Unicode
  default-ignorable code point and U+2800 removed, then upper case. `cleanText`, which every
  displayed name is read through, does the same.
- **Read joined.** LIA puts back together the provider words that an invisible character split
  ("IV F" is IVF), and reads a product name with its invisible characters removed, so a split
  keyword is masked whole. A name that is still a piece of a sensitive word shows as "a lender".
  Text without invisible characters is named exactly as before: over sets v1 and v2.2, LIA 1.3.6's,
  INC 1.2.4's and observed income 1.0.3's text is byte-identical to SIG-64's.
- **A fully withheld name stays "a lender"** (the 16 November rule), as do names that are only
  pieces.

**Known limit 4, as SIG-64 recorded it, is superseded** (kept below as written): split keywords
are now masked whole in LIA's names, product names and observed income's payers. **New known
limits:**

6. **A split can change how LIA reads a loan's type.** In "CAR<ZWSP>DIOLOGY XAVOCA PERSONAL LOAN",
   LIA's type rule sees the word CAR, so the loan is typed a car loan and "(car loan)" is shown.
   The type is matching, which SIG-74 leaves unchanged; reading types on joined text is SIG-75
   (Colin, 26 November 2026). SIG-74's T1 fails on this, as run, for CARDIOLOG and CARDIAC only, and
   CI asserts that recorded result (D28).
7. **A lender's name is the narrative's first word that isn't sensitive** (unchanged since 1.3.0),
   so a narrative starting "TO MYPAYNOW" names the lender "TO" (14 applicants in set v2.2). Found
   while building SIG-74, and left unchanged: SIG-74 changes no text that has no invisible
   character.

## SIG-64, 21 November 2026 (display masking; gate unchanged at 1.2.0)

D29 is two things: the gate keeps sensitive lines out of every signal input (above), and no
displayed text shows a sensitive word. Review 12 (SIG-42 comment 40428) found the second leaking.
Colin's rulings of 19 November and 21 November (SIG-64 comment 40524):

- **One shared, versioned keyword list for display** (`src/engines/display-mask.ts`, 1.0.0),
  separate from the gate. The gate stays at 1.2.0, and **G-2 stays the limit for detection**:
  masking changes what a lender reads, never what an engine counts.
- **Matching:** NFKC, then format characters (Unicode Cf) removed, then upper case. Stems are kept
  (the safer side). A run of letters inside a word is checked (IVF4417).
- **Exempt:** `LENDER_NAMES` (1.2.0) and the phrase CREDIT UNION.
- **Every engine's displayed text:** LIA (1.3.5), INC (1.2.3) and observed income (1.0.2) mask
  every reason, review reason, resolve-with text and lender or payer name, and record
  `keyword_list_version`. Observed income groups streams by the unmasked payer
  (`deriveIncomeByPayerKey`) and shows the payer masked, so its figures are unchanged
  (`SIG-16-team-grants.json` amended, 21 November 2026). Observed expenses shows no narrative
  text, so it is unchanged at 1.1.1.

**Known limits of display masking:**

1. **Harmless words are masked.** A stem masks every word it starts (OSTEON, PSYCHE); a short
   union or insurer name masks the same letters elsewhere (ASU, SDA, NIB, AHM); HEALTH masks an
   employer's name ("SALARY NORTHSIDE HEALTH" shows "SALARY NORTHSIDE [withheld]" in set v1).
   Over-masking was ruled the safer side.
2. **Look-alike letters** (a Cyrillic "і" in IVF) aren't folded: NFKC doesn't map them.
3. **A keyword glued to other letters** ("IVFNIMBLE") or split by visible punctuation ("I.V.F")
   isn't a whole word, so it isn't masked.
4. **Superseded by SIG-74 (26 November 2026); kept as written.** **A split keyword in a lender's
   provider form shows a fragment.** The detector's provider form
   keeps A to Z only, so "IVF NIMBLE" written with a zero-width space after the I is the provider
   "I VF NIMBLE", and LIA names the lender "I". No keyword shows.
5. **The list is a list.** A sensitive word not on it shows (a new denomination, a clinic's own
   name).

## Review 10, 16 November 2026 (the scan; gate unchanged at 1.2.0)

Review 10 (SIG-42 comment 40326) found six more ways past the static scan. Colin's ruling (comment
40327): close the two realistic ones, and list the rest as known limits.

- **Closed** (`test/repo/gr3-taint.ts`; `test/repo/gr3.test.ts` has each form):
  - **A variable reassigned to the raw feed.** A variable is gated only if every value it is ever
    given is gated: its initialiser and each later assignment. A destructuring or compound
    assignment to it, or `++`, counts as unknown, so it fails.
  - **A local function named `withoutSensitive`.** The call counts as the gate only when the file
    imports `withoutSensitive` from the gate module (`sensitive.js`; a rename is allowed) and no
    local function, variable or parameter of that name shadows it.
- **Known limits.** Review 10's comment names only the two closed above, so items 1 to 4 are mine,
  each probed against the scan: every one passes the scan when it shouldn't. Review 12 (SIG-42
  comment 40428, E4) found that review 10's other four are different evasions, and that each
  passes the scan; SIG-64 lists them as items 5 to 8 (ruling 40524).
  1. **Mutating a gated value:** `gated.accounts = raw.accounts`, `gated.accounts.push(...)` or
     `Object.assign(gated, ...)`. The scan follows values, not later writes to their properties.
  2. **An array method's arguments:** `gated.accounts.concat(raw.accounts)`, or a callback that
     returns a raw value (`gated.accounts.map((a, i) => raw.accounts[i])`). An array method on a
     gated array counts as gated whatever its arguments or callback return.
  3. **A typed parameter given a cast object:** when every object written with a type's
     annotation is gated, a parameter of that type is gated, even at a call that passes
     `{ feed: raw } as Ctx`.
  4. **Across modules:** each file is scanned on its own, so an exported function whose callers in
     its own file pass gated values counts as gated, even if another module calls it with the raw
     feed.
  5. **A computed property, `a[k]`:** reading the raw feed's accounts or transactions through a
     key held in a variable (`feed[key]`) isn't seen as a read of them.
  6. **`Object.values`:** `Object.values(feed)` reaches the accounts without naming them.
  7. **`Reflect.get`:** `Reflect.get(feed, "accounts")` is a call, not a property read.
  8. **`for…in`:** `for (const k in feed)` walks the feed's keys, and the reads that follow go
     through `feed[k]`.

  The detector and the other modules on the scan's exception list (`UNGATED`) still read only
  what their callers pass, and every engine entry is also checked by behaviour: the GR-3 tests
  feed each one sensitive lines and require identical output without them.

## Versions ruling, 10 November 2026, 06:39

- **Accepted:** INC 1.2.2, observed income 1.0.1 and observed expenses 1.1.1 keep their versions
  under gate 1.2.0. The conditions are met as follows:
  - **The gate version is carried.** Each result carries `gr3_gate_version`, and so do the INC and
    LIA run records.
  - **Replay tests pin both versions.** INC's set v1 replay (`n13-identity.test.ts`) pins INC 1.2.2
    and gate 1.2.0 on every result. A new set v1 replay (`gate-replay.test.ts`) pins observed
    income's and observed expenses' method versions and gate 1.2.0. Their output hashes, taken at
    `0e30841` (gate 1.1.0) without the gate field, are unchanged at gate 1.2.0.
- **Set v1 INC counts are unchanged at gate 1.2.0.** The new records
  `2026-11-09-synthetic-v1-inc-family-v1.2.2{,-request-6}.json` have the same counts by tag, and the
  same salaried flags, as the gate 1.1.0 records of 8 November.
- **The SIG-16 team pre-registration** pinned gate 1.1.0, so main failed after #46 and #47 merged.
  No team grant has been ingested, so it is amended to 1.2.0, with the reason recorded in
  `engine_amendments`.

## Review 9, 9 November 2026 (gate 1.2.0)

- **C2, the scan.** The regex scan is replaced by a taint check over the TypeScript syntax tree
  (`test/repo/gr3-taint.ts`). It follows every read of `transactions` back to a value the gate
  returned, through variables, property and element access (literal or constant keys), array
  methods and their callbacks, for-of, destructuring at any depth, spreads, object-literal
  properties (one level), and local functions' parameters (by their call sites, or by their
  declared type's literals). Anything it can't show gated fails. Review 9's three gaps are
  cases: nested destructuring, computed keys, and a token `withoutSensitive()` call beside an
  ungated read. Also flagged: an object that carries both a gated feed and the raw one. With
  INC's gate call removed, the scan fails.
- **C3.** A credit in a liability category that carries a sensitive MCC (a BNPL refund from a
  dentist) is removed. The exemption covers repayments, which are debits, only. Gate 1.2.0;
  with the change reverted, 1 test fails. INC (1.2.2), observed income (1.0.1) and observed
  expenses (1.1.1) keep their versions: their output changes only on such a credit, and each
  records the gate version it ran (for the reviewer).
- **Ruling 3 (D29).** A new test feeds every engine liability narratives with a sensitive word
  after the lender (review 9's C4 probes among them), uncategorised and with no sensitive MCC,
  and fails on any sensitive keyword anywhere in any output. Income payers stay outside it
  (G-2, unchanged).
- **Correction (C6).** "Only their version and that field changed" below was wrong for observed
  income: one exclusion counter also moves on some inputs. The income figures don't change.

## Short re-review direction, 8 November 2026, 19:40 (gate 1.1.0)

The re-review at `11e2ef4` found the GR-3 test couldn't catch an LIA regression, scan gaps, over-
exclusion, sensitive names in shown text, and unversioned output changes. As built, tests first:

- **An LIA case that fails with the gate off.** A loan from a parish (Enrich's `religious`),
  which LIA-02 reads as a disbursement when unmarked. A non-vacuity test runs every engine on the
  same lines with their marks taken off and expects each output to change.
- **Scan gaps closed.** The static scan also finds `a["transactions"]` (and `?.[...]`) and
  `transactions` destructured in a for-of, a declaration or a parameter; tests pin each form and
  three it mustn't flag.
- **Over-exclusion.** A line Enrich categorises as a loan, card, BNPL, SACC, mortgage or
  wage-advance repayment (`LIABILITY_CATEGORIES`) is never sensitive, whatever its MCC, so a BNPL
  repayment for a dental bill stays in LIA and is a debt repayment in observed expenses, not
  health. Credits are still gated in both directions: GR-3 excludes sensitive lines from every
  input, and a refund from a pharmacy is one (interpretation, for the re-check).
- **D29 text.** No engine's output echoes a raw narrative: a test feeds narratives carrying
  references and a BNPL merchant, and none appears in any output. LIA names a BNPL by its lender
  (ADR 0006). INC and observed income name a payer by the narrative's words with digits,
  references and punctuation removed; an unmarked union paying income is still named (G-2).
- **Versions.** The gate is 1.1.0, and every engine that applies it records `gr3_gate_version`:
  evidence, INC, LIA, observed income and observed expenses. INC is 1.2.2 and observed income
  1.0.1: only their version and that field changed (INC's set v1 and `asm_income` hashes match
  1.2.1 with both set back). Observed expenses is 1.1.1. LIA is 1.3.0.

**Mutation checks at 1.1.0** (`test/repo/gr3.test.ts`, 52 tests): the gate made a no-op, 9 fail;
the liability exemption removed, 8 fail; a BNPL named by its narrative, 1 fails.

**Corrected count:** with the gate made a no-op at #40, **4** of the 10 tests failed, not 5 as
recorded below.

## Context

Product Specification §9.2, GR-3: spending at medical providers, pharmacies, religious
organisations, unions and political parties is excluded from every signal input; Enrich may
categorise it, and the engine must not read it; a test suite enforces the exclusion list. The
SIG-42 independent review (8 November 2026, F3) found that no test enforced it, although CLAUDE.md
said one did. LIA-06 read uncategorised transfer narratives, and transfers to a parish and to a
union made it red. Ruling 2 asks for a repo-wide test covering every signal, ratio and decisioning
input, including payees Enrich marks sensitive, with a mutation check.

## Decision

- **One gate, applied at every engine entry that reads transactions.** `withoutSensitive`
  (`src/engines/sensitive.ts`) removes a line, in either direction, when its Enrich category is
  sensitive or its MCC is on the list. The entries that apply it are the evidence layer
  (`assessEvidence`), INC (`assessInc`), LIA (`assessLia`, so LIA-01's detector receives the
  gated feed), and observed income for affordability (`deriveIncome`). Each takes an optional
  `categories` map. Without it, the MCC list still applies.
- **The test** (`test/repo/gr3.test.ts`):
  - pins the exclusion list;
  - runs each entry with and without sensitive lines of every kind and expects byte-identical
    output. The kinds are Enrich's `healthcare` (with and without an MCC), a payee Enrich marks
    sensitive, and lines found only by MCC (pharmacy, doctor, church, political party, and a
    union, including the review's F3 probe of repeat union transfers with a repayment reference);
  - runs a static scan, so that any module under `src/engines/` that reads transactions must
    apply the gate or be on a short list with a reason.
- **Mutation check:** with the filter made a no-op, 5 of the 10 tests fail (the list check and
  all four engines). _(Corrected by the re-review: 4 of the 10; see above.)_
- **Set v1 has no sensitive lines** (no `healthcare` category, no sensitive MCC). So every set v1
  output is unchanged, and INC's output hashes over set v1 and `asm_income` are byte-identical.

## Interpretations, for ruling

- **G-1: observed living expenses still count `healthcare`.** AF-E1 lists "health" among basic
  expenses, and those feed GLE and so DSR, NDI and ARA. The ruling's "ratio" wording would remove
  it. That would understate living expenses and move SIG-17's result, which a ruling should
  decide, not the build. `deriveObservedExpenses` is left as it is, and the test pins it as the
  one exception: its basic expenses rise with a healthcare debit. If the ruling is to exclude
  it, the change is one line, plus a re-run of SIG-17's records.
- **G-2: Enrich can't yet say "sensitive".** Taxonomy 1.4 has `healthcare` (medical and pharmacy)
  but no religious, union or political category, and no sensitive-payee mark.
  - The codes `medical`, `pharmacy`, `religious`, `union`, `political` and `sensitive` are
    reserved, and the gate honours them now. `sensitive` is how Signals will read Enrich's mark.
  - **Limit:** a line with neither a sensitive category nor an MCC isn't recognised. A bank
    transfer to a parish is the example. That is why LIA-06 is parked.
  - Raised with Enrich as ENR-30, with the private-transfer category.
- **G-3: the MCC list is a candidate.**
  - It covers pharmacies (5122, 5912), medical services and suppliers (4119, 5975, 5976, 8011 to
    8099), political organisations (8651) and religious organisations (8661).
  - There is no union MCC. 8699 (membership organisations, not elsewhere classified) stands in
    for it, and it excludes some non-union clubs too. Over-exclusion was preferred.
