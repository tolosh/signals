// SIG-61: what openfeed's flow captures, and what Signals may therefore keep (Colin, 10:50 on
// 9 November 2026: "Keep nothing for research unless de-identification is captured").
//
// Recorded on SIG-61 (comment 40194) from openfeed's published Terms of Service, OpenAPI spec and
// developer docs, read 9 November 2026:
// - Biza is the accredited data recipient; the consumer's CDR arrangement with each data holder is
//   Biza's (collection and use by Biza);
// - the app gets a disclosure consent (an onward disclosure grant) from openfeed's disclosure
//   screen; the data then "ceases to be CDR Data" and is held under the Privacy Act (cl 3.1, 4.2);
// - use is limited to "the specific purpose that the consumer consented to" (cl 4.1);
// - there is no de-identification consent and no research consent.
// So every record gets the purge-after-comparison rule: the person's own assessment and the
// comparison with their declared truths, then purge. If Biza confirms a different arrangement in
// writing, this model changes with a ticket, not here.
import { assertConsumerRef } from "./stores.js";

export const OPENFEED_CONSENT_MODEL = Object.freeze({
  source: "openfeed-production",
  consent_basis: "openfeed-onward-disclosure",
  collection: "biza",
  use_by_data_recipient: "biza",
  disclosure_to_app: true,
  deidentification: false,
  research: false,
  governed_by: "privacy-act",
  recorded_on: "2026-11-09",
  recorded_on_ticket: "SIG-61 comment 40194",
} as const);

/**
 * The longest a team member's data is held, from connection, even if their assessment and truth
 * comparison aren't done. A candidate for Colin's ruling (ADR 0008, section 6).
 */
export const RETENTION_DAYS = 30;

export type ConsentRecord = {
  consumer_ref: string;
  data_source: typeof OPENFEED_CONSENT_MODEL.source;
  consent_basis: typeof OPENFEED_CONSENT_MODEL.consent_basis;
  disclosure_consent: true;
  deidentification_consent: false;
  /** The version of the purpose text the person agreed to (it names the truth comparison). */
  purpose_version: string;
  recorded_on: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PURPOSE_VERSION = /^[0-9]+(?:\.[0-9]+){0,2}$/;

export function consentRecord(o: {
  consumerRef: string;
  recordedOn: string;
  purposeVersion: string;
  noticeVersion: string;
}): ConsentRecord {
  assertConsumerRef(o.consumerRef);
  if ("deidentification" in o)
    throw new Error("openfeed's flow captures no de-identification consent (SIG-61 comment 40194)");
  if (!ISO_DATE.test(o.recordedOn)) throw new Error("recordedOn is an ISO date");
  if (!PURPOSE_VERSION.test(o.purposeVersion))
    throw new Error("purposeVersion is a version number");
  return {
    consumer_ref: o.consumerRef,
    data_source: OPENFEED_CONSENT_MODEL.source,
    consent_basis: OPENFEED_CONSENT_MODEL.consent_basis,
    disclosure_consent: true,
    deidentification_consent: false,
    purpose_version: o.purposeVersion,
    recorded_on: o.recordedOn,
  };
}

export type RetentionRule = "purge_after_comparison";

/** Without a de-identification consent the only rule is: assess, compare, purge. */
export function retentionRule(c: ConsentRecord): RetentionRule {
  if (c.deidentification_consent !== false) throw new Error("Unknown consent shape");
  return "purge_after_comparison";
}

/** The gate research retention must pass. With openfeed's flow it always throws. */
export function assertMayKeepForResearch(c: ConsentRecord): void {
  if ((c.deidentification_consent as boolean) !== true)
    throw new Error(
      "Nothing is kept for research without a de-identification consent, and openfeed's flow " +
        "captures none (SIG-61, 10:50 and comment 40194)",
    );
}

/** The date by which a person's data is purged at the latest: RETENTION_DAYS after connection. */
export function purgeBy(connectedOn: string): string {
  if (!ISO_DATE.test(connectedOn)) throw new Error("connectedOn is an ISO date");
  const ms = Date.parse(`${connectedOn}T00:00:00Z`) + RETENTION_DAYS * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}
