// SIG-76: an in-process rehearsal of the acceptance's T3 comparison. It is engineering-
// commissioned and is not the acceptance, which the architect runs against the hosted stage.
//   - scenarioInput builds one scenario's AssessmentInput as the hosted sandbox-consent path is to
//     build it: the set v2.3 applicant's own application and accounts, every account's lines in
//     their seeded order, and the pre-registered request.
//   - rehearse runs assessApplicant on each scenario, C first, and compares the output's SHA-256
//     with the frozen expected states (SIG-76 40801). With order "shuffled", every account's lines
//     are reversed first: the negative check that feed order matters to the byte-for-byte
//     comparison (review 21, H10).
// No engine changes here; this only calls the composition and hashes what it returns.
import { createHash } from "node:crypto";
import { assessApplicant, type AssessmentInput } from "../../assessment/assess.js";

type Tx = AssessmentInput["feed"]["accounts"][number]["transactions"][number];
type Raw = {
  truth: { applicant_id: string; feed_type: AssessmentInput["feed_type"] };
  application: AssessmentInput["application"];
  feed: {
    accounts: {
      account: unknown;
      detail?: unknown;
      transactions?: Tx[];
      transactionList?: { data: { transactions: Tx[] } };
    }[];
  };
};
type Prereg = {
  scenarios: Record<string, { applicant_id: string }>;
  requests: { request: AssessmentInput["request"] };
};
type Frozen = { scenarios: Record<string, { output_sha256: string }> };

/** The run order the pre-registration fixes: the negative control, C, first. */
export const REHEARSAL_ORDER = ["C", "A", "B", "D", "D2"] as const;

/** One scenario's input, every account's lines in their seeded order. */
export function scenarioInput(set: readonly unknown[], prereg: Prereg, k: string): AssessmentInput {
  const id = prereg.scenarios[k]?.applicant_id;
  const a = (set as Raw[]).find((x) => x.truth.applicant_id === id);
  if (!id || !a) throw new Error(`no applicant for scenario ${k} in set v2.3`);
  return {
    applicant_id: id,
    feed_type: a.truth.feed_type,
    application: a.application,
    feed: {
      accounts: a.feed.accounts.map((acc) => ({
        account: acc.account as never,
        ...(acc.detail ? { detail: acc.detail as never } : {}),
        transactions: acc.transactions ?? acc.transactionList?.data.transactions ?? [],
      })),
    },
    request: prereg.requests.request,
  };
}

const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");

/** Runs every scenario and compares each output with the frozen output, byte for byte. */
export async function rehearse(
  set: readonly unknown[],
  prereg: Prereg,
  frozen: Frozen,
  opts: { order: "seeded" | "shuffled" },
) {
  const scenarios: Record<
    string,
    { applicant_id: string; output_sha256: string; expected_sha256: string; matches: boolean }
  > = {};
  for (const k of REHEARSAL_ORDER) {
    const input = scenarioInput(set, prereg, k);
    if (opts.order === "shuffled")
      input.feed.accounts = input.feed.accounts.map((acc) => ({
        ...acc,
        transactions: [...acc.transactions].reverse(),
      }));
    const out = await assessApplicant(input);
    const expected = frozen.scenarios[k]?.output_sha256 ?? "";
    const got = sha(out);
    scenarios[k] = {
      applicant_id: input.applicant_id as string,
      output_sha256: got,
      expected_sha256: expected,
      matches: got === expected,
    };
  }
  return {
    order: opts.order,
    order_run: [...REHEARSAL_ORDER],
    scenarios,
    all_match: Object.values(scenarios).every((s) => s.matches),
  };
}
