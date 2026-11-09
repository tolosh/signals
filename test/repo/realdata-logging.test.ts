// SIG-61 T2 (10:50: "no real text or identifier reaches the repo, CI or run records"): the code that
// touches real data logs only through realdataLog, which puts every line through the T2 guard, so
// a log line (and so CloudWatch, and any CI output from these modules) holds counts, rates and
// vocabulary terms only. The static scan checks no other console or process output exists in the
// real-data and openfeed code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { realdataLog } from "../../src/research/realdata/log.js";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const SCOPE = ["src/research/realdata", "src/connectors/openfeed", "infra/realdata-lambda.ts"];
const scoped = () => SCOPE.flatMap((p) => (p.endsWith(".ts") ? [p] : files(p)));

describe("real-data logging", () => {
  it("writes a guarded line", () => {
    const lines: string[] = [];
    realdataLog("revocation_poll", { detected: 1, purged: 1, status: "complete" }, (l) =>
      lines.push(l),
    );
    expect(JSON.parse(lines[0]!)).toEqual({
      event: "revocation_poll",
      detected: 1,
      purged: 1,
      status: "complete",
    });
  });

  it("drops a line carrying real text and logs only that it was rejected", () => {
    const lines: string[] = [];
    realdataLog(
      "ingest",
      { note: "EFTPOS WOOLWORTHS 1234 SYDNEY", account: "062-000 12345678" },
      (l) => lines.push(l),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("WOOLWORTHS");
    expect(lines[0]).not.toContain("12345678");
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "log_rejected", violations: 2 });
  });

  it("refuses an event name outside the vocabulary of identifiers", () => {
    const lines: string[] = [];
    realdataLog("Hello Jane", {}, (l) => lines.push(l));
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "log_rejected" });
  });

  it("is the only output in the real-data and openfeed code", () => {
    const offenders = scoped().filter((f) => {
      if (f.replace(/\\/g, "/").endsWith("src/research/realdata/log.ts")) return false;
      const text = readFileSync(f, "utf8");
      return /\bconsole\.|process\.(stdout|stderr)\.write/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("scans real files (negative control: the scope isn't empty)", () => {
    expect(scoped().length).toBeGreaterThanOrEqual(8);
  });
});
