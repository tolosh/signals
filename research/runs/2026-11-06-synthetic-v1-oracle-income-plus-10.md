# Run 2026-11-06-synthetic-v1-oracle-income-plus-10

Ticket SIG-13 · engine oracle-income-plus-10 calibration at commit 17e50f2597c157181ab19d63bc77f3599b8bcc75 · created 2026-11-06T19:46:51Z

Data set synthetic-v1 (seed 42, 380 applicants, SHA-256 8f5cf973ec46b33bbeccd97e87dcde10edea22919ed9af9bc9469149b2e17ea9). Versions: definitions none, thresholds none, taxonomy 1.4.

| Measure | Scored | Mean abs error | Mean abs % error | Mean signed % error | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| Income (±5.00%) | 380 | 704.52 | 10.00% | 10.00% | 0.00% |
| Expenses (±15.00%) | 380 | 0.00 | 0.00% | 0.00% | 100.00% |

| Detection | Precision | Recall | TP | FP | FN |
| --- | --- | --- | --- | --- | --- |
| Liabilities, all | 100.00% | 100.00% | 374 | 0 | 0 |
| Liabilities, undisclosed | 100.00% | 100.00% | 69 | 0 | 0 |
| Flag: gambling | 100.00% | 100.00% | 20 | 0 | 0 |
| Flag: dishonours | n/a | n/a | 0 | 0 | 0 |
| Flag: salary_account_unshared | 100.00% | 100.00% | 7 | 0 | 0 |
| Flag: transfers_to_unshared | 100.00% | 100.00% | 13 | 0 | 0 |
| Flag: rent_on_time | 100.00% | 100.00% | 185 | 0 | 0 |
| Flag: cards_cleared_in_full | 100.00% | 100.00% | 110 | 0 | 0 |
| Flag: savings_growing | 100.00% | 100.00% | 148 | 0 | 0 |

## Misses (380)

- income: 380

Each miss is listed in the JSON record with `cause` left empty for the researcher to tag.
