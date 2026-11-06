// Shared set-up for the SIG-39 evidence-quality tests: scripted applicants from the SIG-12
// generator, and stub signal evaluators standing in for the family tickets (SIG-40 to SIG-45).
import {
  AS_OF_DATE,
  generateApplicant,
  scenario,
  type GeneratedApplicant,
  type SpecOverrides,
} from "../../../src/research/generator/index.js";
import type { EvidenceInput, Feed, RawSignal } from "../../../src/engines/evidence/index.js";

export const SEED = 42;

export function applicant(overrides: SpecOverrides, id: string): GeneratedApplicant {
  return generateApplicant(scenario(overrides, id, ["sig-39"]), SEED);
}

export function input(a: GeneratedApplicant, lookback_months = 6): EvidenceInput {
  return {
    feed: a.feed as unknown as Feed,
    feed_type: a.truth.feed_type,
    as_of: AS_OF_DATE,
    lookback_months,
  };
}

/** Keeps only the transactions on or after the given date, as if the sync returned less. */
export function truncate(a: GeneratedApplicant, from: string): GeneratedApplicant {
  const feed = a.feed as unknown as Feed;
  return {
    ...a,
    feed: {
      ...a.feed,
      accounts: feed.accounts.map((acc) => ({
        ...acc,
        transactions: acc.transactions.filter((t) => (t.postingDateTime ?? "") >= from),
      })),
    } as unknown as GeneratedApplicant["feed"],
  };
}

/** The base salaried profile: salary shared, no unshared transfers, 6 months of CDR data. */
export const FULL: SpecOverrides = {
  history_months: 6,
  feed: "cdr",
  coverage: { salary_account_shared: true, unshared_transfer_accounts: 0 },
  liabilities: [],
};

const raw = (over: Partial<RawSignal> & Pick<RawSignal, "id">): RawSignal => ({
  state: "green",
  value: null,
  reason: "Stub evaluator",
  confidence: "high",
  nothing_found: false,
  evidence: { account_ids: [], transaction_count: 0 },
  enrich_confident_pct: 100,
  unrecognised_adverse: 0,
  ...over,
});

/** Income regularity found 13 pays: a presence signal. */
export const INC_01 = raw({
  id: "INC-01",
  value: "13 fortnightly pays",
  reason: "Salary from the same employer every fortnight",
  evidence: { account_ids: ["x-evd"], transaction_count: 13 },
});
/** Undisclosed liabilities found nothing: an absence signal (EQ-R2). */
export const LIA_01_NONE = raw({
  id: "LIA-01",
  value: "0 accounts",
  reason: "No loan or card account outside the application was found",
  nothing_found: true,
});
/** Seasonality needs 12 months (EQ-R4, D13). */
export const INC_09 = raw({
  id: "INC-09",
  value: "No trough months",
  reason: "Each month is within 60% of the annual average",
});
/** Payday lending on a statement feed with a debit line no rule recognised (EQ-R5). */
export const LIA_03_UNRECOGNISED = raw({
  id: "LIA-03",
  value: "0 repayments",
  reason: "No SACC repayments were found",
  nothing_found: true,
  unrecognised_adverse: 2,
});
/** Rent reliability: a positive signal that is evidenced. */
export const POS_01 = raw({
  id: "POS-01",
  state: "evidenced",
  value: "6 rent payments",
  reason: "Rent paid on time to the same payee for 6 months",
});

export const STUBS: RawSignal[] = [INC_01, LIA_01_NONE, INC_09, POS_01];
