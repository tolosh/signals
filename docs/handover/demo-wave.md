# Handover: the 1 December demo wave

This note says who owns what and in what order things land, for this wave only. It doesn't repeat
rulings. Those live on the tickets and in Confluence:

- the demo plan: Confluence page 3238723585;
- the Decision Record (D42, D57 to D62): page 3234988050;
- the tickets: SIG-70, SIG-81, SIG-82, SIG-83 and SIG-76.

Written for SIG-82 (ruling 40735), and updated for the merge order of SIG-76 40745 and SIG-70 40749.

## Who owns the shared `infra/` files this wave

| File                                                  | Owner this wave | Note                                                                                                   |
| ----------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| `infra/app.ts`                                        | SIG-82          | Adds the `MorokuSignalsDemo` stack beside `MorokuSignalsMock-dev`. No other ticket edits it this wave. |
| `infra/mock-stack.ts`                                 | nobody          | Unchanged this wave.                                                                                   |
| `infra/realdata-stack.ts`, `infra/realdata-lambda.ts` | SIG-61          | Unchanged this wave, and never added to `infra/app.ts` (see below).                                    |
| The demo stage's health handler and `test/infra/`     | SIG-82          | SIG-82's infrastructure may run in its own worktree, but it touches only these paths and `infra/`.     |

SIG-82's infrastructure doesn't touch `src/engines`, the Enrich adapter, the composition
(`src/assessment`), `research/preregistrations` or `openapi.yaml`.

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
