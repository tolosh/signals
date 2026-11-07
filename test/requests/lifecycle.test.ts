// SIG-48 section 6 tests (the slice ruled 7 November 2026): the "income not found" request
// lifecycle (D24). Persistence, RLS, encryption at rest, re-sync and SES are not built yet; T5
// is tested at the service layer with an in-memory store scoped by workspace.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  applyEvidence,
  assessEvidence,
  evidenceRollup,
  type EvidenceCheck,
} from "../../src/engines/evidence/index.js";
import {
  EvidenceRequests,
  NotFound,
  InvalidTransition,
  REASON_CODES,
} from "../../src/requests/lifecycle.js";
import { FULL, STUBS, applicant, input } from "../engines/evidence/helpers.js";

const T0 = "2026-11-07T01:00:00.000Z";
const service = () => {
  let n = 0;
  return new EvidenceRequests({ now: () => T0, id: () => `req_${String(++n).padStart(2, "0")}` });
};
const unshared = applicant(
  { ...FULL, coverage: { salary_account_shared: false } },
  "sig48-unshared",
);
const shared = applicant(FULL, "sig48-shared");
const checksOf = (a: typeof shared) => assessEvidence(input(a)).checks;
const NOTE = "I am paid in cash by my uncle, ref 4471-SECRET";

describe("T1 EQ-01 fail opens exactly one income_not_found request; EQ-01 pass opens none", () => {
  it("opens one request for a failed EQ-01", () => {
    const svc = service();
    const checks = checksOf(unshared);
    expect(checks.find((c) => c.id === "EQ-01")?.result).toBe("fail");
    const r = svc.onAssessment("wks_A", { applicant_id: "apl_x", assessment_id: "asm_1", checks });
    expect(r).toMatchObject({ type: "income_not_found", status: "open", applicant_id: "apl_x" });
    expect(svc.list("wks_A", "apl_x")).toHaveLength(1);
  });

  it("is idempotent per assessment, and keeps one open request across later failed versions", () => {
    const svc = service();
    const checks = checksOf(unshared);
    const a = svc.onAssessment("wks_A", { applicant_id: "apl_x", assessment_id: "asm_1", checks });
    const b = svc.onAssessment("wks_A", { applicant_id: "apl_x", assessment_id: "asm_1", checks });
    const c = svc.onAssessment("wks_A", { applicant_id: "apl_x", assessment_id: "asm_2", checks });
    expect(b?.id).toBe(a?.id);
    expect(c?.id).toBe(a?.id);
    expect(svc.list("wks_A", "apl_x")).toHaveLength(1);
  });

  it("opens none for a passed EQ-01", () => {
    const svc = service();
    const r = svc.onAssessment("wks_A", {
      applicant_id: "apl_y",
      assessment_id: "asm_1",
      checks: checksOf(shared),
    });
    expect(r).toBeNull();
    expect(svc.list("wks_A", "apl_y")).toEqual([]);
  });
});

describe("T2 connect, then a new assessment that finds the salary (lifecycle only)", () => {
  it("connect sets connected; a later EQ-01 pass resolves the request", () => {
    const svc = service();
    const r = svc.onAssessment("wks_A", {
      applicant_id: "apl_x",
      assessment_id: "asm_1",
      checks: checksOf(unshared),
    });
    expect(svc.connect("wks_A", r?.id ?? "").status).toBe("connected");
    // The re-sync itself is WP5; here the new version's checks are supplied directly.
    svc.onAssessment("wks_A", {
      applicant_id: "apl_x",
      assessment_id: "asm_2",
      checks: checksOf(shared),
    });
    expect(svc.get("wks_A", r?.id ?? "").status).toBe("resolved");
  });
});

describe("T3 an explanation changes no ratio, signal state or roll-up", () => {
  it("sets explained and review required with the reason; engine outputs are byte-identical", () => {
    const svc = service();
    const ctx = assessEvidence(input(unshared));
    const before = JSON.stringify({
      checks: ctx.checks,
      signals: applyEvidence(STUBS, ctx),
      rollup: evidenceRollup(ctx),
    });
    const r = svc.onAssessment("wks_A", {
      applicant_id: "apl_x",
      assessment_id: "asm_1",
      checks: ctx.checks,
    });
    const { request, review } = svc.explain("wks_A", r?.id ?? "", {
      reason_code: "paid_in_cash",
      note: NOTE,
    });
    expect(request.status).toBe("explained");
    expect(review).toEqual({
      required: true,
      reasons: [
        "The applicant explained why their income is missing: paid in cash. A person must review it.",
      ],
    });
    const ctx2 = assessEvidence(input(unshared));
    const after = JSON.stringify({
      checks: ctx2.checks,
      signals: applyEvidence(STUBS, ctx2),
      rollup: evidenceRollup(ctx2),
    });
    expect(after).toBe(before);
    expect(ctx2.checks.find((c: EvidenceCheck) => c.id === "EQ-01")?.result).toBe("fail");
    expect(evidenceRollup(ctx2).state).toBe("unverified");
  });

  it("refuses an unknown reason code and a note over 500 characters", () => {
    const svc = service();
    const r = svc.onAssessment("wks_A", {
      applicant_id: "apl_x",
      assessment_id: "asm_1",
      checks: checksOf(unshared),
    });
    expect(() =>
      svc.explain("wks_A", r?.id ?? "", { reason_code: "lottery_win" as never }),
    ).toThrow(/reason_code/);
    expect(() =>
      svc.explain("wks_A", r?.id ?? "", { reason_code: "other", note: "x".repeat(501) }),
    ).toThrow(/500/);
    expect(REASON_CODES).toEqual([
      "paid_in_cash",
      "new_job_no_pay_yet",
      "paid_to_another_account",
      "self_employed_irregular",
      "on_leave",
      "other",
    ]);
  });
});

describe("T4 the note never reaches logs or any engine input", () => {
  it("is never logged, serialised or inspected; only the API view reveals it", () => {
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        logged.push(
          args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 10 }))).join(" "),
        );
      }),
    );
    const svc = service();
    const r = svc.onAssessment("wks_A", {
      applicant_id: "apl_x",
      assessment_id: "asm_1",
      checks: checksOf(unshared),
    });
    const { request } = svc.explain("wks_A", r?.id ?? "", { reason_code: "other", note: NOTE });
    console.log(request);
    console.log(svc.list("wks_A", "apl_x"));
    for (const s of spies) s.mockRestore();
    expect(logged.join("\n")).not.toContain("4471-SECRET");
    expect(JSON.stringify(request)).not.toContain("4471-SECRET");
    expect(inspect(request, { depth: 10, showHidden: true })).not.toContain("4471-SECRET");
    expect(String(request.response?.note)).not.toContain("4471-SECRET");
    // The API view is the one place it is revealed, for the lender's reviewer and the applicant.
    expect(svc.toApi(request).response?.note).toBe(NOTE);
  });

  it("no engine or research module imports the request module (static scan)", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? files(join(dir, e.name))
          : e.name.endsWith(".ts")
            ? [join(dir, e.name)]
            : [],
      );
    const offenders = [...files("src/engines"), ...files("src/research")].filter((f) =>
      /from\s+["'][^"']*requests\//.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("T5 workspace B cannot read workspace A's requests", () => {
  it("refuses get, list and every transition across workspaces", () => {
    const svc = service();
    const r = svc.onAssessment("wks_A", {
      applicant_id: "apl_x",
      assessment_id: "asm_1",
      checks: checksOf(unshared),
    });
    const id = r?.id ?? "";
    expect(svc.list("wks_B", "apl_x")).toEqual([]);
    expect(() => svc.get("wks_B", id)).toThrow(NotFound);
    expect(() => svc.connect("wks_B", id)).toThrow(NotFound);
    expect(() => svc.explain("wks_B", id, { reason_code: "other" })).toThrow(NotFound);
    expect(() => svc.close("wks_B", id)).toThrow(NotFound);
    expect(svc.get("wks_A", id).status).toBe("open");
  });
});

describe("transitions", () => {
  it("close and resend; a closed request accepts nothing further", () => {
    const svc = service();
    const r = svc.onAssessment("wks_A", {
      applicant_id: "apl_x",
      assessment_id: "asm_1",
      checks: checksOf(unshared),
    });
    const id = r?.id ?? "";
    expect(svc.resend("wks_A", id)).toMatchObject({ status: "open", resent_at: T0 });
    expect(svc.close("wks_A", id).status).toBe("closed");
    expect(() => svc.explain("wks_A", id, { reason_code: "other" })).toThrow(InvalidTransition);
    expect(() => svc.connect("wks_A", id)).toThrow(InvalidTransition);
  });

  it("after a close, a later failed EQ-01 opens a new request", () => {
    const svc = service();
    const checks = checksOf(unshared);
    const first = svc.onAssessment("wks_A", {
      applicant_id: "apl_x",
      assessment_id: "asm_1",
      checks,
    });
    svc.close("wks_A", first?.id ?? "");
    const second = svc.onAssessment("wks_A", {
      applicant_id: "apl_x",
      assessment_id: "asm_2",
      checks,
    });
    expect(second?.id).not.toBe(first?.id);
    expect(second?.status).toBe("open");
  });
});

describe("T7 negative control: an applicant with salary shared never sees a request", () => {
  it("opens none across several versions", () => {
    const svc = service();
    for (const v of ["asm_1", "asm_2", "asm_3"])
      expect(
        svc.onAssessment("wks_A", {
          applicant_id: "apl_y",
          assessment_id: v,
          checks: checksOf(shared),
        }),
      ).toBeNull();
    expect(svc.list("wks_A", "apl_y")).toEqual([]);
  });
});
