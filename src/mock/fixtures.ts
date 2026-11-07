// Synthetic fixtures for the mock server (SIG-11, Build Specification 3.4). No real data.
import { readFileSync } from "node:fs";
import {
  benchmarkCsv,
  createOverride,
  getPolicy,
  listBenchmarks,
  listPolicyVersions,
  putPolicy,
  seedVersions,
  summaryOf,
  uploadBenchmark,
} from "./m3.js";
import {
  applicantRequests,
  closeRequest,
  portalConnect,
  portalExplain,
  portalRequests,
  requestStatusVariants,
  registerRequestSlice,
  resendRequest,
  resetRequests,
  reviewFor,
} from "./requests.js";
import { registerSlice } from "./state.js";
import { issueUpload, isUploaded, LOGO_MAX_BYTES, LOGO_PREFIX, LOGO_TYPES } from "./uploads.js";
import { incomeAssessment } from "./inc.js";
import { liabilitiesAssessment } from "./lia.js";
import { markInputsSeeded } from "./m3.js";

type Json = Record<string, unknown>;
type SignalFixture = Json & { evidence_quality: Json };
type AssessmentFixture = Json & { signals: SignalFixture[] };

const AT = "2026-10-20T09:30:00+11:00";
const afT1 = () =>
  JSON.parse(readFileSync("test/fixtures/af-t1-assessment.json", "utf8")) as AssessmentFixture;

const workspace = (over: Json = {}): Json => ({
  id: "wks_01",
  name: "Harbour Mutual",
  website: "https://harbourmutual.example",
  logo_url: null,
  status: "active",
  lookback_months: 6,
  credit_balance: 120,
  on_seed_benchmark: false,
  ...over,
});
const seedWorkspace = workspace({ id: "wks_seed", name: "Seed Bank", on_seed_benchmark: true });
const zeroWorkspace = workspace({ id: "wks_zero", name: "Empty Credit Union", credit_balance: 0 });

const me = (wks: Json, banners: Json[]): Json => ({
  user: { id: "usr_01", email: "officer@harbourmutual.example", name: "Sam Officer" },
  workspace: wks,
  role: "owner",
  credit_balance: wks.credit_balance,
  banners,
});

const loanRequest = {
  loan_amount: 960000,
  term_months: 360,
  purpose: "Purchase",
  security_value: 1200000,
};
const invite = {
  id: "inv_01",
  channel: "email",
  status: "sent",
  expires_at: "2026-10-27T09:30:00+11:00",
};
const applicant = (status: string, rollup: string | null = null, over: Json = {}): Json => ({
  id: `apl_${status}`,
  name: `Applicant ${status}`,
  email: `${status}@applicant.example`,
  mobile: null,
  product_type: "home",
  status,
  rollup_state: rollup,
  grant_revoked: false,
  loan_request: loanRequest,
  invites: [invite],
  latest_assessment_id: null,
  updated_at: AT,
  ...over,
});
const applicants = [
  // apl_01 is the AF-T1 applicant that asm_01 points to (Build Specification 3.4).
  applicant("assessed", "amber", {
    id: "apl_01",
    name: "AF-T1 applicant",
    latest_assessment_id: "asm_01",
  }),
  applicant("assessed", "unverified", {
    id: "apl_02",
    name: "Salary account not shared",
    latest_assessment_id: "asm_unverified",
  }),
  applicant("invited"),
  applicant("connecting"),
  applicant("syncing"),
  applicant("connected"),
  applicant("assessed", "amber", { latest_assessment_id: "asm_01" }),
  applicant("watching", "amber", { latest_assessment_id: "asm_01" }),
  applicant("closed", null, { grant_revoked: true }),
  // apl_03: assessed, then the applicant revoked the grant (Build Spec 4.6, the revoked banner).
  applicant("assessed", "amber", {
    id: "apl_03",
    name: "Grant revoked after assessment",
    grant_revoked: true,
    latest_assessment_id: "asm_03",
  }),
];

const unverified = (): AssessmentFixture => {
  const base = afT1();
  const signal = base.signals[0] as SignalFixture;
  return {
    ...base,
    id: "asm_unverified",
    applicant_id: "apl_02",
    rollup: {
      state: "unverified",
      top_reasons: [
        { signal_id: null, state: "unverified", reason: "The salary account has not been shared" },
      ],
      reasons_to_say_yes: [],
    },
    evidence_checks: [
      {
        id: "EQ-01",
        name: "Income account present",
        result: "fail",
        detail: "No recurring salary or benefit credit is in a shared account",
        resolve_with: ["Connect the account your salary or benefit is paid into"],
        review_required: false,
      },
      {
        id: "EQ-02",
        name: "Unmatched own-account transfers",
        result: "fail",
        detail: "Regular, material transfers from 1 account outside the grant",
        resolve_with: ["Connect the account sending transfers ending 4821"],
        review_required: true,
      },
      {
        id: "EQ-03",
        name: "Window covered",
        result: "pass",
        detail: "The sync returned 100% of the 6-month lookback window",
        resolve_with: [],
        review_required: false,
      },
    ],
    affordability: null,
    signals: [
      {
        ...signal,
        state: "unverified",
        value: null,
        reason: "No recurring salary credit in the shared accounts",
        confidence: "low",
        evidence_count: 0,
        evidence_quality: {
          ...signal.evidence_quality,
          completeness: {
            primary_income_account_shared: false,
            unshared_own_account_transfers: 1,
            institutions_without_shared_account: 0,
            history_months_available: 6,
            history_months_required: 6,
          },
          resolve_with: [
            "Connect the account your salary or benefit is paid into",
            "Connect the account sending transfers ending 4821",
          ],
          review_required: true,
          review_reason: "The primary income account is not shared",
        },
      },
    ],
  };
};

const incomplete = (): AssessmentFixture => ({
  ...afT1(),
  id: "asm_incomplete",
  applicant_id: "apl_assessed",
  status: "data_incomplete",
  status_reason: "The sync failed three times, so partial data was not evaluated",
  rollup: { state: "unverified", top_reasons: [], reasons_to_say_yes: [] },
  evidence_checks: [],
  affordability: null,
  signals: [],
});

const evidenceAssessment = (): AssessmentFixture => {
  const base = afT1();
  const [inc, lia] = base.signals as [SignalFixture, SignalFixture];
  return {
    ...base,
    id: "asm_evidence",
    applicant_id: "apl_assessed",
    signals: [
      {
        ...inc,
        id: "LIQ-02",
        family: 2,
        family_code: "LIQ",
        rollup_class: "refer",
        evidence_count: 0,
      },
      lia,
      { ...lia, id: "LIA-05", name: "BNPL", rollup_class: "standard", evidence_count: 50 },
    ],
  };
};

export const assessments: Record<string, Json> = {
  asm_01: afT1(),
  asm_unverified: unverified(),
  asm_incomplete: incomplete(),
  asm_evidence: evidenceAssessment(),
  asm_03: { ...afT1(), id: "asm_03", applicant_id: "apl_03" },
  // SIG-41: the 13 INC signals, computed by the family 1 engine.
  asm_income: incomeAssessment(afT1()),
  // SIG-42: the six LIA signals, computed by the family 3 engine.
  asm_liabilities: liabilitiesAssessment(afT1()),
};
// asm_01_v2: version 2 of apl_01's assessment, for the version picker (contract 1.5.0).
seedVersions(assessments);
markInputsSeeded();
// SIG-48: apl_02's assessment fails EQ-01, so it starts with an open income_not_found request.
export const resetRequestState = () =>
  resetRequests(
    (id) => (assessments[id]?.evidence_checks ?? []) as { id: string; result: string }[],
  );
resetRequestState();
registerRequestSlice(resetRequestState);

// SIG-51: assessment versions created by overrides are a state slice; the seeded ones aren't stored.
const SEEDED_ASSESSMENTS = new Set(Object.keys(assessments));
registerSlice({
  type: "assessment",
  reset: () => {
    for (const id of Object.keys(assessments))
      if (!SEEDED_ASSESSMENTS.has(id)) Reflect.deleteProperty(assessments, id);
  },
  snapshot: () =>
    Object.fromEntries(Object.entries(assessments).filter(([id]) => !SEEDED_ASSESSMENTS.has(id))),
  restore: (items) => {
    for (const [id, a] of Object.entries(items)) assessments[id] = a as Json;
  },
});
/**
 * The assessments that carry the review block (contract 1.6.0; SIG-51 added scope): asm_unverified
 * is required once req_01 has been explained, and asm_evidence is the counterpart, never required.
 */
const REVIEWED = new Set(["asm_unverified", "asm_evidence"]);

const evidenceRows = (count: number, prefix: string): Json[] =>
  Array.from({ length: count }, (_, i) => ({
    transaction_id: `txn_${prefix}_${i + 1}`,
    date: `2026-${String(4 + (i % 6)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
    description: `Synthetic ${prefix} transaction ${i + 1}`,
    amount: -(25 + i),
    category: "bnpl",
    source: "rule",
    confidence: 0.9,
  }));

// Keyed by "<assessment>/<signal>"; any other signal on a known assessment has no evidence file.
const evidence: Record<string, Json[]> = {
  "asm_01/INC-01": evidenceRows(13, "salary").map((row) => ({
    ...row,
    amount: 3200,
    category: "income",
  })),
  "asm_01/LIA-01": evidenceRows(1, "card"),
  "asm_evidence/LIQ-02": [],
  "asm_evidence/LIA-01": evidenceRows(1, "card"),
  "asm_evidence/LIA-05": evidenceRows(50, "bnpl"),
};

const member = {
  id: "mem_01",
  email: "officer@harbourmutual.example",
  name: "Sam Officer",
  role: "owner",
  invited_at: null,
};
const summary = {
  id: "asm_01",
  applicant_id: "apl_assessed",
  version: 1,
  status: "complete",
  rollup_state: "amber",
  data_as_of: AT,
  evidence_checks: afT1().evidence_checks,
};
const ledger = {
  id: "led_01",
  delta: 120,
  reason: "pack_purchase",
  applicant_id: null,
  stripe_payment_intent_id: null,
  at: AT,
};
const note = {
  id: "note_01",
  assessment_id: "asm_01",
  signal_id: "LIA-01",
  author: "Sam Officer",
  body: "Applicant confirmed the card was closed in September.",
  explained: true,
  created_at: AT,
};
const PRODUCTS = new Set(["personal", "home", "car", "business"]);
const policy = {
  product: "home",
  version: 1,
  buffer: 3,
  floor_rate: 5.5,
  income_shading: { salary: 1, overtime: 0.8 },
  card_factor: 0.03,
  expense_method: "highest_of_confirmed_benchmark_observed",
  ratio_thresholds: { dsr: { amber: 0.5, red: 0.7 }, lvr: { amber: 0.7, red: 0.9 } },
  // SIG-41 ruling 3: candidate workspace defaults (contract 1.7.0).
  income_signals: {
    wage_sized_loan_amount: 20000,
    large_loan_amount: 500000,
    policy_loan_amount: null,
  },
};
const benchmark = {
  id: "bmk_01",
  name: "Moroku seed table",
  version: 1,
  source: "seed",
  is_seed: true,
  effective_from: "2026-07-01",
};
const audit = {
  id: "aud_01",
  workspace_id: "wks_01",
  actor: "officer@harbourmutual.example",
  action: "assessment.view",
  target: "asm_01",
  reason: null,
  at: AT,
  ip: null,
};
const watch = {
  id: "wch_01",
  applicant_id: "apl_watching",
  mode: "readiness",
  cadence: "weekly",
  hold_runs: 2,
  starts_at: AT,
  ends_at: "2027-04-20T09:30:00+10:00",
  consent_recorded_at: AT,
  share_path_to_ready: true,
  status: "active",
  stop_reason: null,
  last_run_at: AT,
};
const portalWatch = {
  watch,
  purpose: "Harbour Mutual will keep checking your shared accounts and contact you when ready.",
  path_to_ready: [{ label: "Monthly surplus", current: 600, target: 1000, met: false }],
};
const portalSession = {
  lender_name: "Harbour Mutual",
  lender_logo_url: null,
  shared_data: ["Account details", "Balances", "Transactions"],
  purpose: "To assess your home loan application",
  step: "welcome",
};
const financialPosition = {
  household_earners: 2,
  assets: [{ type: "property", provider: null, amount: 1200000, source: "applicant" }],
  liabilities: [{ type: "credit_card", provider: "Synthetic Bank", amount: 6000, source: "bank" }],
  repayments: [{ type: "credit_card", provider: "Synthetic Bank", amount: 229, source: "bank" }],
  income: [{ type: "salary", provider: "Synthetic Employer", amount: 15158, source: "bank" }],
  expenses: [{ type: "living", provider: null, amount: 3367, source: "bank" }],
};
// SIG-50 and SIG-51: the portal remembers each token's step and its saved financial position.
// connect moves welcome to progress; saving the finances moves to done; withdraw is final.
const portalSteps = new Map<string, string>();
const positions = new Map<string, Json>();
const stepOf = (token: string) => portalSteps.get(token) ?? portalSession.step;
const sessionOf = (token: string) => ({ ...portalSession, step: stepOf(token) });
const withdrawn = (token: string): MockError | null =>
  stepOf(token) === "withdrawn"
    ? {
        mockError: {
          status: 409,
          code: "grant_revoked",
          message: "Consent was withdrawn; ask the lender for a new link",
        },
      }
    : null;
const POSITION_LISTS = ["assets", "liabilities", "repayments", "income", "expenses"] as const;
function putFinancialPosition({ token = "" }: Params, _: URLSearchParams, req: MockRequest) {
  if (!IDS.has(token)) return undefined;
  const blocked = withdrawn(token);
  if (blocked) return blocked;
  const body = record(req.body);
  const lists = POSITION_LISTS.every(
    (k) => Array.isArray(body[k]) && (body[k] as unknown[]).every((r) => record(r) === r),
  );
  const earners = body.household_earners;
  const earnersOk =
    earners === undefined ||
    earners === null ||
    (Number.isInteger(earners) && Number(earners) >= 1);
  if (!lists || !earnersOk)
    return invalid(
      "invalid_parameter",
      "A financial position needs assets, liabilities, repayments, income and expenses as lists, and household_earners of at least 1 or null",
    );
  const kept: Json = {};
  if ("household_earners" in body) kept.household_earners = earners;
  for (const k of POSITION_LISTS) kept[k] = body[k];
  positions.set(token, kept);
  portalSteps.set(token, "done");
  return kept;
}
function portalConnectFlow({ token = "" }: Params) {
  if (!IDS.has(token)) return undefined;
  const blocked = withdrawn(token);
  if (blocked) return blocked;
  if (stepOf(token) === "welcome") portalSteps.set(token, "progress");
  return url("https://openfeed.example/authorize");
}
registerSlice({
  type: "portal_session",
  reset: () => portalSteps.clear(),
  snapshot: () => Object.fromEntries([...portalSteps].map(([t, step]) => [t, { step }])),
  restore: (items) => {
    for (const [t, v] of Object.entries(items)) portalSteps.set(t, (v as { step: string }).step);
  },
});
registerSlice({
  type: "financial_position",
  reset: () => positions.clear(),
  snapshot: () => Object.fromEntries(positions),
  restore: (items) => {
    for (const [t, v] of Object.entries(items)) positions.set(t, v as Json);
  },
});

const adminWorkspace = (wks: Json): Json => ({
  ...wks,
  member_count: 3,
  usage: { assessments_this_month: 14 },
  applicants_by_status: { invited: 1, assessed: 5 },
  last_activity_at: AT,
});
const launchOffer = {
  cap: 10,
  used: 1,
  remaining: 9,
  claims: [{ workspace_id: "wks_01", at: AT }],
};
const job = { id: "job_01", kind: "sync", status: "queued", workspace_id: "wks_01" };
const published = {
  version: 1,
  published_at: AT,
  published_by: "staff@moroku.example",
  second_signatory: "staff2@moroku.example",
  content: {},
};
const page = (items: unknown[]) => ({ items, next_cursor: null });
const url = (target: string) => ({ url: target });

// One response per "<method> <template>". Where the response depends on an ID, it is a function
// of the path parameters and returns undefined for an unknown ID.
type Params = Record<string, string>;
/** The request as a fixture sees it: the parsed JSON body, the mock's own origin and the time. */
export type MockRequest = { body: unknown; text: string; origin: string; now: number };
type Fixture = unknown | ((params: Params, query: URLSearchParams, req: MockRequest) => unknown);

/** A fixture returns this to make the mock answer with a contract-shaped error. */
export type MockError = {
  mockError: { status: number; code: string; message: string; details?: unknown };
};
const ROLLUP_STATES = ["green", "amber", "red_refer", "red_knockout", "unverified"];
const invalid = (code: string, message: string): MockError => ({
  mockError: { status: 400, code, message },
});

// The two settings the mock remembers (contract 1.2.0): auto top-up, and the workspace logo.
// SIG-51: a state slice, kept in the mock's table between Lambda containers.
const PACK_IDS = new Set(["pack_launch", "pack_100"]);
const defaultSettings = () => ({
  autoTopup: { enabled: false, pack_id: null as string | null, updated_at: null as string | null },
  logoUrl: null as string | null,
});
let saved = defaultSettings();
registerSlice({
  type: "setting",
  reset: () => {
    saved = defaultSettings();
  },
  snapshot: () => ({ auto_topup: saved.autoTopup, logo_url: saved.logoUrl }),
  restore: (items) => {
    if ("auto_topup" in items) saved.autoTopup = items.auto_topup as typeof saved.autoTopup;
    if ("logo_url" in items) saved.logoUrl = items.logo_url as string | null;
  },
});
const record = (body: unknown): Record<string, unknown> =>
  body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

function updateAutoTopup(_: Params, __: URLSearchParams, req: MockRequest) {
  const body = record(req.body);
  if (typeof body.enabled !== "boolean")
    return invalid("invalid_parameter", "enabled must be true or false");
  if ("pack_id" in body && body.pack_id !== null && typeof body.pack_id !== "string")
    return invalid("invalid_parameter", "pack_id must be a string or null");
  const pack = "pack_id" in body ? (body.pack_id as string | null) : saved.autoTopup.pack_id;
  if (pack !== null && !PACK_IDS.has(pack))
    return invalid("invalid_parameter", "pack_id is not a listed pack");
  if (body.enabled && pack === null)
    return invalid("invalid_parameter", "Choose a pack to turn auto top-up on");
  saved.autoTopup = {
    enabled: body.enabled,
    pack_id: pack,
    updated_at: new Date(req.now).toISOString(),
  };
  return saved.autoTopup;
}

function createLogoUpload(_: Params, __: URLSearchParams, req: MockRequest) {
  const body = record(req.body);
  const type = body.content_type;
  const size = body.size_bytes;
  if (typeof type !== "string" || !(LOGO_TYPES as readonly string[]).includes(type))
    return invalid("invalid_logo", "The logo must be PNG, JPEG or SVG");
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > LOGO_MAX_BYTES)
    return invalid("invalid_logo", "The logo must be at most 2 MB");
  return issueUpload("wks_01", type, size, req.origin, req.now);
}

function updateWorkspace(_: Params, __: URLSearchParams, req: MockRequest) {
  const body = record(req.body);
  if (Object.keys(body).length === 0)
    return invalid("invalid_parameter", "Send at least one field to change");
  if ("logo_key" in body) {
    const key = body.logo_key;
    if (key === null) saved.logoUrl = null;
    else if (typeof key !== "string" || !isUploaded(key))
      return invalid("logo_not_uploaded", "No uploaded logo has that key");
    else saved.logoUrl = `${req.origin}${LOGO_PREFIX}${key}`;
  }
  return {
    ...workspace(),
    logo_url: saved.logoUrl,
    ...(typeof body.name === "string" ? { name: body.name } : {}),
    ...("website" in body ? { website: body.website } : {}),
  };
}
const STATUSES = [
  "invited",
  "connecting",
  "syncing",
  "connected",
  "assessed",
  "watching",
  "closed",
];

function listApplicants(_params: Params, query: URLSearchParams): unknown {
  const status = query.get("status");
  const rollup = query.get("rollup_state");
  if (status !== null && !STATUSES.includes(status)) {
    return { mockError: { status: 400, code: "invalid_parameter", message: "Unknown status" } };
  }
  if (rollup !== null && !ROLLUP_STATES.includes(rollup)) {
    return {
      mockError: { status: 400, code: "invalid_parameter", message: "Unknown rollup_state" },
    };
  }
  return page(
    applicants.filter(
      (a) =>
        (status === null || a.status === status) && (rollup === null || a.rollup_state === rollup),
    ),
  );
}

// SIG-51: which assessment each applicant points to changes when an override creates a version.
const SEEDED_LATEST = new Map(applicants.map((a) => [a.id as string, a.latest_assessment_id]));
registerSlice({
  type: "applicant",
  reset: () => {
    for (const a of applicants) a.latest_assessment_id = SEEDED_LATEST.get(a.id as string);
  },
  snapshot: () =>
    Object.fromEntries(
      applicants
        .filter((a) => a.latest_assessment_id !== SEEDED_LATEST.get(a.id as string))
        .map((a) => [a.id, { latest_assessment_id: a.latest_assessment_id }]),
    ),
  restore: (items) => {
    for (const a of applicants) {
      const v = items[a.id as string] as { latest_assessment_id: string } | undefined;
      if (v) a.latest_assessment_id = v.latest_assessment_id;
    }
  },
});

export const IDS = new Set([
  "mem_01",
  "note_01",
  "wch_01",
  "inv_01",
  "job_01",
  "wks_01",
  "wks_seed",
  "wks_zero",
  "tok_01",
  "personal",
  "home",
  "car",
  "business",
]);

const findApplicant = ({ id }: Params) => applicants.find((a) => a.id === id);
const knownApplicant =
  <T>(body: T) =>
  (params: Params) =>
    findApplicant(params) ? body : undefined;
const knownAssessment =
  <T>(body: T) =>
  ({ id = "" }: Params) =>
    assessments[id] ? body : undefined;
const adminById = ({ id }: Params) =>
  [workspace(), seedWorkspace, zeroWorkspace].map(adminWorkspace).find((w) => w.id === id);

export const fixtures: Record<string, Fixture> = {
  "get /v1/app/me": () => me(workspace({ logo_url: saved.logoUrl }), []),
  "post /v1/app/workspaces": workspace(),
  "get /v1/app/packs": {
    packs: [
      {
        id: "pack_launch",
        name: "Launch pack",
        credits: 500,
        price_aud: 2500,
        is_launch_offer: true,
        eligible: true,
        places_left: 9,
      },
      {
        id: "pack_100",
        name: "100 credits",
        credits: 100,
        price_aud: 1000,
        is_launch_offer: false,
        eligible: true,
        places_left: null,
      },
    ],
  },
  "post /v1/app/checkout": url("https://checkout.stripe.example/session"),
  "post /v1/app/billing/portal": url("https://billing.stripe.example/session"),
  "get /v1/app/credits": () => ({
    balance: 120,
    reserved: 2,
    auto_topup: saved.autoTopup,
    entries: [ledger],
    next_cursor: null,
  }),
  "patch /v1/app/billing/auto-topup": updateAutoTopup,
  "patch /v1/app/workspace": updateWorkspace,
  "post /v1/app/workspace/logo": createLogoUpload,
  "get /v1/app/members": page([member]),
  "post /v1/app/members": member,
  "patch /v1/app/members/{id}": member,
  "delete /v1/app/members/{id}": null,
  "get /v1/app/applicants": listApplicants,
  "post /v1/app/applicants": applicant("invited"),
  "get /v1/app/applicants/{id}": findApplicant,
  "patch /v1/app/applicants/{id}": findApplicant,
  "delete /v1/app/applicants/{id}": (params: Params) =>
    findApplicant(params) && { ...findApplicant(params), status: "closed", grant_revoked: true },
  "post /v1/app/applicants/{id}/invites": knownApplicant(invite),
  "delete /v1/app/applicants/{id}/invites/{inviteId}": knownApplicant(null),
  "post /v1/app/applicants/{id}/request-accounts": knownApplicant(invite),
  "get /v1/app/applicants/{id}/assessments": (params: Params) => {
    if (!findApplicant(params)) return undefined;
    const chain = Object.values(assessments)
      .filter((a) => a.applicant_id === params.id)
      .sort((a, b) => Number(a.version) - Number(b.version));
    return chain.length > 0 ? page(chain.map(summaryOf)) : page([summary]);
  },
  "post /v1/app/applicants/{id}/assessments": knownApplicant({
    ...summary,
    status: "running",
    rollup_state: null,
    evidence_checks: null,
  }),
  "get /v1/app/applicants/{id}/timeline": knownApplicant(
    page([
      {
        id: "run_01",
        watch_id: "wch_01",
        run_at: AT,
        assessment_id: "asm_01",
        pins: afT1().pins,
        transitions: [
          { signal: "LIA-05", from: "amber", to: "green", held_runs: 2, alerted: true },
        ],
      },
    ]),
  ),
  "get /v1/app/assessments/{id}": ({ id = "" }: Params) => {
    const a = assessments[id];
    return a && REVIEWED.has(id) ? { ...a, review: reviewFor(id) } : a;
  },
  "get /v1/app/assessments/{id}/signals/{signalId}/evidence": ({ id, signalId }: Params) => {
    const items = evidence[`${id}/${signalId}`];
    return items && { items };
  },
  "get /v1/app/assessments/{id}/affordability/trace": knownAssessment({
    expense_method: "highest_of_confirmed_benchmark_observed",
    income: [
      {
        payer: "Synthetic Employer",
        cadence: "fortnightly",
        observed_amount: 6996,
        type: "salary",
        shading: 1,
        assessed_amount: 15158,
      },
    ],
    expenses: [
      {
        group: "living",
        declared: 3000,
        benchmark: 1573,
        observed: 3367,
        used: 3367,
        why: "Highest of the three",
      },
    ],
    liabilities: [
      {
        type: "credit_card",
        source: "found",
        monthly_commitment: 229,
        rule: "Higher of stated repayment and 3% of limit",
      },
    ],
    trace: [{ step: "ara", value: 11333, inputs: { income: 15158, gle: 3367, repayments: 458 } }],
    overrides: [],
  }),
  "post /v1/app/assessments/{id}/notes": knownAssessment(note),
  "patch /v1/app/notes/{id}": note,
  "post /v1/app/assessments/{id}/overrides": (
    { id = "" }: Params,
    _: URLSearchParams,
    req: MockRequest,
  ) =>
    createOverride(id, req.body, assessments, (applicantId, newId) => {
      const a = applicants.find((x) => x.id === applicantId);
      if (a) a.latest_assessment_id = newId;
    }),
  "get /v1/app/assessments/{id}/report.pdf": knownAssessment({ pdf: true }),
  "get /v1/portal/{token}/requests": ({ token = "" }: Params) => portalRequests(token),
  "post /v1/portal/{token}/requests/{requestId}/connect": ({
    token = "",
    requestId = "",
  }: Params) =>
    portalConnect(token, requestId, url("https://openfeed.example/authorize?request=" + requestId)),
  "post /v1/portal/{token}/requests/{requestId}/explain": (
    { token = "", requestId = "" }: Params,
    _: URLSearchParams,
    req: MockRequest,
  ) => portalExplain(token, requestId, req.body),
  "get /v1/app/applicants/{id}/requests": (params: Params) =>
    findApplicant(params) ? applicantRequests(params.id ?? "") : undefined,
  "post /v1/app/applicants/{id}/requests/{requestId}/resend": ({
    id = "",
    requestId = "",
  }: Params) => resendRequest(id, requestId),
  "post /v1/app/applicants/{id}/requests/{requestId}/close": ({
    id = "",
    requestId = "",
  }: Params) => closeRequest(id, requestId),
  "get /v1/app/settings/policy/{product}": ({ product = "" }: Params) =>
    PRODUCTS.has(product) ? getPolicy(product, policy) : undefined,
  "put /v1/app/settings/policy/{product}": (
    { product = "" }: Params,
    _: URLSearchParams,
    req: MockRequest,
  ) =>
    PRODUCTS.has(product)
      ? putPolicy(product, policy, req.body, req.now, "officer@harbourmutual.example")
      : undefined,
  "get /v1/app/settings/policy/{product}/versions": ({ product = "" }: Params) =>
    PRODUCTS.has(product) ? listPolicyVersions(product, policy) : undefined,
  "get /v1/app/benchmarks": () => listBenchmarks(benchmark),
  "post /v1/app/benchmarks": (_: Params, __: URLSearchParams, req: MockRequest) =>
    uploadBenchmark(benchmark, req.text, req.now),
  "get /v1/app/benchmarks/template.csv": {
    csv: "household_type,dependants,income_band,location,monthly_amount\n",
  },
  "get /v1/app/audit": page([audit]),
  "post /v1/app/watches": watch,
  "delete /v1/app/watches/{id}": { ...watch, status: "stopped", stop_reason: "officer" },
  "get /v1/portal/{token}": ({ token = "" }: Params) =>
    IDS.has(token) ? sessionOf(token) : undefined,
  "post /v1/portal/{token}/connect": portalConnectFlow,
  "get /v1/openfeed/callback": { redirect: "/connect/tok_01/progress" },
  "get /v1/portal/{token}/financial-position": ({ token = "" }: Params) =>
    IDS.has(token) ? (positions.get(token) ?? financialPosition) : undefined,
  "put /v1/portal/{token}/financial-position": putFinancialPosition,
  "post /v1/portal/{token}/withdraw": ({ token = "" }: Params) => {
    if (!IDS.has(token)) return undefined;
    portalSteps.set(token, "withdrawn");
    return sessionOf(token);
  },
  "get /v1/portal/{token}/watch": portalWatch,
  "post /v1/portal/{token}/watch": portalWatch,
  "post /v1/portal/{token}/watch/stop": {
    ...portalWatch,
    watch: { ...watch, status: "stopped", stop_reason: "applicant" },
  },
  "get /v1/admin/workspaces": page([workspace(), seedWorkspace, zeroWorkspace].map(adminWorkspace)),
  "get /v1/admin/workspaces/{id}": adminById,
  "patch /v1/admin/workspaces/{id}": adminById,
  "post /v1/admin/workspaces/{id}/credits": { ...ledger, reason: "adjustment" },
  "get /v1/admin/launch-offer": launchOffer,
  "patch /v1/admin/launch-offer": launchOffer,
  "post /v1/admin/workspaces/{id}/support-access": ({ id = "" }: Params) => ({
    id: "sup_01",
    workspace_id: id,
    staff: "staff@moroku.example",
    expires_at: AT,
  }),
  "get /v1/admin/operations": {
    integrations: [
      { name: "openfeed", healthy: true },
      { name: "enrich", healthy: true },
      { name: "stripe", healthy: true },
      { name: "email", healthy: true },
    ],
    jobs: [{ ...job, status: "failed" }],
    webhook_failures: 0,
    openfeed_credits_held: 100,
  },
  "post /v1/admin/operations/retry/{jobId}": job,
  "get /v1/admin/definitions": { items: [published] },
  "post /v1/admin/definitions": { ...published, version: 2 },
  "get /v1/admin/default-thresholds": { items: [published] },
  "post /v1/admin/default-thresholds": { ...published, version: 2 },
  "get /v1/admin/seed-benchmark": { items: [published] },
  "post /v1/admin/seed-benchmark": { ...published, version: 2 },
  "get /v1/admin/audit": page([audit]),
};

// Named variants, chosen with the header `Prefer: example=<name>`.
export const variants: Record<string, Record<string, unknown>> = {
  "get /v1/app/applicants/{id}/requests": requestStatusVariants,
  "get /v1/app/benchmarks/template.csv": {
    valid: { csv: benchmarkCsv("valid") },
    invalid: { csv: benchmarkCsv("invalid") },
  },
  "get /v1/app/me": {
    seed_benchmark: me(seedWorkspace, [
      { code: "seed_benchmark", message: "You are using the Moroku seed benchmark table." },
    ]),
    zero_credits: me(zeroWorkspace, [
      { code: "zero_credits", message: "You have no credits. Buy a pack to invite applicants." },
    ]),
  },
};
