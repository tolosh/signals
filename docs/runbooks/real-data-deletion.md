# Runbook: deleting one person's real data (T3)

SIG-61, ADR 0008 (as amended 9 November 2026). **The procedure, the S3 stores and the revocation
poller that triggers it are built and tested; the secure environment is not deployed**, so this
runbook can't yet be run against real data. Behaviour is specified on Confluence (the hypothesis
page, H0); this page is the operator's checklist and points there.

## When

- The person revokes consent (through their bank, openfeed, or the portal), or asks for deletion.
- A lender closes the applicant, or the person stops a watch.
- The end of Stage A, for everyone.

Revocation must be detected within 15 minutes and the purge completed within 24 hours (H0).

**A revocation at openfeed needs no operator.** The poller (every 5 minutes) queues the person
and runs `deleteConsumer` at once, retrying on every poll; the PurgeOverdue alarm fires if a
purge is still queued 24 hours after detection, and DetectionAtRisk if the grant list can't be
read. The steps below are for a request made to Moroku directly, for the end of Stage A, and for
answering a PurgeOverdue alarm.

## What it covers

Every store the environment holds, one interface (`src/research/realdata/stores.ts`):

| Store              | What it holds                                                                   |
| ------------------ | ------------------------------------------------------------------------------- |
| `raw_grant_data`   | The grant and the CDR data collected under it                                   |
| `derived_features` | Features and engine outputs derived from that data                              |
| `truth_capture`    | The person's truth-capture declarations (T4)                                    |
| `run_inputs`       | Run inputs and caches that hold that person's records                           |
| `openfeed_grants`  | The grant link: grant ID, revision, consent record and the sealed refresh token |

`deleteConsumer` refuses to run unless all five are given. In the secure environment each is
its own S3 bucket, with versioning off, so a deleted record is gone at once.

**Out of scope by law: de-identified research data.** Data de-identified under a
de-identification consent (CDR Rules 1.7, 4.15) can't be linked back to the person, so it can't be
deleted. openfeed's flow captures no de-identification consent (SIG-61 comment 40194), so
Stage A keeps nothing de-identified: everything is in scope.

## Steps

1. Find the person's **opaque consumer reference** (`cr_…`) in the secure environment. Never
   write it into a ticket, a log or chat.
2. Stop every run for that reference. If the request didn't come through openfeed, also tell the
   person to stop sharing on openfeed's dashboard: Signals can't revoke an openfeed grant for them
   (openfeed's revoke call needs the person's own token).
3. Call `reportRevoked` with the reference and the current time, which queues and purges at once
   (the poller retries a failure), or run `deleteConsumer(stores, consumerRef, at)` with `at` the current time as an ISO 8601
   timestamp with a zone. The code never reads the clock itself.
4. Read the receipt:
   - `status: "complete"` and `verified: true`: every store deleted and nothing remains.
   - `status: "failed"`: a store failed to delete or couldn't be read (`remaining: null`). Fix
     the store and run again: the procedure is idempotent, and a second run deletes only what is
     left. The 24-hour clock runs from detection and is not reset by a retry.
5. Keep the receipt as a run record through the T2 guard (`writeRunRecord` under `realdata/`).
   It holds counts per store, the date and the outcome; no personal data and no reference.
6. Record on the ticket: the date, the status and the counts. The precise times are in the
   environment's CloudTrail data events and S3 access logs.
7. S3 versioning is off on every store bucket (ADR 0008, amendment A2), so nothing outlives the
   deletion. If a bucket ever has versioning on, stop: the purge isn't complete until every
   version is gone.

## Verify

`verifyDeleted(stores, consumerRef)` counts what remains in every store; it is verified only
when every count is zero and every store could be read. `deleteConsumer` runs it after
deleting, so the receipt's `verified` is that proof.
