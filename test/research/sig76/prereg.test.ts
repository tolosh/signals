// SIG-76: the demo's pre-registration, design and seeds only (ruling 40720). Written before the
// selection module and the pre-registration file. The scenarios are chosen from set v2.3 by ground
// truth only, never by running an engine, and no expected state is computed until the Enrich build
// pinned after the ENR-28 fix exists (rulings 40719 and 40720).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { generateSetV23 } from "../../../src/research/generator/v23/index.js";

const PREREG = "research/preregistrations/SIG-76.json";
const MODULE = "../../../src/research/sig76/scenarios.js";
const ASSESS = "../../../src/assessment/assess.js";
type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (): Promise<Mod> => {
  try {
    return (await import(/* @vite-ignore */ MODULE)) as Mod;
  } catch {
    return {};
  }
};
const prereg = () => (existsSync(PREREG) ? JSON.parse(readFileSync(PREREG, "utf8")) : {}) as Mod;

let set: unknown[];
let m: Mod;
beforeAll(async () => {
  set = generateSetV23(623);
  m = await load();
}, 300_000);

describe("SIG-76 pre-registration: scenarios A, B and C, chosen by ground truth", () => {
  it("the selection is a pure function of set v2.3's ground truth", () => {
    expect(typeof m.selectScenarios).toBe("function");
    const a = m.selectScenarios?.(set);
    const b = m.selectScenarios?.(generateSetV23(623));
    expect(a).toEqual(b);
  }, 120_000); // it generates set v2.3 a second time, which takes longer under full-suite load
  it("the pre-registration records the same applicants the rules select", () => {
    const p = prereg();
    const s = m.selectScenarios?.(set) as Record<string, { applicant_id: string }> | undefined;
    expect(s).toBeDefined();
    for (const k of ["A", "B", "C"])
      expect(p.scenarios?.[k]?.applicant_id, k).toBe(s?.[k]?.applicant_id);
  });
  it("each selected applicant has the truth its scenario names", () => {
    type A = {
      truth: {
        applicant_id: string;
        tags: string[];
        surplus_monthly: number;
        coverage: { salary_account_shared: boolean };
        liabilities: { items: { type: string; declared: boolean }[] };
        v2: { liabilities: { declared_as: string | null; repayment_channel: string }[] };
      };
    };
    const s = m.selectScenarios?.(set) as Record<string, { applicant_id: string }> | undefined;
    const by = (id?: string) => (set as A[]).find((x) => x.truth.applicant_id === id)?.truth;
    const a = by(s?.A?.applicant_id);
    const b = by(s?.B?.applicant_id);
    const c = by(s?.C?.applicant_id);
    expect(a?.coverage.salary_account_shared).toBe(true);
    expect(a?.liabilities.items.every((l) => l.declared)).toBe(true);
    expect(a?.tags).toContain("salaried-fixed");
    expect(b?.coverage.salary_account_shared).toBe(true);
    expect(
      b?.v2.liabilities.some((l) => l.declared_as === null && l.repayment_channel !== "BPAY"),
    ).toBe(true);
    expect((b?.surplus_monthly ?? Infinity) < (a?.surplus_monthly ?? -Infinity)).toBe(true);
    expect(c?.coverage.salary_account_shared).toBe(false);
  });
  it("it names set v2.3 by seed and hash, and the negative paths", () => {
    const p = prereg();
    const manifest = JSON.parse(
      readFileSync("research/datasets/synthetic-v2.3.manifest.json", "utf8"),
    ) as { seed: number; set_sha256: string };
    expect(p.data?.sets).toEqual(["synthetic-v2.3"]);
    expect(p.data?.seed).toBe(manifest.seed);
    expect(p.data?.set_sha256).toBe(manifest.set_sha256);
    expect(Object.keys(p.negative_paths ?? {}).sort()).toEqual([
      "billing_out_of_scope",
      "cross_tenant_read",
      "expired_invite",
      "revoked_grant",
      "sensitive_probe",
    ]);
    expect(p.negative_control?.scenario).toBe("C");
    expect(p.perturbation?.scenario).toBe("A");
  });
  // Until 27 November this test asserted that no expected state was computed (ruling 40720). Ruling
  // 40732 ordered them computed on the pinned build, through assessApplicant; they now are.
  it("enrich_build is the pinned 1.8.0 build (vendor/moroku-enrich/pin.json)", () => {
    const p = prereg();
    const pin = JSON.parse(readFileSync("vendor/moroku-enrich/pin.json", "utf8")) as Mod;
    expect(p.enrich_build?.moroku_enrich_commit).toBe(pin.moroku_enrich_commit);
    expect(p.enrich_build?.engine_version).toBe("1.8.0");
    expect(p.enrich_build?.dist_index_sha256).toBe(pin.dist_index_sha256);
    expect(p.enrich_build?.dist_tree_sha256).toBe(pin.dist_tree_sha256_published);
    expect(p.enrich_build?.bundle_sha256).toBe(pin.bundle_sha256);
  });
  it("the expected-states file is the one the pre-registration names, by SHA-256", () => {
    const p = prereg();
    const file = String(p.expected_states?.file);
    expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe(
      p.expected_states?.file_sha256,
    );
  });
  it("D28: assessApplicant reproduces each scenario's expected output, byte for byte", async () => {
    const p = prereg();
    const { assessApplicant } = (await import(/* @vite-ignore */ ASSESS)) as Mod;
    type R = {
      truth: { applicant_id: string; feed_type: string };
      application: unknown;
      feed: {
        accounts: {
          account: unknown;
          detail?: unknown;
          transactions?: unknown[];
          transactionList?: { data: { transactions: unknown[] } };
        }[];
      };
    };
    for (const k of ["A", "B", "C"]) {
      const id = p.scenarios[k].applicant_id as string;
      const a = (set as R[]).find((x) => x.truth.applicant_id === id) as R;
      const out = await assessApplicant({
        applicant_id: id,
        feed_type: a.truth.feed_type,
        application: a.application,
        feed: {
          accounts: a.feed.accounts.map((acc) => ({
            account: acc.account,
            ...(acc.detail ? { detail: acc.detail } : {}),
            transactions: acc.transactions ?? acc.transactionList?.data.transactions ?? [],
          })),
        },
        request: p.requests.request,
      });
      expect(createHash("sha256").update(JSON.stringify(out)).digest("hex"), k).toBe(
        p.expected_states.output_sha256[k],
      );
    }
  }, 300_000);
  it("the negative control, C, is unverified in the expected states", () => {
    const e = JSON.parse(readFileSync(String(prereg().expected_states?.file), "utf8")) as Mod;
    expect(e.negative_control).toEqual({ scenario: "C", rollup_evidence: "unverified" });
    expect(e.order_run?.[0]).toBe("C");
  });
});
