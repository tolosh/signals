// SIG-51: the hosted mock's state is durable now, so each mock test file runs in its own scenario
// (the X-Mock-Scenario header). Lovable's default scenario is never touched by a test run, and
// written items expire after 7 days. Import this first in any file that calls the mock.
const SCENARIO = `suite-${process.pid}-${Date.now()}`;
const original = globalThis.fetch;
globalThis.fetch = (input: string | URL | Request, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has("x-mock-scenario")) headers.set("x-mock-scenario", SCENARIO);
  return original(input, { ...init, headers });
};
export {};
