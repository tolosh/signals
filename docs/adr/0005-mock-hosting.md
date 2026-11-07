# ADR 0005: Hosting the mock with shared state

Status: proposed. The ruled one-container cap was deployed and measured, then withdrawn
(7 November 2026, SIG-51). A ruling is needed.

**Problem.** The hosted mock (SIG-11) keeps state in memory within a session: policy saves,
overrides, benchmark uploads and evidence requests. When API Gateway spreads requests over two warm
Lambda containers, a save in one container isn't seen by a read in the other. Lovable saw this as
an intermittent failure.

**What was tried.** The ruled fix was reserved concurrency 1 on the mock Lambda (Colin, 7 November,
on SIG-11). It was deployed and measured against the hosted mock on 7 November:

| Requests to `GET /v1/app/assessments/asm_01` | Result           |
| -------------------------------------------- | ---------------- |
| 60 one after another                         | 60 × 200         |
| 2 at once                                    | 2 × 200          |
| 4 at once                                    | 2 × 200, 2 × 503 |
| 8 at once                                    | 2 × 200, 6 × 503 |

A Lambda container serves one request at a time, so the cap throttles every concurrent request
beyond the burst allowance, with HTTP 503. The hosted smoke suite failed one test with a 503. A
front end that loads several endpoints at once would fail pages, which is worse than the
occasional stale read the cap was meant to fix. The mock was redeployed from `main` without the
cap, and 8 at once then gave 8 × 200.

**Options, for ruling:**

1. **No cap** (the current state). Accept the occasional cross-container stale read. The mock-only
   reset routes still restore the starting state.
2. **One always-on container that serves concurrent requests**: the existing Node server
   (`src/mock/server.ts`) on App Runner or one Fargate task. The code is unchanged, and state is
   shared because Node handles concurrent requests in one process. This adds a new AWS resource
   type and a small standing cost.
3. **Shared state in a store** (for example a DynamoDB table). This keeps Lambda, but every
   stateful mock module would need rewriting. It adds a stateful resource, which the stack test
   currently forbids.

Recommendation: option 2. It fixes the stale reads without changing the mock's code. It needs
Colin's OK, because it creates a new AWS resource type.
