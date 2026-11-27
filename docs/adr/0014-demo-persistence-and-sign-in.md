# 0014: The demo stage's persistence stand-in and sign-in check

- **Status:** proposed (SIG-82, candidate 0). Colin rules.
- **Ticket:** SIG-82, section 5 (Persistence), rulings 40775 (1) and 40777, and 40779.
- **Scope:** the hosted demo stage `MorokuSignalsDemo` only (D59). Synthetic data only.

## Context

SIG-82 section 5 asks for "the smallest store that keeps tenant isolation testable for the demo,
decided in an ADR: Aurora with RLS (D1), or a stated demo-only stand-in with the isolation test
kept". Ruling 40775 (1) chose the stand-in: the demo application layer reuses the mock's routing and
DynamoDB store, adds a verified sign-in and workspace scoping, and keeps T5 (tenant B gets 404 on
tenant A). The real-data path (SIG-61) stays off.

## Decision

1. **Store.** One on-demand DynamoDB table in the demo stack, with the mock's layout (ADR 0005):
   partition key `pk`, sort key `sk`, the value in `data`, long values split across items, a TTL in
   `expires_at`. Demo records live 30 days. The store's code is a copy of `src/mock/persist.ts`'s
   store (`src/api/dynamo.ts`): importing the mock's module would pull its fixtures into the demo
   Lambda, which must never serve them.
2. **Tenant isolation is structural.** Each demo workspace's records sit under their own partition,
   `ws#<workspace id>`. A `/v1/app` request reads and writes only the partition of the workspace its
   verified sign-in maps to, so another workspace's ID is never found: 404, never 403, so nothing
   confirms the ID exists (T5). Portal tokens sit under `portal`, each naming its workspace and
   applicant; a token is 128 random bits.
3. **Workspaces.** Two seeded workspaces, A and B, with credits seeded so the app is never stuck
   behind checkout, and the AF-T1 policy SIG-76 records (11.5%, 3% buffer, 5.5% floor, card factor
   0.03, INC's default shading, expense method `observed`). Membership is stack configuration
   (`-c demoMembers=<email or user id>:A,...`), not data. Billing is not real (40775).
4. **Sign-in.** Every `/v1/app` call needs a Supabase access token, verified server-side with the
   project's public values only (40779):
   - **preferred:** the signature (ES256 or RS256) against
     `<project URL>/auth/v1/.well-known/jwks.json`, cached 10 minutes and refreshed once on an
     unknown key ID; then the issuer (`<project URL>/auth/v1`), the audience (`authenticated`), the
     expiry and the not-before;
   - **fallback,** used only when the project publishes no keys and the token is HS256:
     `GET <project URL>/auth/v1/user` with the token and the publishable key, cached 60 seconds by
     the token's SHA-256, never the token.
     The project URL and publishable key are public stack configuration, not secrets. Nothing logs a
     token, its hash or its claims; the Lambda logs only the method, status and time taken.
5. **Enrich.** The Enrich path is forced to `local` in the stack and at start-up, ApiEnrich is never
   built, and the pinned 1.8.0 build is bundled into the Lambda (D58, T3). The Lambda's only grants
   are its table and its logs.

## Consequences

- The workflow plumbing is demo-grade, disclosed on the stage (a banner on every `/v1/app/me`) and in
  the demo. Every assessment figure will come from the real engines (candidate 1).
- **Not real:** email and SMS invites (the invite carries `portal_url` for the lender to copy,
  contract 1.10.0); the bank consent (a labelled sandbox page); the PDF (labelled "not available in
  this demo"); the Watch; billing; notes, overrides, members and benchmarks beyond read-only stubs.
- **RLS isn't exercised.** Isolation rests on the partition key chosen from the verified sign-in, and
  on T5. Shared code's RLS rules are unchanged (D1); nothing here is used outside the demo stage.
- **Disclosed conflict with ADR 0005's guards.** ADR 0005 said the DynamoDB table is for the mock
  only, and two guard tests enforce that (`test/mock/state.test.ts`, "nothing outside src/mock imports
  the DynamoDB client", and `test/mock/stack.test.ts`, "the table is in the mock stack only"). This
  ADR adds the one named exception ruling 40775 (1) calls for. D65 (SIG-82 40818, 3) ruled it:
  each guard is narrowed to exactly `src/api/dynamo.ts` and `infra/demo-stack.ts` (#71, a
  disclosed test edit), with an assertion that no stack other than MorokuSignalsDemo uses or
  references the store.

## Candidate 1

- The assessment port runs the real `assessApplicant` (composition 1.2.0) on the scenario the
  applicant chose at the sandbox consent. The five inputs are built at build time exactly as
  SIG-76's in-process runs built them (`src/api/scenario-inputs.ts`), each feed in its seeded order,
  and shipped in the Lambda's asset (`scenario-inputs.json`). The hosted output's SHA-256 equals the
  frozen `output_sha256` for C, A, B, D and D2 (SIG-76 T3; states file `19bab324…ece1`).
- The whole output, embedded Enrich record included, is stored server-side only. A lender
  response never carries it (SIG-82 40802, 1). The acceptance reads its hash at
  `GET /demo/assessments/{id}/output-sha256`, which is signed in and scoped like `/v1/app`.
- Before the mapping was ruled, `GET /v1/app/assessments/{id}` returned a labelled 501
  (`assessment_mapping_pending`). D65 (SIG-82 40818) ruled it; see below.

## The contract mapping (contract 1.11.0; D65, SIG-82 40818)

`src/api/mapping.ts` maps the stored output to the contract when it is read: `GET
/v1/app/assessments/{id}` (Assessment), `…/affordability/trace` (AffordabilityTrace), and the
applicant's list and the run's 202 (AssessmentSummary). The mapping is the one proposed in SIG-82
40805 and 40817 and approved as proposed (D65, 2): figures, states and reasons are copied, never
reshaped or rewritten.

- **The roll-up's reasons (D65, 1).** Ordered on the server in four tiers: (1) evidence-quality
  reasons with a state; (2) red movers; (3) amber movers; (4) evidence-quality reasons with state
  null. The composition's order is kept within a tier. `top_reasons` is the first three,
  `all_reasons` the whole list, `reasons_total` its length. On set v2.3's 780 applicants: 306
  reasons in tier 1, 278 in tier 2, 589 in tier 3, 35 in tier 4; 57 applicants have more than
  three reasons, and none has more than three in tiers 1 and 2 together, so no red is left out of
  `top_reasons`. The frozen five are unchanged (none has more than three).
- **The income's state.** `serviceability.monthly_income_state` is `unverified` exactly when the
  affordability engine's own trace records "no income" (56 of the 780), otherwise `observed`.
  `monthly_income` keeps the engine's figure.
- **Versions.** `Assessment.versions` is copied from the output. `eq_method` and
  `observed_expenses` aren't in the output: they are the engines' own constants
  (`EQ_METHOD_VERSION`, `OBSERVED_EXPENSES_METHOD_VERSION`), as `pins.definitions_version` is.
- **The trace.** Income is INC's income rows; the expense lines are observed committed, basic and
  unverified, which sum to the GLE used (only the observed method has lines; any other method is
  refused, not shown with lines that don't add up); liabilities are the engine's `repayments`
  commitments, each with its type's Product Specification 6.4 rule by name, as the engine's
  `commitment()` applies it; the steps are the engine's own, a step it couldn't compute with a
  null value.
- **Never in a lender response:** the embedded Enrich record, transactions, taxonomy, INC's trace,
  LIA's evidence IDs. A test checks that no transaction ID of the 780 feeds appears.

**Disclosed gaps** (D65, 2; also for Lovable's About page):

- not mapped: `expenses.discretionary_monthly`, `months_covered`, `one_offs`, `excluded`,
  `lia_repayments_in_other_categories` and `unmapped`, and `evidence.rollup.green_allowed`;
- there is no separate list of found liabilities (LIA-01's reason names them);
- `reasons_to_say_yes` is always empty: family 10 (POS) isn't built;
- the evidence endpoint (`…/signals/{signalId}/evidence`) returns a labelled 501,
  `evidence_not_built`, until the masked evidence (40805, 2.7) is built and tested;
- notes, overrides and the PDF are not available in this demo.

## Review 23 changes (SIG-82 40821; Lovable's answer, 40820)

These supersede the sign-in description in decision 4.

- **Signatures: ES256 only** (40820, 1). Any other signed algorithm is refused without a fetch. An
  unknown key ID forces one reload of the key list, at most once a minute, and is then remembered
  as unknown for a minute.
- **The `/auth/v1/user` fallback is for HS256 tokens only,** and only while
  `SUPABASE_HS256_FALLBACK` is `on`. The stack sets it from `-c hs256Fallback` (default `on`), and
  `/health` reports it as `auth.hs256_fallback`. It never depends on the key list. Its answer is
  cached for at most 60 seconds by the token's SHA-256, never past the token's `exp`. An HS256 token
  without an `exp`, or past it, is refused without a call. **Once Lovable's switch to ES256 is
  confirmed, deploy with `-c hs256Fallback=off`.**
- **No other fallback.** If the key list can't be fetched, and no copy younger than an hour is held,
  or `/auth/v1/user` answers 5xx or can't be reached, the API answers 503 `sign_in_unavailable`.
- **Membership binding** (40820, 3). A demo member listed by email is bound to the `sub` first seen
  with that email. The binding is recorded under the `member` partition (`binding#<email>`, with the
  demo's 30-day TTL). A later sign-in with the same email and another `sub` gets 403. Members listed
  by user ID are matched on `sub` alone. **Limit:** the store has no conditional write, so two
  first sign-ins at the same instant could each see no binding. The later write wins.
- **500s** carry a correlation ID in the message and in `x-correlation-id`. The log line holds the
  ID, the method, the status and the error's class, never its message or anything the request
  carried.
- **Synthesis.** An `enrichPath` context, or an `ENRICH_PATH` value, other than `local` fails the
  build (G4). A build that `build-info.json` records as dirty (`--allow-dirty`) refuses to
  synthesise.
