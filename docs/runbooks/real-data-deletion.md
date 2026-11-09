# Runbook: deleting one person's real data (T3)

SIG-61, ADR 0008. **The procedure's code exists and is tested against in-memory and
local-filesystem stores. The secure environment and its S3 stores are not built**, so this
runbook can't yet be run against real data. Behaviour is specified on Confluence (the hypothesis
page, H0); this page is the operator's checklist and points there.

## When

- The person revokes consent (through their bank, openfeed, or the portal), or asks for deletion.
- A lender closes the applicant, or the person stops a watch.
- The end of Stage A, for everyone.

Revocation must be detected within 15 minutes and the purge completed within 24 hours (H0).

## What it covers

Every store the environment holds, one interface (`src/research/realdata/stores.ts`):

| Store              | What it holds                                         |
| ------------------ | ----------------------------------------------------- |
| `raw_grant_data`   | The grant and the CDR data collected under it         |
| `derived_features` | Features and engine outputs derived from that data    |
| `truth_capture`    | The person's truth-capture declarations (T4)          |
| `run_inputs`       | Run inputs and caches that hold that person's records |

`deleteConsumer` refuses to run unless all four are given.

**Out of scope by law: de-identified research data.** Data de-identified under a
de-identification consent (CDR Rules 1.7, 4.15) can't be linked back to the person, so it can't be
deleted; the person was told this when they consented. Whether Stage A uses that consent at all
is pending Colin's consent-route decision.

## Steps

1. Find the person's **opaque consumer reference** (`cr_…`) in the secure environment. Never
   write it into a ticket, a log or chat.
2. Stop every sync and run for that reference, and mark the grant revoked.
3. Run `deleteConsumer(stores, consumerRef, at)` with `at` the current time as an ISO 8601
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
7. S3 versioning: the noncurrent-version expiry must fall inside the 24 hours, or the procedure
   must also delete noncurrent versions (design point for the S3 store implementation).

## Verify

`verifyDeleted(stores, consumerRef)` counts what remains in every store; it is verified only
when every count is zero and every store could be read. `deleteConsumer` runs it after
deleting, so the receipt's `verified` is that proof.
