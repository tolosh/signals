# Moroku Signals API

Backend for Moroku Signals. Rules for every change are in [CLAUDE.md](CLAUDE.md).

Specifications, decisions and hypotheses live in Confluence and are not copied here:

- [Claude Code Kickoff](https://moroku.atlassian.net/wiki/spaces/PRD/pages/3210641409)
- [Hypothesis, Experiment and Evaluation](https://moroku.atlassian.net/wiki/spaces/PRD/pages/3218374702)
- [Build Specification](https://moroku.atlassian.net/wiki/spaces/PRD/pages/3210510337)
- [Product Specification](https://moroku.atlassian.net/wiki/spaces/PRD/pages/3210215447)

Work is tracked in Jira project [SIG](https://moroku.atlassian.net/jira/core/projects/SIG/board).
Branch `SIG-<n>-short-name`, commits start `SIG-<n>:`, PR titles start with the key.

```bash
npm ci
npm run lint
npm run typecheck
npm test
```

Synthetic data sets. Applicant files are not committed; each set regenerates from its seed. To
check a set against its committed manifest in `research/datasets/` (nothing is written; the exit
code says whether it matches):

```bash
npx tsx scripts/generate-synthetic.ts --check  # synthetic-v1
npx tsx scripts/generate-synthetic-v2.ts --variant 2.3 --check  # synthetic-v2.3 (SIG-63; independent review required before use)
npx tsx scripts/generate-synthetic-v2.ts --variant 2.2 --check  # synthetic-v2.2
npx tsx scripts/generate-synthetic-v2.ts --variant 2.1 --check  # synthetic-v2.1 (withdrawn)
npx tsx scripts/generate-synthetic-v2.ts --variant 2.0 --check  # synthetic-v2 (withdrawn)
```

To write a set's files, pass `--out` with a folder path:

- **Sets v2, v2.1 and v2.2:** the folder must not exist yet, for example
  `--out research/datasets/synthetic-v2.2-copy`. The manifest is written beside it as
  `synthetic-v2.2-copy.manifest.json`. An existing folder or manifest stops the run before
  anything is written.
- **Set v1:** the folder is cleared first and the manifest is written inside it as
  `manifest.json`, so give a folder you don't need (it defaults to
  `research/datasets/synthetic-v1`).

Set v1 (seed 42) is for experiments. Sets v2 (seed 54) and v2.1 (seed 541) stay published but are
withdrawn from experiments: their feeds leak the truth (SIG-54 reviews, 8 November 2026), and their
manifests say so.

**Set v2.2** (seed 602, SIG-60, label-blind) passed independent review 11 (SIG-60 comment 40328)
and may be used for experiments, under Colin's rulings of 16 November 2026 (comment 40386,
recorded in [ADR 0009](docs/adr/0009-synthetic-set-v2.2-limits.md)):

- **Biller codes (D-L4-1).** On v2.2, BPAY biller codes encode the answer: code length, leading
  digit and rank give repayment, type and unseen lender. Every experiment pre-registers that no
  rule or feature uses biller-code length, prefix, digit arithmetic or code rank, or learns
  code-to-name links across applicants. Unseen-lender and no-card-cue results are reported with
  BPAY code features off, and again with BPAY lines excluded. Set v2.3 (SIG-63) fixes the codes.
- **Drift.** Scored per applicant only, never per line; T-drift-line-main is not a target. Three
  drift-tagged applicants have no drift line and are excluded from every drift result, and every
  run reports the list:
  [`synthetic-v2.2.drift-exclusions.json`](research/datasets/synthetic-v2.2.drift-exclusions.json).
  23 applicants remain observable over time and 22 across banks (minimum 20).
- **Fitness per experiment.** The review's table, in ADR 0009, is the record. Each experiment on
  v2.2 copies its row's caveats into its own pre-registration, and its results carry them.
  Dishonour scoring is not fit for anything that predicts dishonours from balances or flows.
- **Reserved names (SIG-60 ruling, 10 November 2026).** Most of v2.2's reserved unseen-lender
  names, like those of v1 and v2.1, are real lenders, so for as long as v2.2 is used they stay off
  LIA's lender-name list (`lenders.ts`) and out of SIG-57's aliases. On real data such a lender is
  shown by its first word ("NOW" for NOW Finance). From the next synthetic set, reserved names are
  invented lenders, checked against the ASIC credit registers.

Set v2.2 stays as run: its generator and its T7 result (fails on 4 of 27 labels) are unchanged.

Local mock of the contract, for Lovable (SIG-11). See `src/mock/`; `Prefer: example=seed_benchmark` or `example=zero_credits` on `GET /v1/app/me` selects a workspace variant.

```bash
npm run mock
```
