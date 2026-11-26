# ADR 0011: the Enrich adapter, its paths, and the lookups asymmetry

Status: ruled (Colin, 26 November 2026; SIG-70 comments 40714 and 40719, and Colin's answers to
the SIG-70 plan the same day). Decision Record D42, D43, D57 and D58.

## Context

The engines read Enrich categories as a pure input (D3). Until SIG-70, Signals categorised only
offline: `scripts/enrich-categorise-set.ts` and `scripts/enrich-sample*.ts` import the Enrich
engine's dist from a sibling moroku-enrich checkout, and commit the categories under
`research/enrich/`. Nothing categorised an assessment at run time.

D42 sets how Signals uses Enrich. A lender with an active Enrich tenant is categorised by Enrich's
API under that tenant, with a Signals service credential. Every other assessment, and every failed
call, uses the pinned local engine. The path is recorded, and no synthetic data ever goes to the
live API.

## Decision

1. **One port, two implementations** (`src/connectors/enrich/`).
   - `LocalEnrich` (`local.ts`) is the pinned local engine, called exactly as the research scripts
     call it.
   - `ApiEnrich` is built when SIG-72 provides the service credential and tenant mapping (ruling
     40719, 3).
   - The engines never call either. They read the categories stored with the assessment.
2. **Path selection** (`path.ts`):
   - an active tenant goes to `api`;
   - a pending tenant, or none, goes to `local`;
   - a timeout, a 5xx or a 429 goes to `api_fallback_local`, with the reason recorded;
   - an active tenant with no API client yet also goes to `api_fallback_local`, reason
     `unavailable`.
3. **Synthetic data is refused on the API path.** A synthetic feed is categorised locally even for
   an active tenant, and the record says `api_refused: synthetic`. Nothing that reads the synthetic
   sets may import the live client (`src/connectors/enrich/api.ts`, reserved); a static test
   enforces it.
4. **The record** (`EnrichRecord`), stored with every assessment, holds:
   - the path, and the engine and taxonomy versions;
   - the taxonomy as the categoriser published it;
   - the local build (commit, version and dist SHA-256);
   - any fallback reason;
   - the full response.

   An assessment is replayed from it (`replay.ts`), never by calling Enrich again.

5. **The credential** (`credential.ts`). The API is called only with Signals' service credential
   for the named tenant. A lender's own key is refused, and so is any credential for another tenant.
6. **The demo runs on `local` only** (D58).

## The pinned build

**Pinned, 27 November 2026** (Colin: the ENR-28 build, published on ENR-28 comment 40724):
moroku-enrich `8cdb0d926f7a9473051655fdeed5d69c1ceffaeb`, engine 1.8.0, taxonomy 1.4.

- `scripts/enrich-package.ts` refuses unless the checkout is at that commit, with `packages/engine`
  and `packages/taxonomy` clean, and `dist/index.js` at the published SHA-256 (`134909da…`).
- It bundles the engine and taxonomy dists into `vendor/moroku-enrich/engine-1.8.0-8cdb0d9.mjs`
  (SHA-256 `f843b882…`). An independent rebuild reproduces that hash.
- It writes `vendor/moroku-enrich/pin.json`, with every dist file's hash.
- `pinnedLocalEnrich()` (`src/connectors/enrich/pinned.ts`) runs it, and names it as the build on
  each record.
- The published dist **tree** SHA-256 (`151430cb…`) **verifies too**, by the Enrich side's method:
  GNU `sha256sum` binary-mode lines (`<hex> *packages/engine/dist/<name>.js`), sorted by path, each
  LF-terminated, then hashed. The packaging script refuses a mismatch, and the pin test
  recomputes it from `pin.json`.
- New fixtures, made on the pinned build with `--pin`, sit beside the 1.7.0 ones. Each records its
  moroku-enrich build (`enrich_build`):
  - `research/enrich/synthetic-v1-categories-engine-1.8.0.json`;
  - `research/enrich/synthetic-v2.2-categories-no-biller-code-engine-1.8.0.json`.
- Runtime categories on the pinned build equal both exactly (`test/connectors/enrich/pin.test.ts`).
- The ENR-28 fix shows in them. On set v2.2, 10,927 debits move from `transfer` to an expense
  category (4,423 to `other_expenses`, 2,833 to utilities, 1,597 to insurance, and others). On set
  v1, 1,101 move.
- The experiments that ran on the 1.7.0 fixtures (SIG-17, SIG-57 and others) keep them.

### As first recorded (26 November), before the pin

Ruling 40719, 2: the engine is packaged into the Signals build by moroku-enrich commit and hash,
never imported from a sibling checkout at run time. The committed `research/enrich` categories stay
as the CI fixture, and a test asserts that runtime categories equal them for the same build. A new
build is a new fixture, recorded, not an overwrite.

**Colin's answer (26 November): no packaging or pin until the Enrich side publishes the ENR-28
build** (BPAY bill payments returned as transfers). Two facts make an interim pin unsafe:

- No `research/enrich` fixture records which moroku-enrich build made it. They record only the
  engine and taxonomy versions. The set v2.2 fixture's `engine_commit`, `b85fd2b`, is the
  **Signals** commit the script ran at (`scripts/lib/run-record.ts`, `provenance`), not a
  moroku-enrich commit.
- moroku-enrich's HEAD still reports engine 1.7.0, taxonomy 1.4, though its code has changed since.
  A version string doesn't identify a build; only the commit and the dist hash do.

_Corrected 27 November 2026:_ the first version of this ADR read `b85fd2b` as a moroku-enrich
commit missing from its history. It is a Signals commit. The conclusion stands: no fixture
identifies the Enrich build behind it.

Until the pin, LocalEnrich took the engine module as an argument, and the tests used a stand-in.
It still takes one, so the adapter's tests keep their stand-in.

## Known limits

1. **The lookups asymmetry** (ruling 40719, 4). The local path runs the engine with all four
   lookups stubbed: no dictionary, no user or tenant overrides, no LLM cache. Only rules, MCC and
   the taxonomy apply. The API path has them. The two paths can therefore categorise the same
   transaction differently by construction, so D42's path agreement is not 1 by design. SIG-70's T6
   measures it when it runs. A local `api_fallback_local` assessment is categorised without the
   lender's own corrections.
2. **T6 is not run.** ENR-32's non-synthetic corpus and SIG-72's credential are not available, and
   synthetic data is never substituted (ruling 40714).
3. **The engine-facing consumer rules are not applied here.** Classification-based expense groups,
   `excluded` as not spend, gambling and crypto inflows never income, and `other_expenses` as
   essential change frozen engines, so they are SIG-81. The adapter keeps classification,
   `excluded` and direction in the record for them.
4. **ENR-30, ENR-31 and ENR-10** (private transfers and sensitive payees not distinguished;
   corrections on credits and transfers ignored) are dependencies, not blockers. `sensitive.ts` and
   the display masking (SIG-64, SIG-74) stay in force.
