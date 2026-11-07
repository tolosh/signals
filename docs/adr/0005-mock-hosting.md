# ADR 0005: Hosting the mock in one container

Status: ruled (Colin, 7 November 2026, on SIG-11; carried out on SIG-51)

The hosted mock (SIG-11) keeps state in memory within a session (policy saves, overrides,
benchmark uploads and evidence requests). When API Gateway spread requests over two warm Lambda
containers, a save in one container wasn't seen by a read in the other. Lovable saw this as an
intermittent failure.

**Decision.** The mock Lambda has reserved concurrency 1, so every request is served by the same
container and its state. This is the mock only: no other stack reserves concurrency, and a CDK
assertion test (`test/mock/stack.test.ts`) checks both. State is still lost when the container is
recycled. The mock-only reset routes restore the starting state, and the mock never holds real
data.

**Trade-off.** Concurrent requests beyond one are throttled (HTTP 429) rather than served by a
second container. That is acceptable for a development mock with one front-end team. It isn't a
pattern for the real API, which keeps state in the database (D1).
