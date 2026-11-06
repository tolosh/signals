# Run 2026-11-06-synthetic-v1-income-v1-lb6-occ3

Ticket SIG-16 · engine income-v1 1.0.0; lookback 6, min occurrences 3 at commit 047cc40aa1ada4e5e6b5621d3e50faa3cfbe6b67 · created 2026-11-06T20:30:38Z

Data set synthetic-v1 (seed 42, 380 applicants, SHA-256 8f5cf973ec46b33bbeccd97e87dcde10edea22919ed9af9bc9469149b2e17ea9). Versions: definitions 1, thresholds none, taxonomy 1.4.

| Measure | Scored | Mean abs error | Mean abs % error | Mean signed % error | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| Income (±5.00%) | 380 | 162.13 | 2.40% | -1.82% | 93.42% |
| Expenses (±15.00%) | 380 | 3000.44 | 100.00% | -100.00% | 0.00% |

| Detection | Precision | Recall | TP | FP | FN |
| --- | --- | --- | --- | --- | --- |
| Liabilities, all | n/a | 0.00% | 0 | 0 | 374 |
| Liabilities, undisclosed | n/a | 0.00% | 0 | 0 | 69 |
| Flag: gambling | n/a | n/a | 0 | 0 | 0 |
| Flag: dishonours | n/a | n/a | 0 | 0 | 0 |
| Flag: salary_account_unshared | n/a | n/a | 0 | 0 | 0 |
| Flag: transfers_to_unshared | n/a | n/a | 0 | 0 | 0 |
| Flag: rent_on_time | n/a | n/a | 0 | 0 | 0 |
| Flag: cards_cleared_in_full | n/a | n/a | 0 | 0 | 0 |
| Flag: savings_growing | n/a | n/a | 0 | 0 | 0 |

## Misses (779)

- expenses: 380
- liability_missed: 374
- income: 25

Each miss is listed in the JSON record with `cause` left empty for the researcher to tag.
