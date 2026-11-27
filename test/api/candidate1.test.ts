// SIG-82 candidate 1 (mandate 40777, "The interface"; 40786 and 40802, 4; SIG-76 40801): the real
// assessApplicant (composition 1.2.0) wired behind src/api/assessment-port.ts, on the scenario the
// applicant chose at the sandbox consent. Each scenario's feed is the one SIG-76's in-process runs
// used, in its seeded order, so the hosted output is byte-identical to the frozen expected states
// (SIG-76 T3, by output_sha256; states file 19bab324...ece1). Nothing is hard-coded (SIG-76 T4).
// The contract mapping of the output waits for Colin's ruling (SIG-82 40805): until then the
// stored output is served only as its hash, on a demo-only route, and never to a lender response.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { assessApplicant } from "../../src/assessment/assess.js";
import { createDemoApp, SYNC_MS, type DemoRequest } from "../../src/api/app.js";
import { wiredPort } from "../../src/api/assessment-port.js";
import { demoConfigFrom } from "../../src/api/config.js";
import { MemoryStore } from "../../src/api/dynamo.js";
import { buildScenarioInputs, type ScenarioInputs } from "../../src/api/scenario-inputs.js";
import { DemoStore } from "../../src/api/store.js";
import { responseValidator } from "./contract.js";

const STATES = "research/preregistrations/SIG-76-expected-states.json";
const FROZEN_SHA = "19bab324b0e5ec30985dde8d475c0a5b583a148d0c438f9cd4b1871fc915ece1";
type States = { scenarios: Record<string, { applicant_id: string; output_sha256: string }> };
const states = JSON.parse(readFileSync(STATES, "utf8")) as States;
const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const KEYS = ["C", "A", "B", "D", "D2"] as const;
// 40805, 2.2: C has 2 evidence reasons; B and D 1 mover; D2 3 movers; A none.
const REASONS_TOTAL: Record<string, number> = { A: 0, B: 1, C: 2, D: 1, D2: 3 };

let inputs: ScenarioInputs;
beforeAll(() => {
  inputs = buildScenarioInputs();
}, 120_000);

describe("the frozen states file is the one the architect froze", () => {
  it("has SHA-256 19bab324...ece1", () => {
    expect(createHash("sha256").update(readFileSync(STATES)).digest("hex")).toBe(FROZEN_SHA);
  });
});

describe("the scenario inputs are SIG-76's, in their seeded order", () => {
  it("selects A, B, C, D and D2 by the pre-registered applicant IDs", () => {
    for (const k of KEYS) expect(inputs[k].applicant_id).toBe(states.scenarios[k]?.applicant_id);
  });

  it("carries the pre-registered request unchanged", () => {
    const prereg = JSON.parse(readFileSync("research/preregistrations/SIG-76.json", "utf8")) as {
      requests: { request: unknown };
    };
    for (const k of KEYS) expect(inputs[k].request).toEqual(prereg.requests.request);
  });

  it("is a plain JSON value, so it survives the build's round trip byte for byte", () => {
    const round = JSON.parse(JSON.stringify(inputs)) as ScenarioInputs;
    for (const k of KEYS) expect(sha(round[k])).toBe(sha(inputs[k]));
  });
});

describe("T3: assessApplicant on each input gives the frozen output", () => {
  it.each(KEYS)(
    "scenario %s",
    async (k) => {
      const out = await assessApplicant(JSON.parse(JSON.stringify(inputs[k])));
      expect(sha(out)).toBe(states.scenarios[k]?.output_sha256);
    },
    60_000,
  );
});

describe("T3 through the hosted path: consent, assess, read back the hash", () => {
  const TOKENS: Record<string, { sub: string; email: string }> = {
    "token-a": { sub: "user-a", email: "a@demo.test" },
    "token-b": { sub: "user-b", email: "b@demo.test" },
  };
  let clock = 1_800_000_000_000;
  const make = () =>
    createDemoApp({
      config: demoConfigFrom({
        ENRICH_PATH: "local",
        DEMO_COMMIT: "0123456789abcdef0123456789abcdef01234567",
        DEMO_MEMBERS: "a@demo.test:A,b@demo.test:B",
      }),
      store: new DemoStore(new MemoryStore()),
      verify: (t) => Promise.resolve(TOKENS[t] ?? null),
      now: () => clock,
      assessments: wiredPort(inputs),
    });
  const callOn =
    (app: ReturnType<typeof make>) =>
    async (
      method: string,
      path: string,
      o: { token?: string; body?: unknown; form?: string } = {},
    ) => {
      const headers: Record<string, string> = {};
      if (o.token) headers.authorization = `Bearer ${o.token}`;
      const req: DemoRequest = {
        method,
        path,
        headers,
        host: "x.execute-api.ap-southeast-2.amazonaws.com",
        ...(o.form !== undefined ? { body: o.form } : {}),
        ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
      };
      const res = await app(req);
      return {
        ...res,
        json: (res.headers["content-type"] ?? "").includes("json")
          ? (JSON.parse(res.body) as Record<string, unknown>)
          : null,
      };
    };

  async function journey(call: ReturnType<typeof callOn>, scenario: string) {
    const a = await call("POST", "/v1/app/applicants", {
      token: "token-a",
      body: { name: `Scenario ${scenario}`, product_type: "personal" },
    });
    const id = String(a.json?.id);
    const inv = await call("POST", `/v1/app/applicants/${id}/invites`, {
      token: "token-a",
      body: { channel: "email" },
    });
    const token = String(inv.json?.portal_url).split("/connect/")[1] as string;
    await call("POST", `/v1/portal/${token}/connect`);
    return {
      id,
      token,
      consent: () => call("POST", `/demo/consent/${token}`, { form: `scenario=${scenario}` }),
    };
  }

  it("refuses to assess before the applicant has shared data", async () => {
    const call = callOn(make());
    const { id } = await journey(call, "A");
    const res = await call("POST", `/v1/app/applicants/${id}/assessments`, { token: "token-a" });
    expect(res.status).toBe(409);
    expect((res.json?.error as { code: string }).code).toBe("no_data_shared");
  });

  it.each(KEYS)(
    "scenario %s: the hosted output's SHA-256 is the frozen one",
    async (k) => {
      const call = callOn(make());
      const j = await journey(call, k);
      expect((await j.consent()).status).toBe(303);
      clock += SYNC_MS;
      await call("GET", `/v1/portal/${j.token}`);
      const run = await call("POST", `/v1/app/applicants/${j.id}/assessments`, {
        token: "token-a",
      });
      expect(run.status).toBe(202);
      const asm = String(run.json?.id);
      const read = await call("GET", `/demo/assessments/${asm}/output-sha256`, {
        token: "token-a",
      });
      expect(read.status).toBe(200);
      expect(read.json).toEqual({
        assessment_id: asm,
        scenario: k,
        set_applicant_id: states.scenarios[k]?.applicant_id,
        output_sha256: states.scenarios[k]?.output_sha256,
      });
      // Tenant B can't read it (T5), and the raw output never reaches a lender response.
      expect(
        (await call("GET", `/demo/assessments/${asm}/output-sha256`, { token: "token-b" })).status,
      ).toBe(404);
      expect(run.body).not.toMatch(/"enrich"|"transactions"|"taxonomy"/);

      // Contract 1.11.0 (D65, 40818): the mapped assessment, its trace and the applicant's list,
      // each valid against the contract; tenant B gets 404 on each (T5).
      const getA = await call("GET", `/v1/app/assessments/${asm}`, { token: "token-a" });
      expect(getA.status).toBe(200);
      expect(
        responseValidator("/v1/app/assessments/{id}", "get", 200)(getA.json).errors,
      ).toBeNull();
      expect(getA.json).toMatchObject({
        id: asm,
        applicant_id: j.id,
        version: 1,
        status: "complete",
      });
      const rollup = getA.json?.rollup as { state?: string; reasons_total: number };
      expect(rollup.state).toBe(k === "C" ? "unverified" : undefined);
      expect(rollup.reasons_total).toBe(REASONS_TOTAL[k]);
      const trace = await call("GET", `/v1/app/assessments/${asm}/affordability/trace`, {
        token: "token-a",
      });
      expect(trace.status).toBe(200);
      expect(
        responseValidator("/v1/app/assessments/{id}/affordability/trace", "get", 200)(trace.json)
          .errors,
      ).toBeNull();
      const list = await call("GET", `/v1/app/applicants/${j.id}/assessments`, {
        token: "token-a",
      });
      expect(list.status).toBe(200);
      expect(
        responseValidator("/v1/app/applicants/{id}/assessments", "get", 200)(list.json).errors,
      ).toBeNull();
      expect(list.json?.items).toEqual([
        {
          id: asm,
          applicant_id: j.id,
          version: 1,
          status: "complete",
          rollup_state: k === "C" ? "unverified" : null,
          data_as_of: getA.json?.data_as_of,
          evidence_checks: getA.json?.evidence_checks,
        },
      ]);
      for (const p of [
        `/v1/app/assessments/${asm}`,
        `/v1/app/assessments/${asm}/affordability/trace`,
        `/v1/app/assessments/${asm}/signals/INC-01/evidence`,
        `/v1/app/assessments/${asm}/report.pdf`,
        `/v1/app/applicants/${j.id}/assessments`,
      ])
        expect((await call("GET", p, { token: "token-b" })).status, p).toBe(404);
      // The masked evidence endpoint (40805, 2.7) isn't built yet: a labelled 501, never a sample.
      const ev = await call("GET", `/v1/app/assessments/${asm}/signals/INC-01/evidence`, {
        token: "token-a",
      });
      expect(ev.status).toBe(501);
      expect((ev.json?.error as { code: string }).code).toBe("evidence_not_built");
      const pdf = await call("GET", `/v1/app/assessments/${asm}/report.pdf`, { token: "token-a" });
      expect(pdf.status).toBe(501);
      expect((pdf.json?.error as { message: string }).message).toMatch(
        /not available in this demo/i,
      );
      for (const b of [getA.body, trace.body, list.body]) {
        expect(b).not.toMatch(/"transactions"|"taxonomy"|approv|declin/i);
      }
    },
    60_000,
  );

  it("a rerun is version 2, listed newest first", async () => {
    const call = callOn(make());
    const j = await journey(call, "B");
    await j.consent();
    clock += SYNC_MS;
    await call("GET", `/v1/portal/${j.token}`);
    const one = await call("POST", `/v1/app/applicants/${j.id}/assessments`, { token: "token-a" });
    const two = await call("POST", `/v1/app/applicants/${j.id}/assessments`, { token: "token-a" });
    expect([one.json?.version, two.json?.version]).toEqual([1, 2]);
    const list = await call("GET", `/v1/app/applicants/${j.id}/assessments`, { token: "token-a" });
    expect((list.json?.items as { version: number }[]).map((x) => x.version)).toEqual([2, 1]);
  }, 60_000);

  it("health says the assessment is wired", async () => {
    const call = callOn(make());
    const h = await call("GET", "/health");
    expect(h.json?.assessment_wired).toBe(true);
  });
});
