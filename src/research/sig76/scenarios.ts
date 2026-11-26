// SIG-76: the 1 December demo's three scenarios, chosen from synthetic set v2.3 by ground truth
// only (ruling 40720). No engine runs here, so the choice can't depend on any engine's output.
// Each rule takes the lowest applicant id that meets it, so the choice is a pure function of the
// set. The expected states are computed later, with the pinned Enrich build (ruling 40719).

type Truth = {
  applicant_id: string;
  tags: string[];
  feed_type: string;
  history: { months: number };
  surplus_monthly: number;
  coverage: { salary_account_shared: boolean; unshared_transfer_accounts: number };
  liabilities: { items: { type: string; declared: boolean }[] };
  v2: { liabilities: { declared_as: string | null; repayment_channel: string; lender: string }[] };
};
type Applicant = { truth: Truth };

/** Tags that put an applicant outside scenario A's "regular salary, affordable". */
const NOT_A = [
  "coverage-gap",
  "gambling",
  "sacc",
  "wage-advance",
  "bnpl",
  "history-1-month",
  "statement-feed",
  "variable-income",
  "gig",
  "new-employer",
  "salaried-payer-drift",
  "repaid-from-unshared",
];

/** Tags that would blur scenario B's story (pay drift, and gambling, which INC flags). */
const NOT_B = ["salaried-payer-drift", "drift-over-time", "drift-across-banks", "gambling"];

/** The rules, in words, as the pre-registration records them. */
export const RULES = {
  A: "regular salary, affordable: a CDR feed of 6 months or more; tags salaried-fixed and dishonour-clean and none of the risk tags; the salary account shared; every liability declared; no liability repaid by BPAY; truth surplus at or above the set's median",
  B: "a hidden credit liability and affordability pressure: a CDR feed of 6 months or more; tag salaried and none of the drift or gambling tags; the salary account shared; an undisclosed personal or car loan; no liability repaid by BPAY; truth surplus at or below the set's lower quartile",
  C: "missing income or insufficient evidence: a CDR feed of 3 months or more, tag salaried, no liability repaid by BPAY, whose salary account is not shared (EQ-01 then fails, and the assessment is unverified)",
} as const;

/**
 * Why no scenario has a liability repaid by BPAY: Enrich 1.7.0 returns BPAY bill payments as
 * transfers (ENR-28), and the demo's expected states wait for the fixed build (ruling 40719). With
 * no BPAY repayment, no scenario's liabilities depend on that fix, whichever build is pinned.
 */
export const BPAY_NOTE =
  "No scenario has a liability repaid by BPAY, so no scenario's liabilities depend on the ENR-28 fix (BPAY bill payments returned as transfers by Enrich 1.7.0). BPAY bill payments for utilities and the like may still appear, and are affected by ENR-28 until the fixed build is pinned.";

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length * q)] ?? 0;
};
const lowest = (xs: Truth[]) =>
  [...xs].sort((a, b) => (a.applicant_id < b.applicant_id ? -1 : 1))[0];

export function selectScenarios(set: readonly unknown[]) {
  const truths = (set as Applicant[]).map((a) => a.truth);
  const median = quantile(
    truths.map((t) => t.surplus_monthly),
    0.5,
  );
  const lowerQuartile = quantile(
    truths.map((t) => t.surplus_monthly),
    0.25,
  );
  const cdr = (t: Truth, months: number) => t.feed_type === "cdr" && t.history.months >= months;
  const noBpay = (t: Truth) => t.v2.liabilities.every((l) => l.repayment_channel !== "BPAY");
  const a = truths.filter(
    (t) =>
      cdr(t, 6) &&
      t.tags.includes("salaried-fixed") &&
      t.tags.includes("dishonour-clean") &&
      !t.tags.some((x) => NOT_A.includes(x)) &&
      t.coverage.salary_account_shared &&
      t.liabilities.items.every((l) => l.declared) &&
      noBpay(t) &&
      t.surplus_monthly >= median,
  );
  const hiddenLoan = (t: Truth) =>
    t.liabilities.items.some(
      (l) => !l.declared && (l.type === "personal_loan" || l.type === "car_loan"),
    );
  const b = truths.filter(
    (t) =>
      cdr(t, 6) &&
      t.tags.includes("salaried") &&
      !t.tags.some((x) => NOT_B.includes(x)) &&
      t.coverage.salary_account_shared &&
      hiddenLoan(t) &&
      noBpay(t) &&
      t.surplus_monthly <= lowerQuartile,
  );
  const c = truths.filter(
    (t) =>
      cdr(t, 3) && t.tags.includes("salaried") && noBpay(t) && !t.coverage.salary_account_shared,
  );
  const pick = (k: "A" | "B" | "C", xs: Truth[]) => {
    const t = lowest(xs);
    if (!t) throw new Error(`no applicant in set v2.3 meets scenario ${k}'s rule`);
    return { applicant_id: t.applicant_id, rule: RULES[k], candidates: xs.length };
  };
  return {
    thresholds: { surplus_median: median, surplus_lower_quartile: lowerQuartile },
    A: pick("A", a),
    B: pick("B", b),
    C: pick("C", c),
  };
}
