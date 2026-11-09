// SIG-60: stub, written with the tests first. Replaced by the diagnostic.
export type BandLimit = {
  feature: string;
  stratified_by: string;
  bands: number;
  overall_auc: number;
  within_bands_auc: number;
};
export type LimitsDiagnostic = {
  set: "v2.2";
  set_sha256: string;
  limits: {
    "T-pay": BandLimit;
    "T-card-repayment": BandLimit;
    "T-repayment": BandLimit & { stump_rule: string; stump_lift: number };
    "T-drift-line-main": {
      feature: string;
      auc: number;
      positives: number;
      applicants_with_positives: number;
    };
  };
};
export function limitsDiagnostic(): LimitsDiagnostic {
  const band = { feature: "", stratified_by: "", bands: 0, overall_auc: 0, within_bands_auc: 0 };
  return {
    set: "v2.2",
    set_sha256: "",
    limits: {
      "T-pay": band,
      "T-card-repayment": band,
      "T-repayment": { ...band, stump_rule: "", stump_lift: 0 },
      "T-drift-line-main": { feature: "", auc: 0, positives: 0, applicants_with_positives: 0 },
    },
  };
}
