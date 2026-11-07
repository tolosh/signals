# The Signals mock

A mock of `openapi.yaml` for the Lovable front ends (SIG-11), with synthetic fixtures only. The
fixtures follow Build Specification §3.4, which is the source of truth. This page lists the IDs
the mock serves, so a front end can find each state.

Hosted (dev sandbox): <https://e8pgarelt8.execute-api.ap-southeast-2.amazonaws.com>.
Local: `npm run mock` (port 4010).

## State (SIG-51, ADR 0005)

Writes are kept in a DynamoDB table and seen on every reload. The `X-Mock-Scenario` header selects
a separate copy of the state (`default` when absent). `POST /mock-reset` puts the scenario back to
the fixtures below; `POST /mock-reset/requests` resets its evidence requests only. Written items
expire after 7 days.

## Fixture IDs

| ID                                                                                            | What it is                                                                                                          |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `asm_01`, `apl_01`                                                                            | AF-T1 (Build Specification §3.4), roll-up amber                                                                     |
| `asm_01_v2`                                                                                   | Version 2 of `asm_01`: confirmed expenses $3,500                                                                    |
| `asm_unverified`, `apl_02`                                                                    | Salary account not shared: EQ-01 fails. Carries `review`: not required until `req_01` is explained, then required   |
| `asm_evidence`, `apl_assessed`                                                                | Evidence lists of 0, 1 and 50 transactions. Carries `review: { required: false, reasons: [] }` (the counterpart)    |
| `asm_incomplete`                                                                              | `status: data_incomplete`                                                                                           |
| `asm_03`, `apl_03`                                                                            | Assessed, then the grant was revoked                                                                                |
| `asm_income`                                                                                  | The 13 INC signals, computed by the family 1 engine (SIG-41)                                                        |
| `req_01`                                                                                      | `apl_02`'s open `income_not_found` request; portal token `tok_01` acts for `apl_02`                                 |
| `req_open` … `req_closed`                                                                     | One request per status, with `Prefer: example=<status>` on `GET /v1/app/applicants/apl_02/requests`                 |
| `tok_01`                                                                                      | The portal token. Its step moves welcome → progress (connect) → done (finances saved); withdraw is final            |
| `apl_invited`, `apl_connecting`, `apl_syncing`, `apl_connected`, `apl_watching`, `apl_closed` | An applicant at each status                                                                                         |
| `wks_01`, `wks_seed`, `wks_zero`                                                              | The workspace; on the seed benchmark (`Prefer: example=seed_benchmark`); with zero credits (`example=zero_credits`) |
