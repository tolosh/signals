# Handover: the 1 December demo wave

This note says who owns what and in what order things land, for this wave only. It doesn't repeat
rulings. Those live on the tickets and in Confluence:

- the demo plan: Confluence page 3238723585;
- the Decision Record (D42, D57 to D62): page 3234988050;
- the tickets: SIG-70, SIG-81, SIG-82, SIG-83 and SIG-76.

Written for SIG-82 (ruling 40735), and updated for the merge order of SIG-76 40745 and SIG-70 40749,
and for the weekend division of work (SIG-82 40777) and the demo stage's deploy steps.

## Who owns the shared `infra/` files this wave

| File                                                  | Owner this wave | Note                                                                                                   |
| ----------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| `infra/app.ts`                                        | SIG-82          | Adds the `MorokuSignalsDemo` stack beside `MorokuSignalsMock-dev`. No other ticket edits it this wave. |
| `infra/mock-stack.ts`                                 | nobody          | Unchanged this wave.                                                                                   |
| `infra/realdata-stack.ts`, `infra/realdata-lambda.ts` | SIG-61          | Unchanged this wave, and never added to `infra/app.ts` (see below).                                    |
| `infra/demo-stack.ts`, `infra/build-demo-lambda.mjs`  | SIG-82 Thread 2 | The demo stage and its build (candidate 0).                                                            |
| The demo stage's health handler and `test/infra/`     | SIG-82          | SIG-82's infrastructure may run in its own worktree, but it touches only these paths and `infra/`.     |

From 40777, Thread 2 (hosted application) owns `infra/**`, `src/api/**`, `src/auth/**`, the health
handler, `test/infra/**`, `test/api/**`, `openapi.yaml`, this note and ADR 0014. Thread 1
(assessment intelligence) owns `src/engines`, `src/assessment`, `research/preregistrations` and
`research/runs`. Thread 2 reaches the composition only through `src/api/assessment-port.ts`, and
consumes the Enrich adapter without changing it.

## Merge order

Every PR targets `main`, and nothing merges into another PR's branch. Stacked work lands on `main`
in this order:

1. SIG-70, the adapter and the pinned build: done (#57, #61; main at `909e7e2`).
2. The SIG-70 follow-up: O2, O3 and O4.
3. SIG-82 part 1, the composition (#62), after Colin rules on ADR 0012.
4. The narrow SIG-81, with its independent check.
5. SIG-83, LIA's detection, with its independent check.
6. SIG-76, its own PR: the pre-registration and the expected states, recomputed and committed
   before any candidate build. Then the architect freezes them.
7. The candidate build, then SIG-82's demo stage, which Colin deploys.

## The AWS account, and isolation from Enrich

- Signals deploys into account `932027117528`, region `ap-southeast-2`, the same account as the
  mock stack.
- **The account is shared with Moroku Enrich.** Signals' stacks never reference an Enrich table,
  parameter, secret or hostname, and Enrich's never reference Signals'.
- The demo stage has no network route to the Enrich API, and its Enrich path is forced to `local`.
- Colin deploys. Engineering doesn't create AWS resources.

## The pinned Enrich build

- **Build:** moroku-enrich `8cdb0d926f7a9473051655fdeed5d69c1ceffaeb`, engine 1.8.0, taxonomy 1.4.
- **Packaged** in `vendor/moroku-enrich/` by `scripts/enrich-package.ts`.
- **Named** in `vendor/moroku-enrich/pin.json` (the dist `index.js`, the dist tree, the taxonomy
  and the bundle SHA-256s) and in `src/connectors/enrich/pinned.ts`.
- Each assessment's Enrich record names the build by its dist tree SHA-256, `151430cb…5284`.
- It is never imported from a sibling checkout. A new build is a new bundle, pin and fixture.

## The real-data stack stays out of `infra/app.ts`

`infra/realdata-stack.ts` is written and tested, and it is never synthesised by `infra/app.ts`. The
real-data path (SIG-61) stays off until N-2, N-3, N-11 and N-12 clear and Colin gives the
go-ahead. The demo stage runs on synthetic data only (D59), and no synthetic data reaches the live
Enrich API (D42).

## The demo stage: deploy steps (Colin)

The stack is `MorokuSignalsDemo` (`infra/demo-stack.ts`; ADR 0014). It's synthesised only with
`-c demo=true`, so ordinary mock deploys are unchanged. The architect gate-checks the PR head first:
no real-data resource, no Enrich resource or host, Enrich forced `local`, `/health` reads the
commit, tenant B gets 404.

> **Warning: never pass `-c hs256Fallback`.** Sign-in is ES256 only (40822; ADR 0014). The
> setting was removed in candidate 1, and any value of it now fails the synth, so a diff or deploy
> command that still carries it stops. The same goes for `SUPABASE_HS256_FALLBACK` in the Lambda's
> environment, which refuses to start.

You need the AWS credentials you use for the mock (account `932027117528`, `ap-southeast-2`; the
account is already CDK-bootstrapped), Node 22, and three values:

- the Lovable project's Supabase URL, `https://<ref>.supabase.co`;
- its publishable (anon) key;
- the demo members: the email (or Supabase user ID) of each lender account and its workspace, as
  `<email>:A,<email>:B`. Tenant A is the demo lender; tenant B exists for the isolation check.

1. **Check out the exact commit** the architect checked, with a clean tree:
   `git fetch origin`, then `git checkout --detach <head SHA>`. `git status` must show nothing to
   commit, and `git rev-parse HEAD` must print the head SHA.
2. **Install:** `npm ci`.
3. **Run the gates:** `npm run typecheck`, `npm run lint`, `npm test`.
4. **Build both Lambda assets.** `npm run build:mock` (the app synthesises the mock stack too, so its
   asset must exist; it isn't deployed), then `node infra/build-demo-lambda.mjs`. The second prints
   `Built dist/demo-lambda at <SHA>`. It must be the head SHA. It refuses a dirty tree.
5. **Diff, and read it before deploying:**
   `npx cdk diff MorokuSignalsDemo -c demo=true -c supabaseUrl=<URL> -c supabasePublishableKey=<key> -c demoMembers=<members>`.
   - **First deploy:** expect only new resources: one DynamoDB table, one Lambda with its role,
     policy and log group, and one HTTP API with its integration, route, stage and invoke
     permission.
   - **Redeploy** (the stack already exists): expect only two changes, the Lambda's code (its S3
     key) and `DEMO_COMMIT` (the `DemoCommit` output) moving to the new head. Nothing is added or
     removed. Anything else in the diff, in IAM especially, stops the deploy until it's explained.
   - Either way, expect no KMS key, no bucket, no secret, no SSM parameter, and no change to
     `MorokuSignalsMock-dev`.
6. **Deploy only the demo stack:** the same command with `deploy` in place of `diff`.
7. **Read back the commit.** Open `<DemoUrl>/health`. `DemoUrl` is the stack output. Check that
   `commit` is the head SHA and `enrich.path` is `local` with `version` 1.8.0. From candidate 1,
   also check that `assessment_wired` is `true`, `contract_version` is `1.11.0` and `auth.alg` is
   `ES256` (candidate 0 had `assessment_wired: false` and contract 1.10.0).
8. **Point Lovable at the stage.** Follow the Lovable brief posted on SIG-82: set
   `VITE_API_BASE_URL` to `DemoUrl`, regenerate the types, then rebuild and publish. Sign in as
   tenant A: the dashboard shows "Demo Lender A (synthetic data)" with 100 credits.
9. **Check T5 by hand.** As tenant A, create an applicant and copy its URL. Sign in as tenant B and
   open that URL: it must be "not found".
10. **Record** the deploy commit and time on SIG-82 and SIG-76.

**To change the members later,** redeploy with a new `-c demoMembers=`. Nothing else changes.
**To remove the stage,** run `npx cdk destroy MorokuSignalsDemo -c demo=true` with the same context.
Its table holds synthetic data only and goes with the stack.

## As deployed: candidate 1 (28 Nov 2026, SIG-82 40840)

Colin redeployed the stage at 12:11 AEDT, in PowerShell, against the head review 24 checked
(40839), not the merge commit `fdcfc45`. The commands, as run:

```powershell
$env:AWS_PROFILE = "Moroku-Signals"
aws sts get-caller-identity
git fetch origin
git checkout --detach 7fe7fe93cc58551c4bc100fc81c57ba7d57c36f9
git status
git rev-parse HEAD
npm ci
npm run typecheck
npm run lint
npm test
npm run build:mock
node infra/build-demo-lambda.mjs
npx cdk diff MorokuSignalsDemo -c demo=true -c supabaseUrl=https://omtfpvxlyviqiafcmkde.supabase.co -c supabasePublishableKey=sb_publishable_ZU2Bz7YTAyPWPhsdokuDWA_J2tbNRQz -c demoMembers=<members>
npx cdk deploy MorokuSignalsDemo -c demo=true -c supabaseUrl=https://omtfpvxlyviqiafcmkde.supabase.co -c supabasePublishableKey=sb_publishable_ZU2Bz7YTAyPWPhsdokuDWA_J2tbNRQz -c demoMembers=<members>
curl.exe -s <DemoUrl>/health
```

- **Check the identity first.** `aws sts get-caller-identity` must show account `932027117528`,
  the `Moroku-Signals` user. If it doesn't, stop. That morning the shell was on the Enrich deploy
  user at first.
- The members are recorded on SIG-82 (40819, 40840).

The context is the same as candidate 0's, with no `hs256Fallback`. What they showed:

- the suite: 131 files, 1,907 passed, 0 failed, 1 to-do;
- the build: `Built dist/demo-lambda at 7fe7fe9…`;
- the diff: only the Lambda's code (S3 key `ce4b70db…` to `97f04570…`) and `DEMO_COMMIT`
  (`c834c3e` to `7fe7fe9`);
- the deploy: `UPDATE_COMPLETE`, with the `DemoUrl` unchanged;
- `/health`: `commit` `7fe7fe9…`, contract 1.11.0, `assessment_wired: true`, `auth.alg` `ES256`,
  Enrich `local` 1.8.0, matching review 24's R9.
