// SIG-61 stub (tests first).
export const OPENFEED_CONSENT_MODEL = {
  disclosure_to_app: false,
  deidentification: true,
  research: true,
  governed_by: "",
  recorded_on_ticket: "",
};
export const RETENTION_DAYS = 0;
export type ConsentRecord = { consumer_ref: string; deidentification_consent: boolean };
export function consentRecord(o: {
  consumerRef: string;
  recordedOn: string;
  purposeVersion: string;
}): ConsentRecord {
  return { consumer_ref: o.consumerRef, deidentification_consent: true };
}
export const retentionRule = (_c: ConsentRecord): string => "";
export function assertMayKeepForResearch(_c: ConsentRecord): void {}
export const purgeBy = (_d: string): string => "";
