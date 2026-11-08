# Readiness checklist: team members' own real data (Stage A)

SIG-61, ADR 0008. Colin's ruling (9 November 2026): **team testing starts only when this
checklist is complete.** It records, item by item, what exists in production today and what is
mock-only or not built, with the file evidence, as found in the repository on 9 November 2026.
The obligations come from SIG-61 and the hypothesis page on Confluence; this page doesn't restate
them.

States: **production** (built and deployed against real openfeed), **built, not deployed**
(code and tests in this repository, no environment to run in), **mock only** (the contract and
the Lovable mock, synthetic fixtures), **not built**, **open** (waiting on a decision).

**Today nothing is in production.** There is no production stack: `infra/app.ts` deploys only
`SignalsMockStack` to the dev sandbox account. `src/connectors/openfeed/`, `src/portal/`,
`src/api/`, `src/sync/`, `src/jobs/` and `db/migrations/` hold only `.gitkeep`.

## Open items for Colin

| #   | Item                                                                     | State    |
| --- | ------------------------------------------------------------------------ | -------- |
| O-1 | Consent route: service consent only, or service plus de-identification   | **open** |
| O-2 | Legal sign-off on the consent wording (flow, dashboard, withdrawal text) | **open** |

## Consent

| #   | Item                                                                                                       | State                     | Evidence                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-1 | Consent flow names the sponsor (openfeed), its accreditation number and a link to its CDR policy (4.3(2B)) | **not built**             | `PortalSession` (`openapi.yaml`, line 2186) has `lender_name`, `shared_data`, `purpose`, `step` and no sponsor fields; no "sponsor" or "accreditation" anywhere in `src/`, `openapi.yaml` or `infra/` |
| C-2 | Separate collection, use and disclosure consents, each separately manageable (1.10A)                       | **not built**             | No consent model in `openapi.yaml`; the only consent field is `Watch.consent_recorded_at` (line 2143)                                                                                                 |
| C-3 | De-identification consent and the "can't be deleted afterwards" notice (1.7, 4.15)                         | **open** (O-1), not built | Nothing in the repository; ADR 0008 section 8                                                                                                                                                         |
| C-4 | Connect to openfeed production and store the grant                                                         | **mock only**             | `GET /v1/openfeed/callback` (`openapi.yaml`, line 824); the mock redirects without a grant (`src/mock/fixtures.ts`, line 824) and connect returns `https://openfeed.example/authorize` (line 442)     |
| C-5 | Consent wording signed off by legal                                                                        | **open** (O-2)            | —                                                                                                                                                                                                     |

## Dashboard

| #   | Item                                                                                                                       | State                                                            | Evidence                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | Consumer dashboard listing each consent, naming the sponsor, accreditation number and CDR policy (1.14(3)(ha), 4.11(3)(i)) | **not built**                                                    | No dashboard endpoint in `openapi.yaml`; the portal has a session and a withdraw action only                                                                     |
| D-2 | Withdraw from the dashboard                                                                                                | **mock only**                                                    | `POST /v1/portal/{token}/withdraw` (`openapi.yaml`, line 870); mock sets the step to `withdrawn` (`src/mock/fixtures.ts`, line 828; `test/mock/durable.test.ts`) |
| D-3 | Truth-capture form for team members                                                                                        | **built, not deployed** (schema and validator); UI **not built** | `research/schemas/truth-capture-v1.schema.json`, `src/research/realdata/truth-capture.ts`; the form is a Lovable follow-up                                       |

## Revocation

| #   | Item                                                                                 | State         | Evidence                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1 | Revocation through Moroku: portal withdraw, lender closes the applicant, watch stop  | **mock only** | `withdrawConsent`, `closeApplicant`, `stopPortalWatch` (`openapi.yaml`, lines 870, 307, 913); the mock flips `grant_revoked` (`src/mock/fixtures.ts`, lines 695, 828, 835); no call to openfeed |
| R-2 | Revocation at the bank or openfeed detected within 15 minutes (no webhooks: polling) | **not built** | `src/sync/`, `src/jobs/` empty; `infra/` has no scheduler; ADR 0008 section 7                                                                                                                   |
| R-3 | On revocation, stop sync and runs for that person                                    | **not built** | No sync exists (`src/sync/` empty)                                                                                                                                                              |
| R-4 | `grant_revoked` shown to the lender                                                  | **mock only** | `Applicant.grant_revoked` (`openapi.yaml`, line 1512); fixture `apl_03` (`src/mock/fixtures.ts`, line 112)                                                                                      |

## Purge and deletion

| #   | Item                                                                       | State                   | Evidence                                                                                                                           |
| --- | -------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| P-1 | Deletion procedure over every store, with a receipt and a verify step      | **built, not deployed** | `src/research/realdata/deletion.ts`, `stores.ts`; `test/research/realdata/deletion.test.ts`; `docs/runbooks/real-data-deletion.md` |
| P-2 | S3 implementations of the four stores                                      | **not built**           | Only the in-memory and filesystem stores exist                                                                                     |
| P-3 | Purge job triggered by revocation, completing within 24 hours, with alarms | **not built**           | No job, queue or scheduler in `infra/`                                                                                             |
| P-4 | Retention limit (never past the end of Stage A)                            | **not built**           | ADR 0008 section 6                                                                                                                 |

## Secure environment and controls

| #   | Item                                                                                       | State                                | Evidence                                                                                                         |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| E-1 | Separate account or isolated environment in ap-southeast-2, KMS keys, S3 SSE-KMS, policies | **not built**                        | Design in ADR 0008 sections 1 and 2; `infra/app.ts` deploys the mock only                                        |
| E-2 | CloudTrail data events, S3 access logs, KMS key-usage logs                                 | **not built**                        | ADR 0008 section 3                                                                                               |
| E-3 | Roles per function; break-glass human access, logged                                       | **not built**                        | ADR 0008 section 4                                                                                               |
| E-4 | T2 guard on every real-data run record; repo scan; `realdata/` git-ignored                 | **built, not deployed**              | `src/research/realdata/guard.ts`, `scripts/lib/run-record.ts`, `test/repo/real-data-guard.test.ts`, `.gitignore` |
| E-5 | Small-cell rule for exported rates                                                         | **open** (proposed)                  | ADR 0008 section 5                                                                                               |
| E-6 | Ingestion of real data (openfeed production connector, sync)                               | **not built**, out of SIG-61's scope | `src/connectors/openfeed/` empty                                                                                 |

## Complete when

Every row above is **production** (or, for D-3, has its Lovable form), and O-1 and O-2 are
ruled. Today, of the 22 rows under Consent, Dashboard, Revocation, Purge and Environment: 0 in
production; 3 built and not deployed (D-3, P-1, E-4); 4 mock only (C-4, D-2, R-1, R-4); 3 open
(C-3, C-5, E-5); 12 not built.
