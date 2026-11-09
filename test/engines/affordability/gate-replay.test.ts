// SIG-42 ruling 3 (10 November 2026, 06:39): observed income (1.0.1) and observed expenses (1.1.1)
// keep their versions under GR-3 gate 1.2.0, provided each result carries the gate version and
// replay tests pin both. The hashes were taken at 0e30841 (gate 1.1.0, before C3) with the gate's
// version field taken out, and are the same at gate 1.2.0: over set v1, C3 changes nothing.
import { beforeAll, describe, expect, it } from "vitest";
import { INCOME_METHOD_VERSION } from "../../../src/engines/affordability/income.js";
import { OBSERVED_EXPENSES_METHOD_VERSION } from "../../../src/engines/affordability/observed-expenses.js";
import { SENSITIVE_METHOD_VERSION } from "../../../src/engines/sensitive.js";
import { setV1Replay } from "./set-v1-hash.js";

let replay: ReturnType<typeof setV1Replay>;
beforeAll(() => {
  replay = setV1Replay();
}, 300_000);

describe("set v1 replay at GR-3 gate 1.2.0 (both versions pinned)", () => {
  it("observed income 1.0.1: every result carries gate 1.2.0, output as at gate 1.1.0", () => {
    expect(INCOME_METHOD_VERSION).toBe("1.0.1");
    expect(SENSITIVE_METHOD_VERSION).toBe("1.2.0");
    expect(replay.income.versions).toEqual(["1.2.0"]);
    expect(replay.income.hash).toBe(
      "3b4d074881a59ce15672e5edb65c22e7408d478349b06b20c6080e38c9afc8c4",
    );
  });
  it("observed expenses 1.1.1: every result carries gate 1.2.0, output as at gate 1.1.0", () => {
    expect(OBSERVED_EXPENSES_METHOD_VERSION).toBe("1.1.1");
    expect(replay.expenses.versions).toEqual(["1.2.0"]);
    expect(replay.expenses.hash).toBe(
      "4eb62bd3e32a56b276301e7962fb174fc571ad1128d06baaed87cb827829be0e",
    );
  });
});
