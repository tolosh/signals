// SIG-48 contract (contract 1.6.0): the "income not found" request (D24).
import { describe, expect, it } from "vitest";
import { loadContract } from "./helpers.js";

const doc = loadContract();
type S = {
  required?: string[];
  properties?: Record<string, S>;
  enum?: unknown[];
  $ref?: string;
  maxLength?: number;
  type?: unknown;
  oneOf?: S[];
};
const schemas = doc.components.schemas as Record<string, S>;

describe("evidence-request contract", () => {
  it.each([
    ["get", "/v1/portal/{token}/requests"],
    ["post", "/v1/portal/{token}/requests/{requestId}/connect"],
    ["post", "/v1/portal/{token}/requests/{requestId}/explain"],
    ["get", "/v1/app/applicants/{id}/requests"],
    ["post", "/v1/app/applicants/{id}/requests/{requestId}/resend"],
    ["post", "/v1/app/applicants/{id}/requests/{requestId}/close"],
  ])("%s %s exists", (method, path) => {
    expect(doc.paths[path]?.[method]).toBeDefined();
  });

  it("EvidenceRequest carries the type, the five statuses and the applicant's response", () => {
    const r = schemas.EvidenceRequest;
    expect(r?.required).toEqual([
      "id",
      "applicant_id",
      "assessment_id",
      "type",
      "status",
      "created_at",
      "updated_at",
      "resent_at",
      "response",
    ]);
    expect(r?.properties?.type?.enum).toEqual(["income_not_found"]);
    expect(r?.properties?.status?.enum).toEqual([
      "open",
      "connected",
      "explained",
      "resolved",
      "closed",
    ]);
  });

  it("an explanation is a reason code and an optional note of at most 500 characters", () => {
    expect(schemas.ExplainInput?.required).toEqual(["reason_code"]);
    expect(schemas.IncomeReasonCode?.enum).toEqual([
      "paid_in_cash",
      "new_job_no_pay_yet",
      "paid_to_another_account",
      "self_employed_irregular",
      "on_leave",
      "other",
    ]);
    expect(schemas.ExplainInput?.properties?.note?.maxLength).toBe(500);
  });

  it("an assessment can say a person must review it, without changing any state", () => {
    expect(schemas.Assessment?.properties?.review?.$ref).toBe(
      "#/components/schemas/AssessmentReview",
    );
    expect(schemas.Assessment?.required).not.toContain("review");
    expect(schemas.AssessmentReview?.required).toEqual(["required", "reasons"]);
  });

  it("no request wording suggests approval (GR-1)", () => {
    const text = JSON.stringify([
      schemas.EvidenceRequest,
      schemas.ExplainInput,
      schemas.AssessmentReview,
    ]);
    expect(text).not.toMatch(/approv|declin/i);
  });

  it("is a minor version bump to 1.6.0 (kept by later minor versions)", () => {
    expect(doc.info.version).toMatch(/^1\.([6-9]|\d{2,})\./);
  });
});
