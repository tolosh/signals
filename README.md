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

Local mock of the contract, for Lovable (SIG-11). See `src/mock/`; `Prefer: example=seed_benchmark` or `example=zero_credits` on `GET /v1/app/me` selects a workspace variant.

```bash
npm run mock
```

Local mock of the contract, for Lovable (SIG-11). `Prefer: example=seed_benchmark` or `example=zero_credits` on `GET /v1/app/me` selects a workspace variant.

```bash
npm run mock
```
