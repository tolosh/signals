# Run 2026-11-07-synthetic-v1-covered-expenses-v1-rotated-categories-lb6-oneoff5000

Ticket SIG-17 · engine expenses-v1-rotated-categories 1.0.0; lookback 6, one-off threshold $5000; negative control at commit 27de9394fb19ef02befe097fc9497281eed42c13 · created 2026-11-07T00:59:16Z

Data set synthetic-v1 (seed 42, 360 applicants, SHA-256 8f5cf973ec46b33bbeccd97e87dcde10edea22919ed9af9bc9469149b2e17ea9). Versions: definitions 1, thresholds none, taxonomy 1.4 (Enrich local engine 1.7.0).

| Measure | Scored | Mean abs error | Mean abs % error | Mean signed % error | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| Income (±5.00%) | 360 | 7012.97 | 100.00% | -100.00% | 0.00% |
| Expenses (±15.00%) | 360 | 992.45 | 35.53% | -32.28% | 15.28% |

| Detection | Precision | Recall | TP | FP | FN |
| --- | --- | --- | --- | --- | --- |
| Liabilities, all | n/a | 0.00% | 0 | 0 | 355 |
| Liabilities, undisclosed | n/a | 0.00% | 0 | 0 | 69 |
| Flag: gambling | n/a | n/a | 0 | 0 | 0 |
| Flag: dishonours | n/a | n/a | 0 | 0 | 0 |
| Flag: salary_account_unshared | n/a | n/a | 0 | 0 | 0 |
| Flag: transfers_to_unshared | n/a | n/a | 0 | 0 | 0 |
| Flag: rent_on_time | n/a | n/a | 0 | 0 | 0 |
| Flag: cards_cleared_in_full | n/a | n/a | 0 | 0 | 0 |
| Flag: savings_growing | n/a | n/a | 0 | 0 | 0 |

## Misses (1020)

- income: 360
- expenses: 305
- liability_missed: 355

Each miss is listed in the JSON record with `cause` left empty for the researcher to tag.
