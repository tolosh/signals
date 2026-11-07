// "Income not found" requests (SIG-48; Decision Record D24). When EQ-01 fails, the applicant is
// asked to connect the account their pay goes into, or explain why it is missing. A person reviews
// an explanation; it never changes a ratio, a signal state or the roll-up, and nothing here is
// an input to any engine. This is the slice ruled on 7 November 2026: the lifecycle with an
// in-memory store scoped by workspace. Persistence with RLS, encryption at rest, the re-sync and
// SES notifications land with WP2, WP4 and WP5.

export const REASON_CODES = [
  "paid_in_cash",
  "new_job_no_pay_yet",
  "paid_to_another_account",
  "self_employed_irregular",
  "on_leave",
  "other",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
export type RequestStatus = "open" | "connected" | "explained" | "resolved" | "closed";
export const NOTE_MAX_CHARS = 500;
const ACTIVE: RequestStatus[] = ["open", "connected", "explained"];

/**
 * The applicant's free-text note. It is held in a private field, so it never appears in logs,
 * JSON or object inspection; only an explicit reveal (the API view) returns it.
 */
export class SensitiveNote {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  reveal(): string {
    return this.#value;
  }
  toJSON(): string {
    return "[redacted]";
  }
  toString(): string {
    return "[redacted]";
  }
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "[redacted]";
  }
}

export type EvidenceRequest = {
  id: string;
  workspace_id: string;
  applicant_id: string;
  assessment_id: string;
  type: "income_not_found";
  status: RequestStatus;
  created_at: string;
  updated_at: string;
  resent_at: string | null;
  response: {
    kind: "connect" | "explain";
    reason_code: ReasonCode | null;
    note: SensitiveNote | null;
    at: string;
  } | null;
};
/** The request as the contract (EvidenceRequest, 1.6.0) returns it, note revealed. */
export type EvidenceRequestView = Omit<EvidenceRequest, "workspace_id" | "response"> & {
  response: {
    kind: "connect" | "explain";
    reason_code: ReasonCode | null;
    note: string | null;
    at: string;
  } | null;
};

export class NotFound extends Error {}
export class InvalidTransition extends Error {}
export class InvalidInput extends Error {}

type Check = { id: string; result: string };
const LABEL: Record<ReasonCode, string> = {
  paid_in_cash: "paid in cash",
  new_job_no_pay_yet: "new job, no pay yet",
  paid_to_another_account: "paid to another account",
  self_employed_irregular: "self-employed, irregular income",
  on_leave: "on leave",
  other: "another reason",
};

/** The review an explanation needs (D24): a person reviews it; it changes no figure or state. */
export function explanationReview(reason: ReasonCode): { required: true; reasons: string[] } {
  return {
    required: true,
    reasons: [
      `The applicant explained why their income is missing: ${LABEL[reason]}. A person must review it.`,
    ],
  };
}

export class EvidenceRequests {
  readonly #byId = new Map<string, EvidenceRequest>();
  readonly #now: () => string;
  readonly #id: () => string;

  constructor(deps: { now: () => string; id: () => string }) {
    this.#now = deps.now;
    this.#id = deps.id;
  }

  /** Workspace-scoped read: another workspace's request is NotFound, never revealed. */
  get(workspace: string, id: string): EvidenceRequest {
    const r = this.#byId.get(id);
    if (!r || r.workspace_id !== workspace) throw new NotFound(`No request ${id}`);
    return r;
  }

  /** Every request, for a store that keeps them between processes (the mock's table, SIG-51). */
  all(): readonly EvidenceRequest[] {
    return [...this.#byId.values()];
  }

  /** Puts back a request exactly as a store kept it. */
  load(r: EvidenceRequest): void {
    this.#byId.set(r.id, r);
  }

  list(workspace: string, applicantId: string): EvidenceRequest[] {
    return [...this.#byId.values()].filter(
      (r) => r.workspace_id === workspace && r.applicant_id === applicantId,
    );
  }

  /**
   * Called after every assessment version. EQ-01 fail opens an income_not_found request unless one
   * is already active for the applicant (one at a time; idempotent per assessment). EQ-01 pass
   * resolves any active request.
   */
  onAssessment(
    workspace: string,
    a: { applicant_id: string; assessment_id: string; checks: readonly Check[] },
  ): EvidenceRequest | null {
    const eq01 = a.checks.find((c) => c.id === "EQ-01");
    const active = this.list(workspace, a.applicant_id).find((r) => ACTIVE.includes(r.status));
    if (eq01?.result === "pass") {
      if (active) this.#set(active, "resolved");
      return null;
    }
    if (eq01?.result !== "fail") return null;
    if (active) return active;
    const now = this.#now();
    const r: EvidenceRequest = {
      id: this.#id(),
      workspace_id: workspace,
      applicant_id: a.applicant_id,
      assessment_id: a.assessment_id,
      type: "income_not_found",
      status: "open",
      created_at: now,
      updated_at: now,
      resent_at: null,
      response: null,
    };
    this.#byId.set(r.id, r);
    return r;
  }

  /** The applicant chose to connect another account; the re-sync (WP5) follows. */
  connect(workspace: string, id: string): EvidenceRequest {
    const r = this.#from(workspace, id, ["open", "connected", "explained"]);
    r.response = { kind: "connect", reason_code: null, note: null, at: this.#now() };
    return this.#set(r, "connected");
  }

  explain(
    workspace: string,
    id: string,
    input: { reason_code: ReasonCode; note?: string | null },
  ): { request: EvidenceRequest; review: { required: true; reasons: string[] } } {
    const r = this.#from(workspace, id, ["open", "connected"]);
    if (!REASON_CODES.includes(input.reason_code))
      throw new InvalidInput(`reason_code must be one of ${REASON_CODES.join(", ")}`);
    const note = input.note ?? null;
    if (note !== null && (typeof note !== "string" || note.length > NOTE_MAX_CHARS))
      throw new InvalidInput(`note must be text of at most ${NOTE_MAX_CHARS} characters`);
    r.response = {
      kind: "explain",
      reason_code: input.reason_code,
      note: note === null ? null : new SensitiveNote(note),
      at: this.#now(),
    };
    this.#set(r, "explained");
    return { request: r, review: explanationReview(input.reason_code) };
  }

  resend(workspace: string, id: string): EvidenceRequest {
    const r = this.#from(workspace, id, ["open", "connected"]);
    r.resent_at = this.#now();
    r.updated_at = r.resent_at;
    return r;
  }

  close(workspace: string, id: string): EvidenceRequest {
    return this.#set(this.#from(workspace, id, ACTIVE), "closed");
  }

  /** The contract view. The only place the note is revealed. */
  toApi(r: EvidenceRequest): EvidenceRequestView {
    return {
      id: r.id,
      applicant_id: r.applicant_id,
      assessment_id: r.assessment_id,
      type: r.type,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      resent_at: r.resent_at,
      response: r.response && { ...r.response, note: r.response.note?.reveal() ?? null },
    };
  }

  #from(workspace: string, id: string, allowed: RequestStatus[]): EvidenceRequest {
    const r = this.get(workspace, id);
    if (!allowed.includes(r.status))
      throw new InvalidTransition(`Request ${id} is ${r.status}; that is not allowed now`);
    return r;
  }
  #set(r: EvidenceRequest, status: RequestStatus): EvidenceRequest {
    r.status = status;
    r.updated_at = this.#now();
    return r;
  }
}
