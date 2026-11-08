# Moroku Signals API

Backend for Moroku Signals — The Open Banking Analyser: lender workspaces, billing
and credits, applicant invites, the openfeed connector and sync, the affordability,
signals and decisioning engines, the Watch, and the credit-file PDF. The UI is
separate Lovable apps that only talk to this API.

Source of truth for behaviour: the Product Specification in Confluence (PRD space,
Signals > Source Documents) and its amendments. Requirement IDs: FR-, OB-, SY-,
AF-, EN-, ER-, RU-, BL-, GR-, DR-. Cite the ID in commits and tests. Decisions:
Signals > Decision Record pages. Where this file and Confluence disagree,
Confluence wins; stop and comment on the ticket.

## This is a science experiment
Signals is an R&D activity, run under the Odyssey Program Operating Discipline
(Confluence ENG space). The core hypothesis and sub-hypotheses H0 to H6, the
experimental stages and the evaluation thresholds are on Confluence:
"Moroku Signals — Hypothesis, Experiment and Evaluation". Every ticket tests one
of those hypotheses, or builds apparatus for one. Work is controlled through Jira
project SIG. Every change traces to a ticket.

Before work:
- Work only on the ticket you were given. Read it in full first (sections 1 to 6),
  its parent workstream, and the hypothesis it names on the hypothesis page.
- Before planning a ticket, and before reporting anything as "waiting on Colin":
  re-read the Decision Record ratification table and every comment on the ticket,
  and on any ticket it depends on. Rulings land as dated comments.
- Never edit a ticket's sections 1 to 6: hypothesis, expected outcome, targets,
  method or tests. If they are wrong or untestable, stop and comment on the ticket
  explaining why.
- Branch `SIG-<n>-short-name`; every commit starts `SIG-<n>:`; PR title starts with
  the key. One ticket per PR. Open PRs; never merge your own.
- Write the tests in section 6 first, named T1, T2… so results map back to the ticket.

During work:
- Experiments (label type-experiment): commit pre-registered inputs (hypothesis
  files, cut-offs, seeds) before any run; run the negative control first, and if it
  fails, stop, because no other result in the set stands. Run with the scoring
  harness and save the run record under research/runs/. Never tune parameters on
  the evaluation set beyond the variables the ticket lists, and never adjust a test
  to rescue an expected result.
- Out-of-scope findings become a comment proposing a new ticket, not extra code.

At close (every ticket, no exceptions):
1. Push the branch to GitHub and open the PR, linking the ticket and the spec.
2. Write sections 7 RESULTS and 8 CONCLUSION into the ticket description, below
   the "written into the ticket at close" line, replacing the empty headings only.
   Section 7: delivery state (PLANNED / LOCALLY-TESTED / INTEGRATED / DEPLOYED)
   and date; actual against expected for each target; T1..Tn pass/fail; evidence
   (PR link, commit SHA, CI run, run record path, data set hash); deviations;
   what was NOT done; environment and timestamp; "engineering-reported" unless
   independently re-run. Section 8: Supported / Refuted / Inconclusive (or n/a for
   apparatus), what was learned, impact on the hypothesis page or spec, pages
   updated, follow-up tickets.
3. Add a dated comment headed "EXECUTED <date>" summarising the same, with the
   commit SHA and PR link. Each later run or fix gets its own dated comment;
   earlier results and failures are kept, never overwritten.
4. Add a line to the Results log on the hypothesis page: date, hypothesis, ticket,
   state, one-sentence result. If the result changes what a specification,
   contract or decision page says, update that page as a new version and link it
   in section 8.
5. Do not move the ticket to Done. A person reviews sections 7 and 8 and closes it.
- Re-read a shared page immediately before saving; change only what you came to
  change; Results log entries are new rows only (Decision Record D4).
- Design decisions worth keeping go in docs/adr/ and are linked from the ticket.
  Docs in this repo point to Confluence; they never fork it.
- When sweeping Jira, fetch tickets key by key; JQL under-reports on this instance.

## Engineering rules
- Contract first. Change openapi.yaml in the same PR as the code; responses must
  validate against it in tests. openapi.yaml here is the canonical contract.
- The backend decides, the UI displays. Every ratio and signal returns `state`;
  every signal also returns an `evidence_quality` block.
- Engines are pure functions of (data snapshot, definition version, threshold
  version, taxonomy version, scorecard version). Same inputs, same output (AF-1, EN-2).
- No AI, LLM or ML inference anywhere in the engines (Decision Record D3). Engines
  import no network, AWS, database or AI SDKs; a test enforces it. Decisioning is
  deterministic statistics: no sampling, no randomness, no wall-clock reads.
- Published versions (definitions, thresholds, benchmarks, scorecards, drift
  snapshots, import batches, watch runs) are immutable. A correction is a new
  version; there is no write path to a published one.
- Test first for engines. Fixture AF-T1 must reproduce exactly (DSR 0.75,
  NDI 1.48, ARA 11,333, LVR 0.80, Benchmark/GLE 0.47, LTI 3.86/5.28, DTI 4.05/5.54).
- Tenancy: every tenant table has workspace_id with row-level security. Never
  bypass RLS outside migrations. Decisioning comparables and drift statistics
  never cross workspaces.
- Never log transaction descriptions, references, account numbers or tokens.
  Real consented data never enters the repository, fixtures or run records;
  only counts and rates do.
- Secrets only from Secrets Manager or KMS. openfeed signing keys never leave KMS.
- Sensitive spending (medical, pharmacy, religious, union, political) never feeds
  a signal or decisioning input (GR-3). Every engine entry that reads transactions
  removes it first with `withoutSensitive` (src/engines/sensitive.ts), by Enrich
  category (`healthcare`, or a payee Enrich marks sensitive) or by MCC;
  test/repo/gr3.test.ts enforces it. Limits: a line with neither a sensitive
  category nor an MCC (a bank transfer to a parish) can't be recognised, and
  observed living expenses still count `healthcare` (AF-E1), pending ruling
  G-1 (docs/adr/0007-gr3-sensitive-spending.md).
- No endpoint, field or enum returns approve or decline (GR-1). Decisioning
  queues are in_appetite, review, outside_appetite, unverified. How GR-1 applies to
  reporting a lender's own recorded decisions is pending Decision Record D7.
- openfeed provides no direct debits, scheduled payments, payees or customer data,
  and no webhooks. Never depend on them.

## Stack
TypeScript, Node 22, strict mode. Vitest, ESLint, Prettier. AWS Sydney
(ap-southeast-2) with CDK: Lambda + API Gateway, SQS workers, EventBridge
Scheduler, Aurora PostgreSQL with RLS, Fargate for PDF (Decision Record D1).
Supabase is used by the front ends for authentication only; verify its JWTs.
Layout: see Build Specification 5.2, plus research/ (synthetic data sets, run
records), src/engines/decisioning/, src/watch/ and docs/adr/.
