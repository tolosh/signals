// SIG-56: which mock the mock test files call. `npm test` always uses an in-process server;
// only `npm run test:hosted` (vitest --mode hosted, which sets MOCK_TARGET) uses MOCK_BASE_URL.
// A MOCK_BASE_URL left in the environment therefore never sends `npm test` to the hosted mock.
export function hostedBase(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.MOCK_TARGET !== "hosted") return undefined;
  if (!env.MOCK_BASE_URL)
    throw new Error("npm run test:hosted needs MOCK_BASE_URL (the hosted mock's URL)");
  return env.MOCK_BASE_URL;
}
