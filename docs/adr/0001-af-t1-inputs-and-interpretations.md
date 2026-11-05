# ADR 0001: AF-T1 inputs and ratio interpretations

Status: I-1 accepted (Colin, 5 November 2026); I-2 to I-7 proposed for review on SIG-15

Product Specification 6.1 and 6.5 define the ratios and publish AF-T1's outputs. The
specification is the source of truth; this record only lists where the engine had to interpret
it, so that each choice can be confirmed or changed by a dated decision. The engine cites these
as I-1 to I-7 in `src/engines/affordability/index.ts`.

## AF-T1 inputs (test/fixtures/af-t1.json)

The specification gives the outputs, not every input. These inputs reproduce every published
figure; other inputs could too, so AF-T1 tests the arithmetic, not how inputs are derived.

| Input               | Value                                                                        | Why                                                  |
| ------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| Salary              | $6,996 fortnightly, shading 100%                                             | $6,996 × 26 ÷ 12 = $15,158 exactly                   |
| Stated gross income | $248,700 a year                                                              | "Gross annual income is about $248,700" (6.1)        |
| Expenses            | confirmed $3,000; benchmark $1,573; observed committed $1,867 + basic $1,500 | GLE is the highest, $3,367 (AF-E3)                   |
| Credit card         | found in the data, $6,000 limit, no stated repayment                         | 3% of the limit = $180 (6.4); the LIA-01 card in 3.4 |
| Car loan            | declared, balance $41,600, stated $260, observed $278                        | Higher of the two = $278; $180 + $278 = $458         |
| Loan                | $960,000 over 30 years, product rate 5.69%, buffer 3.00%, floor 5.50%        | Assessment rate 8.69% gives $7,511.22                |
| Total debt          | $960,000 + $6,000 limit + $41,600 = $1,007,600                               | DTI 4.05 gross, 5.54 net                             |

## Interpretations

- **I-1 Repayments are whole dollars.** Accepted by Colin on 5 November 2026 (ruling on
  SIG-15). No two-decimal assessment rate gives a repayment of
  exactly $7,511. At 8.69% over 30 years it is $7,511.22, which makes total expenses $136,035,
  not the published $136,032. Taking each monthly commitment and the proposed repayment to the
  whole dollar reproduces every published figure. Build Specification 3.1 says amounts are
  rounded to cents; this applies to repayments only, before they are used.
- **I-2 Gross income is the stated figure.** AF-I4 allows grossing up observed net income with a
  resident tax table. That table is not built, so without a stated gross figure the gross LTI
  and DTI are `unverified`. The INC-02 agreement check is not applied yet.
- **I-3 Total debt counts limits.** Cards, charge cards and overdrafts count at their limit, not
  their balance (6.5, "card and overdraft limits"); other debts count at their balance.
- **I-4 States use unrounded values.** A ratio's state is judged before rounding to two places,
  so a value displayed as 0.70 can still be red.
- **I-5 Gross and net take the worse state.** LTI and DTI have one state; it is the worse of the
  gross and net states. In AF-T1 both are amber.
- **I-6 Only the default expense method.** AF-E3 makes the method configurable; only the
  default (highest of confirmed, benchmark and observed committed plus basic) is implemented.
- **I-7 Threshold boundaries.** "Amber 0.50 to 0.70" and "amber 1.00 to 1.25" include both ends;
  "red above" and "amber above" exclude the boundary; "amber from" and "red from" include it.

With no income, the engine returns `unverified` (AF-I6). Every ratio that divides by income is
`unverified` with no value; LVR and Benchmark/GLE do not depend on income and are still computed.
