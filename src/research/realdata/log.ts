// SIG-61 T2 (10:50: no real text or identifier reaches the repo, CI or run records): the only way
// the real-data and openfeed code writes output. Every line goes through the T2 guard first, so a
// log line (CloudWatch in the secure environment, the console locally and in CI) holds counts,
// rates and vocabulary terms only. A line that fails is dropped, and only the number of rejected
// values is logged. test/repo/realdata-logging.test.ts checks there is no other output.
import { guardRunRecord } from "./guard.js";

const EVENT = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export function realdataLog(
  event: string,
  fields: Record<string, unknown>,
  sink: (line: string) => void = (line) => console.log(line),
): void {
  if (!EVENT.test(event)) {
    sink(JSON.stringify({ event: "log_rejected", violations: 1 }));
    return;
  }
  const line = { event, ...fields };
  const { ok, violations } = guardRunRecord(line, { vocabulary: [event] });
  sink(JSON.stringify(ok ? line : { event: "log_rejected", violations: violations.length }));
}
