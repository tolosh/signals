// SIG-39 contract changes (Amendment 2 §3 and §7, D20) and T7: every signal in every fixture,
// and every signal the evidence engine emits, carries a valid evidence_quality block.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyEvidence, assessEvidence } from "../../src/engines/evidence/index.js";
import { assessments } from "../../src/mock/fixtures.js";
import { FULL, STUBS, applicant, input } from "../engines/evidence/helpers.js";
import { loadContract, schemaValidator } from "./helpers.js";

const doc = loadContract();
const schema = schemaValidator(doc);
type Prop = { enum?: unknown[]; type?: unknown; items?: { $ref?: string }; $ref?: string };
const props = (name: string) =>
  (doc.components.schemas[name] as { properties: Record<string, Prop> }).properties;
const required = (name: string) =>
  (doc.components.schemas[name] as { required: string[] }).required;

describe("contract-first changes for the evidence-quality layer", () => {
  it("adds none_observed beside evidenced and not_observed", () => {
    const states = (doc.components.schemas.SignalState as { enum: string[] }).enum;
    expect(states).toEqual(
      expect.arrayContaining(["evidenced", "not_observed", "none_observed", "unverified"]),
    );
  });

  it("declares every rollup_class value and requires it on every signal", () => {
    expect((doc.components.schemas.RollupClass as { enum: string[] }).enum).toEqual([
      "knockout",
      "refer",
      "standard",
      "context",
      "review_only",
      "indicative",
      "positive",
    ]);
    expect(props("Signal").rollup_class?.$ref).toBe("#/components/schemas/RollupClass");
    expect(required("Signal")).toContain("rollup_class");
    expect(required("Signal")).toContain("evidence_quality");
  });

  it("puts the EQ checks, each pass, partial or fail, on the assessment and its summary", () => {
    const check = doc.components.schemas.EvidenceCheck as {
      required: string[];
      properties: Record<string, Prop>;
    };
    expect(check.properties.id?.enum).toEqual(["EQ-01", "EQ-02", "EQ-03"]);
    expect(check.properties.result?.enum).toEqual(["pass", "partial", "fail"]);
    expect(check.required).toEqual(
      expect.arrayContaining(["id", "name", "result", "detail", "resolve_with", "review_required"]),
    );
    expect(props("Assessment").evidence_checks?.items?.$ref).toBe(
      "#/components/schemas/EvidenceCheck",
    );
    expect(required("Assessment")).toContain("evidence_checks");
    expect(props("AssessmentSummary").evidence_checks?.type).toEqual(["array", "null"]);
  });

  it("adds institutions with no shared account to completeness (EQ-R1)", () => {
    const eq = doc.components.schemas.EvidenceQuality as {
      properties: { completeness: { properties: Record<string, Prop> } };
    };
    expect(eq.properties.completeness.properties.institutions_without_shared_account).toBeDefined();
  });

  it("is a minor version bump", () => {
    expect(doc.info.version).toBe("1.2.0");
  });
});

describe("T7 every signal carries a valid evidence_quality block", () => {
  const signal = schema("Signal");
  const assessment = schema("Assessment");

  const fixtureSignals = [
    ...(
      JSON.parse(readFileSync("test/fixtures/af-t1-assessment.json", "utf8")) as {
        signals: unknown[];
      }
    ).signals,
    ...Object.values(assessments).flatMap((a) => (a as { signals: unknown[] }).signals),
  ];

  it("every fixture assessment validates", () => {
    for (const [id, a] of Object.entries(assessments)) {
      const r = assessment(a);
      expect(r.errors, id).toBeNull();
    }
  });

  it("100% of fixture signals validate and have the block", () => {
    expect(fixtureSignals.length).toBeGreaterThan(5);
    for (const s of fixtureSignals) {
      expect(s).toHaveProperty("evidence_quality");
      expect(signal(s).errors).toBeNull();
    }
  });

  it("100% of engine signals validate, across coverage, history and feed scenarios", () => {
    const scenarios = [
      FULL,
      { ...FULL, coverage: { salary_account_shared: false } },
      { ...FULL, coverage: { unshared_transfer_accounts: 2 } },
      { ...FULL, history_months: 3 as const },
      { ...FULL, history_months: 1 as const },
      { ...FULL, feed: "uploaded_statement" as const },
    ];
    let n = 0;
    scenarios.forEach((over, i) => {
      const ctx = assessEvidence(input(applicant(over, `sig39-t7-${i}`)));
      for (const s of applyEvidence(STUBS, ctx)) {
        n++;
        expect(signal(s).errors).toBeNull();
      }
      for (const c of ctx.checks) expect(schema("EvidenceCheck")(c).errors).toBeNull();
    });
    expect(n).toBe(scenarios.length * STUBS.length);
  });
});
