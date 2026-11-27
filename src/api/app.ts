// SIG-82 candidate 0 (rulings 40775, 1 and 40777; 40779; 40782): the demo application layer. It
// serves the contract's /v1/app and /v1/portal workflow by the mock's approach: routes read from
// openapi.yaml, state in the mock's DynamoDB store (src/api/store.ts). On top of the mock it adds:
//   - a verified Supabase sign-in on every /v1/app call (src/auth/supabase.ts);
//   - workspace scoping from that sign-in: a request reads and writes only its own workspace's
//     partition, so another workspace's ID is simply not found (T5: 404);
//   - the assessment endpoints behind the assessment port, a labelled 501 until it is wired;
//   - CORS for the three Lovable origins only;
//   - a labelled sandbox-consent page standing in for the bank's consent, which records the
//     seeded scenario the applicant picks and returns to /connect/:token/progress.
// Every figure an assessment shows will come from the real engines; nothing here is a fixture.
// Never logged: tokens, descriptions, references, account numbers, request bodies.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { bearerOf, type Verifier } from "../auth/supabase.js";
import type { Assessment } from "../assessment/assess.js";
import { NOT_WIRED_MESSAGE, type AssessmentPort } from "./assessment-port.js";
import { toAssessment, toSummary, toTrace, type AssessmentRequestPart } from "./mapping.js";
import { DEFAULT_ORIGIN, DEMO_ORIGINS, type DemoConfig, type WorkspaceKey } from "./config.js";
import { consentPage } from "./consent.js";
import { healthBody } from "./health.js";
import {
  DEMO_WORKSPACES,
  demoPolicy,
  SANDBOX_SCENARIOS,
  type DemoWorkspace,
  type ScenarioKey,
} from "./seed.js";
import { PORTAL_PARTITION, workspacePartition, type DemoStore } from "./store.js";

export type DemoRequest = {
  method: string;
  path: string;
  query?: string;
  headers: Readonly<Record<string, string | undefined>>;
  body?: string;
  /** The API's own host name, for the HTTPS consent URL. */
  host: string;
};
export type DemoResponse = { status: number; headers: Record<string, string>; body: string };
type Json = Record<string, unknown>;

/** How long the synthetic "sync" takes between consent and the finances step. */
export const SYNC_MS = 6_000;
const INVITE_DAYS = 7;
const METHODS = ["get", "post", "put", "patch", "delete"];

type Route = { template: string; regex: RegExp; literal: boolean; methods: Set<string> };
function loadRoutes(): Route[] {
  const doc = parse(readFileSync("openapi.yaml", "utf8")) as {
    paths: Record<string, Record<string, unknown>>;
  };
  return Object.entries(doc.paths)
    .map(([template, item]) => ({
      template,
      literal: !template.includes("{"),
      regex: new RegExp(
        "^" +
          template
            .replace(/[.]/g, "\\.")
            .replace(/\{(\w+)\}/g, (_, name: string) => `(?<${name}>[^/]+)`) +
          "$",
      ),
      methods: new Set(Object.keys(item).filter((m) => METHODS.includes(m))),
    }))
    .sort((a, b) => Number(b.literal) - Number(a.literal));
}

type Applicant = Json & { id: string; status: string; invites: Json[] };
type PortalRecord = {
  workspace_id: string;
  applicant_id: string;
  step: "welcome" | "progress" | "finances" | "done" | "withdrawn";
  return_origin: string;
  consent_at: number | null;
  scenario: ScenarioKey | null;
  expires_at: number;
  position?: Json;
};

const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** Server-side only: the composition's whole output, embedded Enrich record included (40802, 1). */
type StoredAssessment = {
  id: string;
  applicant_id: string;
  version: number;
  scenario: ScenarioKey;
  set_applicant_id: string;
  output_sha256: string;
  created_at: string;
  /** The request's product type and as-of date, for the contract's product_type and data_as_of. */
  request: AssessmentRequestPart;
  output: Assessment;
};
const EVIDENCE_NOT_BUILT =
  "The evidence transactions for a signal aren't served yet: the masked evidence endpoint (SIG-82 40805, 2.7) isn't built. Nothing here returns a sample.";
const iso = (ms: number) => new Date(ms).toISOString();
const record = (x: unknown): Json =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {};
const PRODUCTS = new Set(["personal", "home", "car", "business"]);
const POSITION_LISTS = ["assets", "liabilities", "repayments", "income", "expenses"] as const;
const page = (items: unknown[]) => ({ items, next_cursor: null });

export function createDemoApp(o: {
  config: DemoConfig;
  store: DemoStore;
  verify: Verifier;
  assessments: AssessmentPort;
  now?: () => number;
}) {
  const routes = loadRoutes();
  const now = o.now ?? Date.now;
  const { store } = o;

  const cors = (origin: string | undefined): Record<string, string> =>
    origin && DEMO_ORIGINS.includes(origin)
      ? {
          "access-control-allow-origin": origin,
          "access-control-allow-headers": "authorization,content-type,idempotency-key,prefer",
          "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "access-control-max-age": "600",
          vary: "Origin",
        }
      : { vary: "Origin" };

  let origin: string | undefined;
  const json = (
    status: number,
    body: unknown,
    extra: Record<string, string> = {},
  ): DemoResponse => ({
    status,
    headers: {
      ...cors(origin),
      "content-type": "application/json",
      "cache-control": "no-store",
      ...extra,
    },
    body: JSON.stringify(body),
  });
  const error = (status: number, code: string, message: string) =>
    json(status, { error: { code, message } });
  const notFound = () => error(404, "not_found", "No such record");
  const notInDemo = (what = "This endpoint") =>
    error(
      501,
      "not_available_in_demo",
      `${what} is not available in this demo (SIG-82 demo stage, synthetic data only)`,
    );

  const memberOf = (u: { sub: string; email: string | null }): WorkspaceKey | null =>
    o.config.members[u.sub.toLowerCase()] ??
    (u.email ? o.config.members[u.email.toLowerCase()] : undefined) ??
    null;

  const workspaceBody = (w: DemoWorkspace) => ({
    id: w.id,
    name: w.name,
    website: null,
    logo_url: null,
    status: "active",
    lookback_months: 6,
    credit_balance: w.credits,
    on_seed_benchmark: false,
  });

  const getApplicant = (w: DemoWorkspace, id: string) =>
    store.get<Applicant>(workspacePartition(w.id), `applicant#${id}`);
  const saveApplicant = (workspaceId: string, a: Applicant) =>
    store.put(workspacePartition(workspaceId), `applicant#${a.id}`, {
      ...a,
      updated_at: iso(now()),
    });
  const setApplicantStatus = async (p: PortalRecord, status: string, over: Json = {}) => {
    const a = await store.get<Applicant>(
      workspacePartition(p.workspace_id),
      `applicant#${p.applicant_id}`,
    );
    if (a && (a.status !== status || Object.keys(over).length > 0))
      await saveApplicant(p.workspace_id, { ...a, ...over, status });
  };
  const getPortal = (token: string) => store.get<PortalRecord>(PORTAL_PARTITION, `token#${token}`);
  const savePortal = (token: string, p: PortalRecord) =>
    store.put(PORTAL_PARTITION, `token#${token}`, p);
  const workspaceById = (id: string) =>
    Object.values(DEMO_WORKSPACES).find((w) => w.id === id) ?? null;

  /** progress becomes finances once the synthetic sync has had its few seconds. */
  async function advance(token: string, p: PortalRecord): Promise<PortalRecord> {
    if (p.step === "progress" && p.consent_at !== null && now() - p.consent_at >= SYNC_MS) {
      const next = { ...p, step: "finances" as const };
      await savePortal(token, next);
      await setApplicantStatus(next, "connected");
      return next;
    }
    return p;
  }

  async function app(
    w: DemoWorkspace,
    user: { sub: string; email: string | null },
    method: string,
    template: string,
    params: Record<string, string>,
    body: Json,
    req: DemoRequest,
  ): Promise<DemoResponse> {
    const key = `${method} ${template}`;
    const id = params.id ?? "";
    switch (key) {
      case "get /v1/app/me":
        return json(200, {
          user: { id: user.sub, email: user.email ?? "unknown@demo.invalid", name: null },
          workspace: workspaceBody(w),
          role: "owner",
          credit_balance: w.credits,
          banners: [
            {
              code: "demo_stage",
              message:
                "Demo stage: synthetic data only. Every figure comes from the real engines; the workflow around them is demo-grade.",
            },
          ],
        });
      case "get /v1/app/credits":
        return json(200, {
          balance: w.credits,
          reserved: 0,
          auto_topup: { enabled: false, pack_id: null, updated_at: null },
          entries: [
            {
              id: "led_demo_seed",
              delta: w.credits,
              reason: "adjustment",
              applicant_id: null,
              stripe_payment_intent_id: null,
              at: "2026-11-28T00:00:00.000Z",
            },
          ],
          next_cursor: null,
        });
      case "get /v1/app/packs":
        return json(200, { packs: [] });
      case "get /v1/app/members":
        return json(
          200,
          page([
            {
              id: user.sub,
              email: user.email ?? "unknown@demo.invalid",
              name: null,
              role: "owner",
              invited_at: null,
            },
          ]),
        );
      case "get /v1/app/audit":
        return json(200, page([]));
      case "get /v1/app/settings/policy/{product}":
        return PRODUCTS.has(params.product ?? "")
          ? json(200, demoPolicy(params.product as string))
          : notFound();
      case "get /v1/app/applicants": {
        const all = await store.list<Applicant>(workspacePartition(w.id), "applicant#");
        const status = new URLSearchParams(req.query ?? "").get("status");
        const items = [...all.values()]
          .filter((a) => status === null || a.status === status)
          .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
        return json(200, page(items));
      }
      case "post /v1/app/applicants": {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name || !PRODUCTS.has(String(body.product_type)))
          return error(400, "invalid_parameter", "An applicant needs a name and a product_type");
        const a: Applicant = {
          id: `apl_${hex(8)}`,
          name,
          email: typeof body.email === "string" ? body.email : null,
          mobile: typeof body.mobile === "string" ? body.mobile : null,
          product_type: body.product_type,
          status: "invited",
          rollup_state: null,
          grant_revoked: false,
          loan_request: record(body.loan_request),
          invites: [],
          latest_assessment_id: null,
          updated_at: iso(now()),
        };
        await saveApplicant(w.id, a);
        return json(201, a);
      }
    }

    // Everything below names an applicant or an assessment of this workspace.
    if (template.startsWith("/v1/app/applicants/{id}")) {
      const a = await getApplicant(w, id);
      if (!a) return notFound();
      switch (key) {
        case "get /v1/app/applicants/{id}":
          return json(200, a);
        case "patch /v1/app/applicants/{id}": {
          const next = { ...a, loan_request: { ...record(a.loan_request), ...body } };
          await saveApplicant(w.id, next);
          return json(200, { ...next, updated_at: iso(now()) });
        }
        case "delete /v1/app/applicants/{id}": {
          const next = { ...a, status: "closed", grant_revoked: true };
          await saveApplicant(w.id, next);
          return json(200, { ...next, updated_at: iso(now()) });
        }
        case "post /v1/app/applicants/{id}/invites": {
          const channel = body.channel === "sms" ? "sms" : "email";
          const token = typeof a.portal_token === "string" ? a.portal_token : `tok_${hex(16)}`;
          const back =
            req.headers.origin && DEMO_ORIGINS.includes(req.headers.origin)
              ? req.headers.origin
              : DEFAULT_ORIGIN;
          const expires = now() + INVITE_DAYS * 86_400_000;
          const invite = {
            id: `inv_${hex(6)}`,
            channel,
            status: "sent",
            expires_at: iso(expires),
            portal_url: `${back}/connect/${token}`,
          };
          const existing = await getPortal(token);
          await savePortal(token, {
            workspace_id: w.id,
            applicant_id: a.id,
            step: existing?.step ?? "welcome",
            return_origin: back,
            consent_at: existing?.consent_at ?? null,
            scenario: existing?.scenario ?? null,
            expires_at: expires,
            ...(existing?.position ? { position: existing.position } : {}),
          });
          await saveApplicant(w.id, { ...a, portal_token: token, invites: [...a.invites, invite] });
          return json(201, invite);
        }
        case "get /v1/app/applicants/{id}/assessments": {
          if (!o.assessments.wired) return json(200, page([]));
          const mine = [
            ...(
              await store.list<StoredAssessment>(workspacePartition(w.id), "assessment#")
            ).values(),
          ]
            .filter((x) => x.applicant_id === a.id)
            .sort((x, y) => y.version - x.version);
          return json(200, page(mine.map((x) => toSummary(x, x.output, x.request))));
        }
        case "post /v1/app/applicants/{id}/assessments": {
          if (!o.assessments.wired) return error(501, "assessment_not_wired", NOT_WIRED_MESSAGE);
          const token = typeof a.portal_token === "string" ? a.portal_token : null;
          const p = token ? await getPortal(token) : null;
          if (!p || !p.scenario || (p.step !== "finances" && p.step !== "done"))
            return error(409, "no_data_shared", "The applicant hasn't shared sandbox data yet");
          const result = await o.assessments.assess({
            workspace_id: w.id,
            applicant_id: a.id,
            scenario: p.scenario,
          });
          if (!result) return error(501, "assessment_not_wired", NOT_WIRED_MESSAGE);
          const earlier = await store.list<StoredAssessment>(
            workspacePartition(w.id),
            "assessment#",
          );
          const version = [...earlier.values()].filter((x) => x.applicant_id === a.id).length + 1;
          const asmId = `asm_${hex(8)}`;
          const stored: StoredAssessment = {
            id: asmId,
            applicant_id: a.id,
            version,
            scenario: p.scenario,
            set_applicant_id: result.set_applicant_id,
            output_sha256: sha256(JSON.stringify(result.output)),
            created_at: iso(now()),
            request: result.request,
            output: result.output,
          };
          await store.put(workspacePartition(w.id), `assessment#${asmId}`, stored);
          await saveApplicant(w.id, { ...a, status: "assessed", latest_assessment_id: asmId });
          return json(202, toSummary(stored, result.output, result.request));
        }
        case "get /v1/app/applicants/{id}/requests":
          return json(200, { items: [] });
        case "get /v1/app/applicants/{id}/timeline":
          return json(200, page([]));
        default:
          return notInDemo();
      }
    }
    if (template === "/v1/app/assessments/{id}/report.pdf")
      return error(
        501,
        "not_available_in_demo",
        "The credit-file PDF is not available in this demo: no PDF generator exists yet",
      );
    if (template.startsWith("/v1/app/assessments/{id}")) {
      if (!o.assessments.wired) return error(501, "assessment_not_wired", NOT_WIRED_MESSAGE);
      const found = await store.get<StoredAssessment>(workspacePartition(w.id), `assessment#${id}`);
      if (!found) return notFound();
      // Contract 1.11.0 (D65, SIG-82 40818, 2): the mapping, read from the stored output.
      if (method === "get" && template === "/v1/app/assessments/{id}")
        return json(200, toAssessment(found, found.output, found.request));
      if (method === "get" && template === "/v1/app/assessments/{id}/affordability/trace")
        return json(200, toTrace(found.output));
      if (template === "/v1/app/assessments/{id}/signals/{signalId}/evidence")
        return error(501, "evidence_not_built", EVIDENCE_NOT_BUILT);
    }
    return notInDemo();
  }

  async function portal(
    method: string,
    template: string,
    token: string,
    body: Json,
    req: DemoRequest,
  ): Promise<DemoResponse> {
    const found = await getPortal(token);
    if (!found) return notFound();
    const w = workspaceById(found.workspace_id);
    if (!w) return notFound();
    if (found.expires_at <= now() && found.step === "welcome")
      return error(410, "invite_expired", "This link has expired; ask the lender for a new one");
    const p = await advance(token, found);
    const key = `${method} ${template}`;
    if (p.step === "withdrawn" && key !== "get /v1/portal/{token}")
      return error(409, "grant_revoked", "Consent was withdrawn; ask the lender for a new link");
    switch (key) {
      case "get /v1/portal/{token}":
        return json(200, {
          lender_name: w.name,
          lender_logo_url: null,
          shared_data: ["Account details", "Balances", "Transactions for the last 12 months"],
          purpose: "To assess your loan application (demo stage: synthetic sandbox data only)",
          step: p.step,
        });
      case "post /v1/portal/{token}/connect": {
        const back =
          req.headers.origin && DEMO_ORIGINS.includes(req.headers.origin)
            ? req.headers.origin
            : p.return_origin;
        await savePortal(token, {
          ...p,
          step: p.step === "welcome" ? "progress" : p.step,
          return_origin: back,
        });
        if (p.step === "welcome") await setApplicantStatus(p, "connecting");
        return json(200, { url: `https://${req.host}/demo/consent/${token}` });
      }
      case "get /v1/portal/{token}/financial-position":
        return json(
          200,
          p.position ?? {
            household_earners: null,
            assets: [],
            liabilities: [],
            repayments: [],
            income: [],
            expenses: [],
          },
        );
      case "put /v1/portal/{token}/financial-position": {
        const lists = POSITION_LISTS.every(
          (k) => Array.isArray(body[k]) && (body[k] as unknown[]).every((r) => record(r) === r),
        );
        const earners = body.household_earners;
        const earnersOk =
          earners === undefined ||
          earners === null ||
          (Number.isInteger(earners) && Number(earners) >= 1);
        if (!lists || !earnersOk)
          return error(
            400,
            "invalid_parameter",
            "A financial position needs assets, liabilities, repayments, income and expenses as lists, and household_earners of at least 1 or null",
          );
        const position: Json = {};
        if ("household_earners" in body) position.household_earners = earners;
        for (const k of POSITION_LISTS) position[k] = body[k];
        await savePortal(token, { ...p, position, step: p.step === "finances" ? "done" : p.step });
        return json(200, position);
      }
      case "post /v1/portal/{token}/withdraw":
        await savePortal(token, { ...p, step: "withdrawn" });
        await setApplicantStatus(p, "closed", { grant_revoked: true });
        return json(200, { step: "withdrawn" });
      case "get /v1/portal/{token}/requests":
        return json(200, { items: [] });
      default:
        return notInDemo();
    }
  }

  async function consent(method: string, token: string, req: DemoRequest): Promise<DemoResponse> {
    const p = await getPortal(token);
    const html = (status: number, text: string): DemoResponse => ({
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${DEMO_ORIGINS.join(" ")}`,
      },
      body: text,
    });
    if (!p || p.step === "withdrawn") return html(404, consentPage({ kind: "unknown" }));
    const w = workspaceById(p.workspace_id);
    if (method === "get")
      return html(200, consentPage({ kind: "choose", lender: w?.name ?? "", token }));
    if (method !== "post") return html(405, consentPage({ kind: "unknown" }));
    const chosen = new URLSearchParams(req.body ?? "").get("scenario");
    const scenario = SANDBOX_SCENARIOS.find((s) => s.key === chosen)?.key;
    if (!scenario)
      return html(
        400,
        consentPage({
          kind: "choose",
          lender: w?.name ?? "",
          token,
          problem: "Choose one of the scenarios",
        }),
      );
    await savePortal(token, {
      ...p,
      step: p.step === "welcome" || p.step === "progress" ? "progress" : p.step,
      scenario,
      consent_at: now(),
    });
    await setApplicantStatus(p, "syncing");
    return {
      status: 303,
      headers: {
        location: `${p.return_origin}/connect/${token}/progress`,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
      body: "",
    };
  }

  /**
   * SIG-76 T3: the stored output's SHA-256, for the acceptance to compare with the frozen states.
   * Demo-only and outside the contract; signed in and scoped like /v1/app. The output itself never
   * leaves the store.
   */
  async function outputHash(req: DemoRequest, asmId: string): Promise<DemoResponse> {
    const t = bearerOf(req.headers);
    const u = t ? await o.verify(t) : null;
    if (!u)
      return error(401, "unauthenticated", "Sign in again: the session could not be verified");
    const k = memberOf(u);
    if (!k)
      return error(403, "not_a_demo_member", "This account is not a member of a demo workspace");
    const found = await store.get<StoredAssessment>(
      workspacePartition(DEMO_WORKSPACES[k].id),
      `assessment#${asmId}`,
    );
    if (!found) return notFound();
    return json(200, {
      assessment_id: found.id,
      scenario: found.scenario,
      set_applicant_id: found.set_applicant_id,
      output_sha256: found.output_sha256,
    });
  }

  return async (req: DemoRequest): Promise<DemoResponse> => {
    origin = req.headers.origin;
    const method = req.method.toLowerCase();
    const path = req.path;
    if (method === "options") return { status: 204, headers: cors(origin), body: "" };
    if (path === "/health" && method === "get")
      return json(200, await healthBody(o.config.commit, { assessmentWired: o.assessments.wired }));
    const hashMatch = /^\/demo\/assessments\/(asm_[a-z0-9]{16})\/output-sha256$/.exec(path);
    if (hashMatch && method === "get") return outputHash(req, hashMatch[1] as string);
    const consentMatch = /^\/demo\/consent\/(tok_[a-z0-9]{32})$/.exec(path);
    if (consentMatch) return consent(method, consentMatch[1] as string, req);
    if (path.startsWith("/demo/consent/")) return consent(method, "", req);

    let route: Route | undefined;
    let params: Record<string, string> = {};
    for (const r of routes) {
      const m = r.regex.exec(path);
      if (m) {
        route = r;
        params = { ...m.groups };
        break;
      }
    }
    if (!route || !(path.startsWith("/v1/app/") || path.startsWith("/v1/portal/")))
      return error(404, "not_found", "No such path");
    if (!route.methods.has(method)) return error(405, "method_not_allowed", "Method not allowed");
    let body: Json = {};
    if (req.body) {
      try {
        body = record(JSON.parse(req.body));
      } catch {
        return error(400, "invalid_json", "The request body is not JSON");
      }
    }

    if (path.startsWith("/v1/portal/"))
      return portal(method, route.template, params.token ?? "", body, req);

    const token = bearerOf(req.headers);
    const user = token ? await o.verify(token) : null;
    if (!user)
      return error(401, "unauthenticated", "Sign in again: the session could not be verified");
    const ws = memberOf(user);
    if (!ws)
      return error(403, "not_a_demo_member", "This account is not a member of a demo workspace");
    return app(DEMO_WORKSPACES[ws], user, method, route.template, params, body, req);
  };
}
