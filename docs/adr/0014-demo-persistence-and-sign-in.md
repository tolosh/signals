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
  ADR adds the one named exception ruling 40775 (1) calls for. The guards are not edited by this PR;
  they fail on it until Colin rules on narrowing them to `src/api/dynamo.ts` and
  `infra/demo-stack.ts`.
