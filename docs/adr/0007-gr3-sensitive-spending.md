# ADR 0007: GR-3, sensitive spending excluded from every signal input

Status: proposed (SIG-42 review ruling 2, 8 November 2026). G-1 to G-3 await a ruling.

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
  all four engines).
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
