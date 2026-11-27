// SIG-82 contract mapping (D65, SIG-82 40818): assessApplicant's output (composition 1.2.0) to the
// contract's Assessment and AffordabilityTrace (1.11.0), on all 780 applicants of set v2.3.
//
// The roll-up's reasons (40818, 1) are ordered on the server in four tiers: (1) evidence-quality
// reasons with a state; (2) red movers; (3) amber movers; (4) evidence-quality reasons with state
// null. Within a tier the composition's order is kept. top_reasons is the first three; all_reasons
// is the complete list; reasons_total its length. Nothing underneath changes.
//
// Negative control first: on the composition's own order (R1, 40805) the check below does find an
// amber listed while a red is left out (40817: 25 of the 780), so the check can fail.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { assessApplicant, type Assessment } from "../../src/assessment/assess.js";
import {
  liabilityRule,
  monthlyIncomeState,
  rollupOf,
  toAssessment,
  toTrace,
  versionsOf,
} from "../../src/api/mapping.js";
import { buildScenarioInputs, buildSetInputs } from "../../src/api/scenario-inputs.js";
import { OBSERVED_EXPENSES_METHOD_VERSION } from "../../src/engines/affordability/observed-expenses.js";
import { EQ_METHOD_VERSION } from "../../src/engines/evidence/checks.js";
import { schemaValidator } from "./contract.js";

type Reason = { signal_id: string | null; state: string | null; reason: string };
type Run = { id: string; out: Assessment; txIds: string[] };

const prereg = JSON.parse(readFileSync("research/preregistrations/SIG-76.json", "utf8")) as {
  requests: { request: { product_type: string; as_of: string } };
};
const REQUEST = prereg.requests.request;
const REC = { id: "asm_0123456789abcdef", applicant_id: "apl_0123456789abcdef", version: 1 };

/** The composition's own order (R1, 40805): evidence reasons, then movers, INC before LIA. */
function r1(out: Assessment): Reason[] {
  const signals = [...out.inc.signals, ...out.lia.signals];
  return [
    ...out.evidence.rollup.reasons.map((r) => ({ ...r })),
    ...out.rollup.movers.map((m) => ({
      signal_id: m.id,
      state: m.state,
      reason: signals.find((s) => s.id === m.id)!.reason,
    })),
  ] as Reason[];
}
/** D65's tiers, written out again here, independently of the code under test. */
const tier = (r: Reason) =>
  r.signal_id === null ? (r.state === null ? 4 : 1) : r.state === "red" ? 2 : 3;
const tiered = (out: Assessment) =>
  r1(out)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => tier(a.r) - tier(b.r) || a.i - b.i)
    .map((x) => x.r);
/** An amber mover is listed while a red mover is left out. */
const amberOverRed = (top: Reason[], all: Reason[]) =>
  top.some((r) => r.signal_id !== null && r.state === "amber") &&
  all.some((r) => r.signal_id !== null && r.state === "red" && !top.includes(r));

let runs: Run[] = [];
beforeAll(async () => {
  const set = buildSetInputs();
  runs = [];
  for (const input of set)
    runs.push({
      id: input.applicant_id!,
      out: await assessApplicant(input),
      txIds: input.feed.accounts.flatMap((a) =>
        a.transactions.map((t) => (t as { transactionId: string }).transactionId),
      ),
    });
}, 180_000);

describe("the set the mapping is checked on", () => {
  it("is all 780 applicants of set v2.3, each with the pre-registered request", () => {
    expect(runs.length).toBe(780);
    expect(new Set(runs.map((r) => r.id)).size).toBe(780);
  });
});

describe("negative control first: the composition's own order can list an amber over a red", () => {
  it("R1's first three leave a red out for an amber on some v2.3 applicant", () => {
    const hits = runs.filter((x) => {
      const all = r1(x.out);
      return amberOverRed(all.slice(0, 3), all);
    });
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("D65: the roll-up's reasons, in four tiers", () => {
  it("no amber mover is in top_reasons while a red mover is left out (all 780)", () => {
    const bad = runs.filter((x) => {
      const ro = rollupOf(x.out);
      return amberOverRed(ro.top_reasons as Reason[], ro.all_reasons as Reason[]);
    });
    expect(bad.map((x) => x.id)).toEqual([]);
  });

  it("all_reasons holds every evidence reason and every mover exactly once, in tier order, the composition's order kept within a tier", () => {
    for (const x of runs) expect(rollupOf(x.out).all_reasons, x.id).toEqual(tiered(x.out));
  });

  it("reasons_total is the length of all_reasons, and top_reasons its first three", () => {
    for (const x of runs) {
      const ro = rollupOf(x.out);
      expect(ro.reasons_total, x.id).toBe(ro.all_reasons.length);
      expect(ro.top_reasons, x.id).toEqual(ro.all_reasons.slice(0, 3));
      expect(ro.reasons_to_say_yes, x.id).toEqual([]);
    }
  });

  it("a mover's reason is its signal's own reason and state, copied", () => {
    for (const x of runs) {
      const signals = [...x.out.inc.signals, ...x.out.lia.signals];
      for (const r of rollupOf(x.out).all_reasons.filter((r) => r.signal_id !== null)) {
        const s = signals.find((s) => s.id === r.signal_id)!;
        expect([r.state, r.reason]).toEqual([s.state, s.reason]);
      }
    }
  });

  it("the roll-up's state is the composition's, present only when it is unverified", () => {
    for (const x of runs) {
      const ro = rollupOf(x.out);
      if (x.out.rollup.state === undefined) expect("state" in ro, x.id).toBe(false);
      else expect(ro.state, x.id).toBe(x.out.rollup.state);
    }
  });

  it("reports the count in each tier, and how many have more than three in tiers 1 and 2", () => {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<number, number>;
    let over3 = 0;
    let over3In12 = 0;
    for (const x of runs) {
      const all = rollupOf(x.out).all_reasons as Reason[];
      for (const r of all) counts[tier(r)]! += 1;
      if (all.length > 3) over3 += 1;
      if (all.filter((r) => tier(r) <= 2).length > 3) over3In12 += 1;
    }
    console.log(
      JSON.stringify({ tiers: counts, more_than_3: over3, more_than_3_in_tiers_1_2: over3In12 }),
    );
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});

describe("the frozen five are unchanged: none has more than three reasons", () => {
  const five = buildScenarioInputs();
  it.each(["A", "B", "C", "D", "D2"] as const)("scenario %s", async (k) => {
    const out = await assessApplicant(five[k]);
    const ro = rollupOf(out);
    expect(ro.reasons_total).toBeLessThanOrEqual(3);
    // As proposed in 40805 and posted for the Lovable brief: R1's list, uncut.
    expect(ro.top_reasons).toEqual(r1(out));
  });
});

describe("the mapped Assessment and trace (40805, 40817; approved in 40818, 2)", () => {
  const assessment = schemaValidator("Assessment");
  const traceSchema = schemaValidator("AffordabilityTrace");

  it("every one of the 780 is a valid contract Assessment and AffordabilityTrace", () => {
    for (const x of runs) {
      const a = assessment(toAssessment(REC, x.out, REQUEST));
      expect(a.errors, x.id).toBeNull();
      const t = traceSchema(toTrace(x.out));
      expect(t.errors, x.id).toBeNull();
    }
  });

  it("copies the evidence checks, the signals (INC then LIA) and affordability unchanged", () => {
    for (const x of runs.slice(0, 60)) {
      const a = toAssessment(REC, x.out, REQUEST);
      expect(a.evidence_checks).toEqual(x.out.evidence.checks);
      expect(a.signals).toEqual([...x.out.inc.signals, ...x.out.lia.signals]);
      const rest: Record<string, unknown> = { ...a.affordability.serviceability };
      delete rest.monthly_income_state;
      expect(rest).toEqual(x.out.affordability.affordability.serviceability);
      expect(a.affordability.ratios).toEqual(x.out.affordability.affordability.ratios);
      expect(a.status).toBe("complete");
      expect(a.product_type).toBe(REQUEST.product_type);
      expect(a.data_as_of).toBe(`${REQUEST.as_of}T00:00:00Z`);
      expect(a.pins).toEqual({
        definitions_version: 1,
        thresholds_version: x.out.affordability.versions.thresholds_version,
        taxonomy_version: x.out.enrich.taxonomy_version,
      });
      expect(a.versions).toEqual(versionsOf(x.out));
    }
  });

  it("the income's state is unverified exactly when the affordability engine had no income", () => {
    let unverified = 0;
    for (const x of runs) {
      const dsr = x.out.affordability.trace.find((s) => s.step === "dsr")!;
      const none = dsr.value === null && (dsr.inputs as { reason?: string }).reason === "no income";
      expect(monthlyIncomeState(x.out), x.id).toBe(none ? "unverified" : "observed");
      if (none) unverified += 1;
      // The engine's figure is kept as it is: never reshaped to null.
      expect(toAssessment(REC, x.out, REQUEST).affordability.serviceability.monthly_income).toBe(
        x.out.affordability.affordability.serviceability.monthly_income,
      );
    }
    expect(unverified).toBe(56); // 40817, 2
  });

  it("the versions are copied from the output, with the engines' own constants disclosed", () => {
    const v = versionsOf(runs[0]!.out);
    const o = runs[0]!.out;
    expect(v).toMatchObject({
      composition: o.composition_version,
      enrich: { engine_version: o.enrich.engine_version, build: o.enrich.build },
      inc: o.inc.version,
      lia: o.lia.version,
      lia_detector: o.lia.detector,
      gr3_gate: o.expenses.gr3_gate_version,
      keyword_list: o.inc.keyword_list_version,
      lender_names: o.lia.lender_names_version,
      thresholds: o.affordability.versions.thresholds_version,
    });
    // Not in the output: the engines' own constants (disclosed).
    expect(v.eq_method).toBe(EQ_METHOD_VERSION);
    expect(v.observed_expenses).toBe(OBSERVED_EXPENSES_METHOD_VERSION);
  });

  it("no embedded Enrich record, transaction or taxonomy reaches a lender response", () => {
    for (const x of runs) {
      const body = JSON.stringify([toAssessment(REC, x.out, REQUEST), toTrace(x.out)]);
      expect(body).not.toMatch(/"transactions"|"taxonomy"|"categories"|"evidence":\[/);
      for (const id of x.txIds) expect(body.includes(id), `${x.id} ${id}`).toBe(false);
    }
  });

  it("the trace's expense lines are committed, basic and unverified, and sum to the GLE used", () => {
    for (const x of runs) {
      const t = toTrace(x.out);
      expect(t.expense_method).toBe("observed");
      expect(t.expenses.map((e) => e.group)).toEqual(["committed", "basic", "unverified"]);
      expect(t.expenses.map((e) => e.observed)).toEqual([
        x.out.expenses.committed_monthly,
        x.out.expenses.basic_monthly,
        x.out.expenses.unverified_monthly,
      ]);
      for (const e of t.expenses)
        expect([e.declared, e.benchmark, e.used]).toEqual([null, null, e.observed]);
      const gle = x.out.affordability.trace.find((s) => s.step === "gle")!.value as number;
      const sum = t.expenses.reduce((a, e) => a + e.used, 0);
      expect(Math.round(sum * 100) / 100, x.id).toBeCloseTo(gle, 2);
    }
  });

  it("the trace's income, liabilities and steps are the engines' own", () => {
    for (const x of runs) {
      const t = toTrace(x.out);
      expect(t.income).toEqual(x.out.inc.income);
      const rep = x.out.affordability.trace.find((s) => s.step === "repayments")!;
      const commitments = (
        rep.inputs as { commitments: { type: string; source: string; monthly: number }[] }
      ).commitments;
      expect(t.liabilities).toEqual(
        commitments.map((c) => ({
          type: c.type,
          source: c.source,
          monthly_commitment: c.monthly,
          rule: liabilityRule(c.type),
        })),
      );
      expect(t.trace).toEqual(x.out.affordability.trace);
      expect(t.overrides).toEqual([]);
    }
  });

  it("names each liability's rule from Product Specification 6.4, for every type the engine has", () => {
    expect(liabilityRule("credit_card")).toBe("Higher of stated repayment and 3% of limit");
    expect(liabilityRule("charge_card")).toBe("Higher of stated repayment and 3% of limit");
    expect(liabilityRule("overdraft")).toBe("Higher of stated repayment and 3% of limit");
    expect(liabilityRule("personal_loan")).toBe("Higher of observed and stated repayment");
    expect(liabilityRule("car_loan")).toBe("Higher of observed and stated repayment");
    expect(liabilityRule("bnpl")).toBe("3-month average outflow");
    expect(liabilityRule("sacc")).toBe("3-month average outflow");
    expect(liabilityRule("wage_advance")).toBe("3-month average outflow");
    expect(liabilityRule("declared_only")).toBe("Stated repayment");
    expect(liabilityRule("mortgage")).toBe(
      "Repayment at the assessment rate over the remaining term, or the observed repayment",
    );
    expect(() => liabilityRule("timeshare")).toThrow(/no Product Specification 6.4 rule/);
  });

  it("refuses to map an expense method it has no lines for, rather than reshape the GLE", () => {
    const x = structuredClone(runs[0]!.out);
    const gle = x.affordability.trace.find((s) => s.step === "gle")!;
    (gle.inputs as { used: string }).used = "benchmark";
    expect(() => toTrace(x)).toThrow(/expense method/);
  });

  it("has no approve or decline wording", () => {
    for (const x of runs.slice(0, 100))
      expect(JSON.stringify([toAssessment(REC, x.out, REQUEST), toTrace(x.out)])).not.toMatch(
        /approv|declin/i,
      );
  });
});
