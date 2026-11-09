// SIG-61 (Colin, 10:50 on 9 November 2026): "Keep nothing for research unless de-identification is
// captured." openfeed's flow captures a disclosure consent to the app and no de-identification
// consent (SIG-61 comment 40194, from openfeed's published terms and docs). So every team member's
// data is kept only for their own assessment and the comparison with their declared truths, then
// purged.
import { describe, expect, it } from "vitest";
import {
  assertMayKeepForResearch,
  consentRecord,
  OPENFEED_CONSENT_MODEL,
  purgeBy,
  RETENTION_DAYS,
  retentionRule,
} from "../../../src/research/realdata/consent.js";
import { guardRunRecord } from "../../../src/research/realdata/guard.js";

const REF = "cr_0000000000000000aaaa";

describe("the consents openfeed's flow captures", () => {
  it("records a disclosure consent and no de-identification or research consent", () => {
    expect(OPENFEED_CONSENT_MODEL.disclosure_to_app).toBe(true);
    expect(OPENFEED_CONSENT_MODEL.deidentification).toBe(false);
    expect(OPENFEED_CONSENT_MODEL.research).toBe(false);
    expect(OPENFEED_CONSENT_MODEL.governed_by).toBe("privacy-act");
    expect(OPENFEED_CONSENT_MODEL.recorded_on_ticket).toBe("SIG-61 comment 40194");
  });

  it("gives every openfeed consent record the purge-after-comparison rule", () => {
    const c = consentRecord({ consumerRef: REF, recordedOn: "2026-11-10", purposeVersion: "1" });
    expect(c.deidentification_consent).toBe(false);
    expect(retentionRule(c)).toBe("purge_after_comparison");
  });

  it("refuses research retention without a de-identification consent", () => {
    const c = consentRecord({ consumerRef: REF, recordedOn: "2026-11-10", purposeVersion: "1" });
    expect(() => assertMayKeepForResearch(c)).toThrow(/de-identification consent/);
  });

  it("can't be talked into a de-identification consent openfeed doesn't capture", () => {
    expect(() =>
      consentRecord({
        consumerRef: REF,
        recordedOn: "2026-11-10",
        purposeVersion: "1",
        deidentification: true,
      } as never),
    ).toThrow(/openfeed's flow captures no de-identification consent/);
  });

  it("sets a purge date RETENTION_DAYS after connection, at most", () => {
    expect(RETENTION_DAYS).toBe(30);
    expect(purgeBy("2026-11-10")).toBe("2026-12-10");
  });

  it("is a record the T2 guard accepts once the reference is left out", () => {
    const rest: Record<string, unknown> = {
      ...consentRecord({ consumerRef: REF, recordedOn: "2026-11-10", purposeVersion: "1" }),
    };
    delete rest.consumer_ref;
    expect(guardRunRecord(rest).violations).toEqual([]);
  });
});
