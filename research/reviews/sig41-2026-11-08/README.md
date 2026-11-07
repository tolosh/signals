# SIG-41 independent re-review, 8 November 2026

These are the inputs from the independent re-review of the INC-09 and INC-12 change at
`cfa9d4f`. The full results and their classification are on SIG-41, in the comment of
8 November 2026, 09:02.

The reviewer had no part in the implementation. These files are kept as evidence. Don't
edit them; if something needs correcting, add a new file.

| File                     | What it is                                                                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `random-mismatches.json` | 363 histories where INC 1.2.0 differed from a plain-rule reference. Each entry has `id`, `cause`, `reference` and `engine` states, `engine_reason`, `min_ratio`, `ref_trough_ratios`, `streams` and `history`. |
| `lib.ts.txt`             | The reviewer's feed builder: it turns a `history` (generator parameters) into a transaction feed.                                                                                                              |
| `random.ts.txt`          | The reviewer's random generator and comparison (seed 20261108, 3,000 primary and 5,500 total histories).                                                                                                       |

The `history` field holds generator parameters (`family`, `cad`, `base`, `lastOffset`,
`skips`, `cuts`, `repayment`, `extra`, `asOf`), not raw transactions. The scripts are saved
as `.ts.txt`, so lint and typecheck don't pick them up. Port what you need into the
regression test.

Causes in the file:

| Cause                                | Count |
| ------------------------------------ | ----- |
| `evidence-layer unverified`          | 230   |
| `rounding of ratio to 2 dp`          | 78    |
| `only SIG-16 stream credits counted` | 52    |
| `stream credits only + rounding`     | 3     |

A-405, the "no stream → green" case, is filed under `only SIG-16 stream credits counted`,
with the engine giving green ("Every month is at or above 60% of the annual average"). After
the fix it must come out `unverified`. The reviewer's scripts import the engine from a
sibling clone (`../signals/src/...`), so adjust that path when you port them.

The data is synthetic only. There's no consented data in this folder.
