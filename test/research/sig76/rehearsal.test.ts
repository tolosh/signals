// SIG-76: an engineering-commissioned, in-process rehearsal of the acceptance's T3 comparison (not
// the acceptance). Each scenario's feed is built in its seeded order, as the hosted sandbox-consent
// path is to send it; assessApplicant runs on it; the output is compared byte for byte with the
// frozen expected states (SIG-76 40801, 19bab324...ece1). A negative check: a shuffled feed must
// fail the comparison (review 21, H10). Written before src/research/sig76/rehearse.ts.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { generateSetV23 } from "../../../src/research/generator/v23/index.js";

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const MODULE = "../../../src/research/sig76/rehearse.js";
const load = async (): Promise<Mod> => {
  try {
    return (await import(/* @vite-ignore */ MODULE)) as Mod;
  } catch {
    return {};
  }
};
const PREREG = JSON.parse(readFileSync("research/preregistrations/SIG-76.json", "utf8")) as Mod;
const FROZEN = JSON.parse(
  readFileSync("research/preregistrations/SIG-76-expected-states.json", "utf8"),
) as Mod;
const KEYS = ["C", "A", "B", "D", "D2"];

let m: Mod;
let set: unknown[];
beforeAll(async () => {
  m = await load();
  set = generateSetV23(623);
}, 300_000);

describe("SIG-76 acceptance rehearsal (in process; engineering-commissioned, not acceptance)", () => {
  it("each scenario's input is its set v2.3 applicant, every account's lines in seeded order", () => {
    expect(typeof m.scenarioInput).toBe("function");
    type R = {
      truth: { applicant_id: string };
      feed: {
        accounts: {
          transactions?: { transactionId: string }[];
          transactionList?: { data: { transactions: { transactionId: string }[] } };
        }[];
      };
    };
    for (const k of KEYS) {
      const id = PREREG.scenarios[k].applicant_id as string;
      const input = m.scenarioInput?.(set, PREREG, k);
      expect(input?.applicant_id, k).toBe(id);
      expect(input?.request, k).toEqual(PREREG.requests.request);
      const raw = (set as R[]).find((a) => a.truth.applicant_id === id) as R;
      const seeded = raw.feed.accounts.map((acc) =>
        (acc.transactions ?? acc.transactionList?.data.transactions ?? []).map(
          (t) => t.transactionId,
        ),
      );
      const given = (input?.feed.accounts as { transactions: { transactionId: string }[] }[]).map(
        (acc) => acc.transactions.map((t) => t.transactionId),
      );
      expect(given, k).toEqual(seeded);
    }
  });
  it("seeded order: every scenario's output matches the frozen output byte for byte", async () => {
    expect(typeof m.rehearse).toBe("function");
    const r = await m.rehearse?.(set, PREREG, FROZEN, { order: "seeded" });
    expect(r?.order_run).toEqual(KEYS);
    for (const k of KEYS) {
      expect(r?.scenarios[k]?.output_sha256, k).toBe(FROZEN.scenarios[k].output_sha256);
      expect(r?.scenarios[k]?.matches, k).toBe(true);
    }
    expect(r?.all_match).toBe(true);
  }, 300_000);
  it("negative check (H10): a shuffled feed fails the comparison", async () => {
    const r = await m.rehearse?.(set, PREREG, FROZEN, { order: "shuffled" });
    expect(r).toBeDefined();
    for (const k of KEYS) expect(r?.scenarios[k]?.matches, k).toBe(false);
    expect(r?.all_match).toBe(false);
  }, 300_000);
});
