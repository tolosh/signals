# ADR 0005: Hosting the mock with shared state

Status: **ruled** (Colin, 7 November 2026, on SIG-51). The mock stays on Lambda with no
concurrency cap, and keeps its state in one on-demand DynamoDB table in the mock stack.

**Problem.** The hosted mock (SIG-11) kept state in memory within a session: policy saves,
overrides, benchmark uploads and evidence requests. When API Gateway spread requests over two warm
Lambda containers, a save in one container wasn't seen by a read in the other. Lovable saw this as
an intermittent failure.

**What was tried.** The first ruled fix was reserved concurrency 1 on the mock Lambda (Colin,
7 November, on SIG-11). It was deployed and measured against the hosted mock on 7 November:

| Requests to `GET /v1/app/assessments/asm_01` | Result           |
| -------------------------------------------- | ---------------- |
| 60 one after another                         | 60 × 200         |
| 2 at once                                    | 2 × 200          |
| 4 at once                                    | 2 × 200, 2 × 503 |
| 8 at once                                    | 2 × 200, 6 × 503 |

A Lambda container serves one request at a time, so the cap throttled every concurrent request
beyond the burst allowance, with HTTP 503. The cap was withdrawn, and 8 at once then gave 8 × 200.

**Options put for ruling:** (1) no cap, accepting stale reads; (2) the Node server on one
always-on container; (3) shared state in a store such as DynamoDB. **Ruled: option 3.**

## The ruling, as built

- **One table** (`MockState`, on demand), in the mock stack only. The partition key `pk` is the
  scenario; the sort key `sk` is `<resource type>#<id>`. Written items carry `expires_at`, a 7-day
  TTL, so the table can't grow without bound. A value too long for one item is split into parts
  (`<type>#<id>#part#0000` and on).
- **Every request** reads its scenario's items with a strongly consistent query, resets the mock
  to its seeded fixtures, applies the items, runs the ordinary handler, and writes back only what
  changed. So no container serves stale state, and reads write nothing. If two requests write the
  same item at the same moment, the later one wins, which is acceptable for a mock.
- **Scenarios.** The `X-Mock-Scenario` header picks the scenario (`default` when absent; 1 to 40
  characters of `a-z`, `0-9` and `-`). Test suites run in their own scenario, so a test run never
  touches Lovable's state.
- **Reset routes** (mock-only, outside the contract): `POST /mock-reset` clears the scenario back
  to the seeded fixtures; `POST /mock-reset/requests` clears its evidence requests only.
- **State slices** (`src/mock/state.ts`): evidence requests; assessment versions from overrides,
  with their engine inputs; policy versions; uploaded benchmarks; logo uploads; the auto top-up and
  logo settings; each applicant's latest assessment; and each portal token's step and financial
  position.
- **Mock only.** Real persistence is Aurora with row-level security (WP2). Nothing in
  `src/engines` or the production API may use the table. A test checks that nothing outside
  `src/mock` imports the DynamoDB client or the mock's persistence.
- **Local server.** `npm run mock` runs the same path with an in-memory table, one request at a
  time.
