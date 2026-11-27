// SIG-76: the 1 December demo's scenarios (A to C; D added by ruling 40776, 1), chosen from
// synthetic set v2.3 by ground truth only (ruling 40720). No engine runs here, so the choice can't depend on any engine's output.
// Each rule takes the lowest applicant id that meets it, so the choice is a pure function of the
// set. The expected states are computed later, with the pinned Enrich build (ruling 40719).

type Truth = {
  applicant_id: string;
  tags: string[];
  feed_type: string;
  history: { months: number };
  surplus_monthly: number;
  coverage: { salary_account_shared: boolean; unshared_transfer_accounts: number };
  liabilities: { items: { id: string; type: string; declared: boolean }[] };
  v2: {
    liabilities: {
      id: string;
      declared_as: string | null;
      repayment_channel: string;
      lender: string;
      paid_from_shared: boolean;
    }[];
  };
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
  D: "a detected undisclosed liability (ruling 40776, 1): tag salaried and none of the drift or gambling tags; at least one undisclosed BNPL, SACC, wage advance or credit card, repaid by direct debit or card (repayment_channel DIRECT_DEBIT or PAYMENT; not BPAY) from a shared account; not scenario A, B or C",
} as const;

/** Scenario D's liability types (ruling 40776, 1). */
const D_KINDS = ["bnpl", "sacc", "wage_advance", "credit_card"];

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
  const chosen = [a, b, c].map((xs) => lowest(xs)?.applicant_id);
  const undisclosedDetectable = (t: Truth) =>
    t.liabilities.items.some((l) => {
      const v = t.v2.liabilities.find((x) => x.id === l.id);
      return (
        D_KINDS.includes(l.type) &&
        !l.declared &&
        v !== undefined &&
        v.declared_as === null &&
        (v.repayment_channel === "DIRECT_DEBIT" || v.repayment_channel === "PAYMENT") &&
        v.paid_from_shared
      );
    });
  const d = truths.filter(
    (t) =>
      t.tags.includes("salaried") &&
      !t.tags.some((x) => NOT_B.includes(x)) &&
      undisclosedDetectable(t) &&
      !chosen.includes(t.applicant_id),
  );
  const pick = (k: "A" | "B" | "C" | "D", xs: Truth[]) => {
    const t = lowest(xs);
    if (!t) throw new Error(`no applicant in set v2.3 meets scenario ${k}'s rule`);
    return { applicant_id: t.applicant_id, rule: RULES[k], candidates: xs.length };
  };
  return {
    thresholds: { surplus_median: median, surplus_lower_quartile: lowerQuartile },
    A: pick("A", a),
    B: pick("B", b),
    C: pick("C", c),
    D: pick("D", d),
  };
}
