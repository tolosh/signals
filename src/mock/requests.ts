// Mock of the "income not found" requests (SIG-48; contract 1.6.0), using the real lifecycle
// module. apl_02 (salary account not shared, so EQ-01 fails on asm_unverified) starts with one
// open request, and portal token tok_01 acts for apl_02. POST /mock-reset/requests (not a contract
// path) restores that starting state, so tests and demos can run again on the hosted mock.
import {
  EvidenceRequests,
  InvalidInput,
  InvalidTransition,
  NotFound,
  type EvidenceRequestView,
  type ReasonCode,
} from "../requests/lifecycle.js";

const WORKSPACE = "wks_01";
const PORTAL_APPLICANT: Record<string, string> = { tok_01: "apl_02" };
type Failure = { mockError: { status: number; code: string; message: string } };

let svc: EvidenceRequests;
export function resetRequests(
  checksFor: (assessmentId: string) => { id: string; result: string }[],
) {
  let n = 0;
  svc = new EvidenceRequests({
    now: () => new Date().toISOString(),
    id: () => `req_${String(++n).padStart(2, "0")}`,
  });
  svc.onAssessment(WORKSPACE, {
    applicant_id: "apl_02",
    assessment_id: "asm_unverified",
    checks: checksFor("asm_unverified"),
  });
}

const guard = (f: () => unknown): unknown => {
  try {
    return f();
  } catch (e) {
    if (e instanceof NotFound) return undefined;
    const fail = (status: number, code: string): Failure => ({
      mockError: { status, code, message: (e as Error).message },
    });
    if (e instanceof InvalidInput) return fail(400, "invalid_parameter");
    if (e instanceof InvalidTransition) return fail(409, "invalid_state");
    throw e;
  }
};
const view = (r: Parameters<EvidenceRequests["toApi"]>[0]) => svc.toApi(r);

export const portalRequests = (token: string) => {
  const applicant = PORTAL_APPLICANT[token];
  if (!applicant) return { items: [] };
  return {
    items: svc
      .list(WORKSPACE, applicant)
      .filter((r) => r.status === "open" || r.status === "connected")
      .map(view),
  };
};
const owned = (token: string, id: string) => {
  const r = svc.get(WORKSPACE, id);
  if (PORTAL_APPLICANT[token] !== r.applicant_id) throw new NotFound(id);
  return r;
};
export const portalConnect = (token: string, id: string, url: unknown) =>
  guard(() => {
    owned(token, id);
    svc.connect(WORKSPACE, id);
    return url;
  });
export const portalExplain = (token: string, id: string, body: unknown) =>
  guard(() => {
    owned(token, id);
    const b = (body ?? {}) as { reason_code?: unknown; note?: unknown };
    return view(
      svc.explain(WORKSPACE, id, {
        reason_code: b.reason_code as ReasonCode,
        note: (b.note as string | null | undefined) ?? null,
      }).request,
    );
  });
export const applicantRequests = (applicantId: string) => ({
  items: svc.list(WORKSPACE, applicantId).map(view),
});
const forApplicant = (applicantId: string, id: string) => {
  const r = svc.get(WORKSPACE, id);
  if (r.applicant_id !== applicantId) throw new NotFound(id);
};
export const resendRequest = (applicantId: string, id: string) =>
  guard(() => {
    forApplicant(applicantId, id);
    return view(svc.resend(WORKSPACE, id));
  });
export const closeRequest = (applicantId: string, id: string) =>
  guard(() => {
    forApplicant(applicantId, id);
    return view(svc.close(WORKSPACE, id));
  });

/** One fixture per status, for SIG-49 (Prefer: example=<status>). */
const AT = "2026-11-07T01:00:00.000Z";
const fixture = (status: EvidenceRequestView["status"]): EvidenceRequestView => ({
  id: `req_${status}`,
  applicant_id: "apl_02",
  assessment_id: "asm_unverified",
  type: "income_not_found",
  status,
  created_at: AT,
  updated_at: AT,
  resent_at: null,
  response:
    status === "explained"
      ? {
          kind: "explain",
          reason_code: "new_job_no_pay_yet",
          note: "Started on 1 November; first pay is on the 15th",
          at: AT,
        }
      : status === "connected" || status === "resolved"
        ? { kind: "connect", reason_code: null, note: null, at: AT }
        : null,
});
export const requestStatusVariants = Object.fromEntries(
  (["open", "connected", "explained", "resolved", "closed"] as const).map((s) => [
    s,
    { items: [fixture(s)] },
  ]),
);
