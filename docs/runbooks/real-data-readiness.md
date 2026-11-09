# Readiness checklist: team members' own real data (Stage A)

SIG-61, ADR 0008 (as amended 9 November 2026). Colin's ruling (10:50 on 9 November 2026):
**team testing starts when every item is built.** Each row says what exists in the repository
today, with the file evidence, as found on 9 November 2026. The obligations come from SIG-61 and
the hypothesis page on Confluence; this page doesn't restate them.

States: **production** (built and deployed against openfeed production); **built, not deployed**
(code and tests in this repository, nothing running); **mock only** (the contract and the Lovable
mock, synthetic fixtures); **not built**; **open** (waiting on a decision or another party).

**Today nothing is in production.** `infra/app.ts` deploys only the mock. The secure environment's
stack (`infra/realdata-stack.ts`) is written and tested and has never been deployed.

## Colin's list (10:50)

| #   | Item                                       | State                                   | Evidence                                                                                                                                                                                                       |
| --- | ------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Consent via openfeed                       | **built, not deployed**                 | openfeed's flow captures the consent and runs the dashboard and revocation (10:50). Signals' side: `src/connectors/openfeed/client.ts`, `src/research/realdata/connect.ts`, `consent.ts`; SIG-61 comment 40194 |
| 2   | Secure store (KMS, Sydney, access logs)    | **built, not deployed**                 | `src/research/realdata/s3-store.ts`; `infra/realdata-stack.ts` (data and truth keys, two signing keys, one bucket per store, CloudTrail, access logs); `test/infra/realdata-stack.test.ts`                     |
| 3   | T2: nothing real reaches repo, CI, records | **built**                               | `src/research/realdata/guard.ts`, `log.ts`, `scripts/lib/run-record.ts`; `test/repo/real-data-guard.test.ts`, `test/repo/realdata-logging.test.ts` (in CI today)                                               |
| 4   | T3: deletion from every store              | **built, not deployed**                 | `src/research/realdata/deletion.ts` over five stores, S3 included; `deletion.test.ts`, `secure-store.test.ts`; `docs/runbooks/real-data-deletion.md`                                                           |
| 5   | Revocation handling (15 min, 24 h)         | **built, not deployed**                 | `src/research/realdata/revocation.ts` (5-minute poll, fail-closed, retries); PurgeOverdue and DetectionAtRisk alarms in `infra/realdata-stack.ts`; `revocation.test.ts`                                        |
| 6   | Truth capture                              | **built, not deployed**; form not built | Schema 2.0.0 and validator: `research/schemas/truth-capture-v2.schema.json`, `src/research/realdata/truth-capture.ts`. The form is a Lovable follow-up                                                         |
| 7   | Ingestion from openfeed production         | **built, not deployed**                 | `src/research/realdata/ingest.ts`, `connect.ts`, `infra/realdata-lambda.ts`; `ingest.test.ts`, `connect.test.ts` (against a fake openfeed)                                                                     |
| 8   | SIG-16 pre-registered before any scoring   | **built**                               | `research/preregistrations/SIG-16-team-grants.json`; `test/research/realdata/sig16-team-prereg.test.ts`                                                                                                        |

## Still needed before the first team member connects

| #   | Item                                                                                       | State         | Who                                     |
| --- | ------------------------------------------------------------------------------------------ | ------------- | --------------------------------------- |
| N-1 | Which consent model applies: onward disclosure (openfeed's published terms) or sponsored   | **open**      | Colin, with Biza (SIG-61 comment 40194) |
| N-2 | The disclosure purpose registered with openfeed names the comparison with declared figures | **open**      | Colin                                   |
| N-3 | openfeed production app registration: client ID, the client key's public JWK, redirect URI | **open**      | Colin                                   |
| N-4 | The account to deploy into (ADR 0008 section 1: a separate account preferred)              | **open**      | Colin                                   |
| N-5 | Deploy the secure environment (`infra/realdata-stack.ts`)                                  | **not built** | Claude Code, on Colin's go-ahead        |
| N-6 | The truth-capture form (posts to the truth store)                                          | **not built** | Lovable                                 |
| N-7 | Issue each team member a private invite token                                              | **not built** | Colin; a short script, on go-ahead      |
| N-8 | Purge on the retention date (30 days after connection, a candidate)                        | **not built** | Claude Code                             |
| N-9 | Small-cell suppression in the guard (the SIG-16 pre-registration applies its own rule)     | **not built** | Claude Code, if Colin wants it in code  |

## Out of scope for Stage A

The first version of this checklist had rows for the sponsor disclosures, Moroku's own consumer
dashboard and separately managed collection, use and disclosure consents. They assumed Moroku runs
the CDR consent. Under the 10:50 ruling openfeed does, so Signals builds none of them. If Biza
confirms a sponsored arrangement instead (N-1), they come back.

## Complete when

Every row in Colin's list is built and deployed, and N-1 to N-8 are done. Today: rows 3 and 8
built and in CI; rows 1, 2, 4, 5 and 7 built, not deployed; row 6 built except its form.
