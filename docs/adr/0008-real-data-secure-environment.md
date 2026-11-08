# ADR 0008: the secure processing environment for real CDR data (Stage A)

Status: proposed (SIG-61, 9 November 2026). **Design only.** No AWS resource described here
exists. What is built is listed under "What is built in this repository". Two items are open
for Colin: the consent route, and legal sign-off on the consent wording.

Source of truth: the hypothesis page ("Moroku Signals — Hypothesis, Experiment and Evaluation",
Confluence ENG space, H0 and Stage A), the Decision Record, and SIG-61 with Colin's rulings of
9 November 2026. This note records the engineering design that follows from them; where it and
Confluence disagree, Confluence wins.

## Context

In Stage A, team members connect their own real accounts through openfeed (Biza) **production**.
That is real CDR data, so every CDR obligation applies.

- Moroku is a CDR **sponsored affiliate** of openfeed. openfeed, the sponsor, collects from data
  holders on Moroku's behalf (CDR Rules 5.1B(3)). Moroku seeks and manages the consents
  (Division 4.3).
- The consent flow and the consumer dashboard must name the sponsor, its accreditation number,
  and a link to its CDR policy (4.3(2B), 4.11(3)(i), 1.14(3)(ha)).
- Collection, use and disclosure consents are separate, and each is separately manageable
  (1.10A).
- Research use beyond the person's own assessment needs a **de-identification consent** (1.7,
  4.15). De-identified data can't be deleted afterwards, and the consumer must be told that
  before they consent.
- H0: a revocation is detected within **15 minutes**, and the person's data is purged within
  **24 hours**.
- Ingesting real data is **not** part of SIG-61: no openfeed connector calls, and no code that
  pulls or stores bank data.

## Decision

### 1. An isolated environment in Sydney

- A **separate AWS account** for real data (preferred), or failing that an isolated environment
  in the existing organisation with its own VPC and no peering. Region **ap-southeast-2** only;
  a service control policy denies every other region.
- No path from the dev sandbox (the mock, account 932027117528) or any developer laptop into it.
  The mock stack (`infra/mock-stack.ts`) stays synthetic.
- No internet egress except to openfeed's production endpoints, through VPC endpoints and a
  NAT with an egress allow-list.

### 2. Keys and storage

- **KMS customer-managed keys**, one for data (raw grant data, derived features, run inputs) and
  one for the **truth store** (truth-capture records), so access to declarations and to bank
  data is granted separately. Key rotation on. Key policies name the function roles only.
- openfeed signing keys never leave KMS. Other secrets only in Secrets Manager, encrypted with
  the data key.
- **S3 with SSE-KMS** (bucket keys on), one bucket per store. Bucket policies deny:
  any request without TLS (`aws:SecureTransport` false), any principal outside the account,
  any `PutObject` not encrypted with the store's key. **Block Public Access** on at account and
  bucket level. Versioning on with a short noncurrent-version expiry, so a deletion completes
  within the purge window (see 6).
- Nothing real is ever written to DynamoDB tables, logs, queues or caches outside these
  buckets. Logs never hold transaction descriptions, references, account numbers or tokens.

### 3. Access logs

- **CloudTrail data events** for every bucket and for KMS, in an organisation trail written to
  a separate log account with object lock.
- **S3 server access logs** for every bucket.
- **KMS key-usage logs** (CloudTrail `Decrypt`/`GenerateDataKey` events per key), with an alarm
  on any use by a principal other than the function roles.
- These logs are the access record: who read what, when. They are what the precise times of a
  deletion are proved from; the deletion receipt holds only the date (see 6).

### 4. Roles

- One **IAM role per function**: connect and grant storage, sync, feature derivation, truth
  capture, the run harness, revocation polling, deletion. Each role reaches only its own
  stores and key.
- **No standing human access.** Humans get in only by **break-glass**: a role assumed with MFA,
  time-limited, that alarms on use and is logged in CloudTrail. Every use is recorded on the
  ticket that needed it.

### 5. What may leave the environment

- Only **aggregate counts and rates**, in run records that pass the **T2 guard**
  (`src/research/realdata/guard.ts`). The guard is an allow-list: numbers, booleans, and strings
  from a fixed vocabulary of keys and enums (label names, signal IDs, states, ISO dates without
  times, version strings, commit SHAs, the source and consent-basis identifiers). Anything that
  could be real text or an identifier is rejected, and a key naming an identifier (employer,
  lender, payee, description, account number, consumer reference…) can't hold a value at all.
- `scripts/lib/run-record.ts` writes a record that declares a real source (`openfeed-production`)
  only through the guard and only under `realdata/`, which git ignores. `writeNew` refuses
  any content naming a real source, so the guard can't be bypassed.
- `test/repo/real-data-guard.test.ts` scans the committed run records, manifests,
  preregistrations, reviews and test fixtures: no file may declare a real source, hold an email,
  card number, TFN, phone number, CDR token, masked number or base64 token, or (unless it belongs
  to a synthetic set or has a listed provenance) hold anything the guard rejects.
- Small cells (proposed, for Colin): Stage A has few people, so a rate over one or two of them
  can identify a person. Proposed: every exported rate carries its denominator, and a rate over
  fewer than five people is not exported. Not enforced by the guard; see "Not built".

### 6. Retention and deletion (T3)

- Raw grant data and derived features are kept only for as long as the person's consent and
  the experiment need them, and never past the end of Stage A.
- The deletion procedure is `deleteConsumer` (`src/research/realdata/deletion.ts`) over one
  interface for every store: raw grant data, derived features, truth-capture records, run
  inputs and caches. It removes every record for one opaque consumer reference from every store,
  then verifies none remains. Its receipt holds counts per store, the date and the outcome; no
  personal data and no consumer reference. A store that fails fails the receipt. Running it
  again is safe. The receipt is a run record the T2 guard accepts. Operator steps are in
  `docs/runbooks/real-data-deletion.md`.
- **De-identified research data is out of scope by law**: once de-identified under a
  de-identification consent it can't be linked back to the person, so it can't be deleted.
  The consumer is told that when they give that consent.

### 7. Revocation

- openfeed has no webhooks (CLAUDE.md), so revocation is **detected by polling** the arrangement
  status for every active grant **at least every 5 minutes**, which keeps detection within the
  15-minute target with margin. A revocation through Moroku (the portal's withdraw, a lender
  closing the applicant, stopping a watch) is acted on at once.
- On detection: stop every sync and run for that consumer, mark the grant revoked, and start
  `deleteConsumer`, which must complete and verify within **24 hours**. A failed receipt pages
  the on-call engineer and is retried; the 24-hour clock is not reset by a retry.

### 8. The de-identification consent path: pending

Whether Stage A collects under the **service** consent only, or **service plus
de-identification** consent, is **Colin's decision, pending**. Legal sign-off on the consent
wording is also **pending**. Until both land:

- the guard accepts both consent-basis identifiers (`cdr-service`,
  `cdr-service-and-deidentification`) so a run record can say which applied;
- no de-identification step is designed or built, and nothing real is used beyond each team
  member's own assessment;
- if the route includes de-identification, a follow-up ticket designs the de-identification
  method and its own controls.

## Truth capture (T4)

Team members declare their own pay and liabilities so a real-data run can be scored against
them: `research/schemas/truth-capture-v1.schema.json` and `src/research/realdata/truth-capture.ts`.
Structured fields only, no free text, unknown fields rejected. Employer and lender are normalised
names held only in the truth store; the T2 guard rejects any record holding them. A capture form
is a **Lovable follow-up**; no UI is built here.

## What is built in this repository

- The T2 guard, its wiring into `scripts/lib/run-record.ts`, the repo scan, and the
  `realdata/` entry in `.gitignore`.
- The T3 store interface with in-memory and local-filesystem implementations, `deleteConsumer`
  and `verifyDeleted`.
- The T4 truth-capture schema, validator and `captureTruth`.

## Not built (design only)

- The AWS account or environment, the KMS keys, buckets, bucket policies, CloudTrail, access logs,
  roles and break-glass role. No AWS resource was created.
- S3 implementations of the stores, revocation polling, the purge job and its alarms.
- Ingestion: the openfeed production connector, the grant callback and sync for real data.
- The consent flow naming the sponsor, the consumer dashboard, and separate collection, use and
  disclosure consents. See `docs/runbooks/real-data-readiness.md` for each item's state.
- Small-cell suppression in code.
