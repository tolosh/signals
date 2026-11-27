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

const STATES = "research/preregistrations/SIG-76-expected-states.json";
const FROZEN_SHA = "19bab324b0e5ec30985dde8d475c0a5b583a148d0c438f9cd4b1871fc915ece1";
type States = { scenarios: Record<string, { applicant_id: string; output_sha256: string }> };
const states = JSON.parse(readFileSync(STATES, "utf8")) as States;
const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const KEYS = ["C", "A", "B", "D", "D2"] as const;

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
    },
    60_000,
  );

  it("health says the assessment is wired", async () => {
    const call = callOn(make());
    const h = await call("GET", "/health");
    expect(h.json?.assessment_wired).toBe(true);
  });
});
