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
npx tsx scripts/generate-synthetic-v2.ts --variant 2.2 --check  # synthetic-v2.2
npx tsx scripts/generate-synthetic-v2.ts --variant 2.1 --check  # synthetic-v2.1 (withdrawn)
npx tsx scripts/generate-synthetic-v2.ts --variant 2.0 --check  # synthetic-v2 (withdrawn)
```

To write a set's files, give a new folder with `--out` (synthetic-v1) or a new name (the others);
an existing folder or manifest stops the run before anything is written.
Set v1 (seed 42) is for experiments. Set v2.2 (seed 602, SIG-60, label-blind) awaits its
independent review before any experiment uses it. **Set v2.2 limit (SIG-60 ruling, 10 November
2026):** most of its reserved unseen-lender names, like those of v1 and v2.1, are real lenders, so
for as long as v2.2 is used they stay off LIA's lender-name list (`lenders.ts`) and out of
SIG-57's aliases. On real data such a lender is shown by its first word ("NOW" for NOW Finance).
From the next synthetic set, reserved names are invented lenders, checked against the ASIC credit
registers. Set v2.2 stays as run. Sets v2 (seed 54) and v2.1 (seed 541) stay
published but are withdrawn from experiments: their feeds leak the truth (SIG-54 reviews,
8 November 2026), and their manifests say so.

Local mock of the contract, for Lovable (SIG-11). See `src/mock/`; `Prefer: example=seed_benchmark` or `example=zero_credits` on `GET /v1/app/me` selects a workspace variant.

```bash
npm run mock
```

Local mock of the contract, for Lovable (SIG-11). `Prefer: example=seed_benchmark` or `example=zero_credits` on `GET /v1/app/me` selects a workspace variant.

```bash
npm run mock
```
