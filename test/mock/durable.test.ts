// SIG-51 (ruling of 7 November 2026, ADR 0005): the mock keeps its state in DynamoDB, so a write
// survives a reload on any Lambda container. Runs against the local server, or the hosted mock
// with npm run test:hosted. Each run uses its own scenario (X-Mock-Scenario), so Lovable's default state
// is never touched, and starts from POST /mock-reset.
import type { Server } from "node:http";
import { hostedBase } from "./target.js";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMockServer } from "../../src/mock/server.js";

const SCENARIO = `test-${process.pid}-${Date.now()}`;
const PARALLEL = 8;
const SLOW = 30_000;

let server: Server | undefined;
let base: string;
beforeAll(async () => {
  const hosted = hostedBase();
  if (hosted) {
    base = hosted;
    return;
  }
  server = createMockServer();
  const local = server;
  await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(local.address() as AddressInfo).port}`;
});
afterAll(() => {
  server?.close();
  server?.closeAllConnections();
});

const headers = (extra: Record<string, string> = {}) => ({ "x-mock-scenario": SCENARIO, ...extra });
const call = (method: string, path: string, body?: unknown) =>
  fetch(base + path, {
    method,
    headers: headers(body === undefined ? {} : { "content-type": "application/json" }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async <T>(res: Response): Promise<T> => {
  expect(res.status).toBeLessThan(300);
  return (await res.json()) as T;
};
/** The same read, PARALLEL times at once: every one must answer 200 with the same body. */
async function parallel<T>(path: string): Promise<T[]> {
  const all = await Promise.all(Array.from({ length: PARALLEL }, () => call("GET", path)));
  expect(all.map((r) => r.status)).toEqual(Array(PARALLEL).fill(200));
  return Promise.all(all.map((r) => r.json() as Promise<T>));
}

type Req = { id: string; status: string; resent_at: string | null };
type Items = { items: Req[] };
const PORTAL = "/v1/portal/tok_01/requests";
const APP = "/v1/app/applicants/apl_02/requests";

beforeEach(async () => {
  expect((await call("POST", "/mock-reset")).status).toBe(204);
}, SLOW);

describe("SIG-51 durability: req_01 explain, resend and close survive a reload", () => {
  const appStatus = async () => {
    const reads = await parallel<Items>(APP);
    return reads.map((r) => r.items.find((x) => x.id === "req_01"));
  };

  it(
    "resend, then explain, then close: each holds across 8 parallel reads on both sides",
    async () => {
      expect((await appStatus()).map((r) => r?.status)).toEqual(Array(PARALLEL).fill("open"));

      await json(await call("POST", "/v1/app/applicants/apl_02/requests/req_01/resend"));
      const resent = await appStatus();
      expect(resent.every((r) => r?.status === "open" && r.resent_at !== null)).toBe(true);
      expect(new Set(resent.map((r) => r?.resent_at)).size).toBe(1);

      await json(
        await call("POST", "/v1/portal/tok_01/requests/req_01/explain", {
          reason_code: "new_job_no_pay_yet",
          note: "Started on 1 November",
        }),
      );
      expect((await appStatus()).map((r) => r?.status)).toEqual(Array(PARALLEL).fill("explained"));
      // The portal lists open and connected requests only, so an explained one has left it.
      const portal = await parallel<Items>(PORTAL);
      expect(portal.every((p) => !p.items.some((x) => x.id === "req_01"))).toBe(true);

      await json(await call("POST", "/v1/app/applicants/apl_02/requests/req_01/close"));
      expect((await appStatus()).map((r) => r?.status)).toEqual(Array(PARALLEL).fill("closed"));
    },
    SLOW,
  );

  it(
    "the reset route restores the seeded open request",
    async () => {
      await json(await call("POST", "/v1/app/applicants/apl_02/requests/req_01/close"));
      expect((await call("POST", "/mock-reset")).status).toBe(204);
      expect((await appStatus()).map((r) => r?.status)).toEqual(Array(PARALLEL).fill("open"));
    },
    SLOW,
  );
});

describe("SIG-51 review fixtures (added scope, 7 November)", () => {
  type Review = { review?: { required: boolean; reasons: string[] } };

  it(
    "asm_unverified carries review required once req_01 is explained, on every read",
    async () => {
      const before = await json<Review>(await call("GET", "/v1/app/assessments/asm_unverified"));
      expect(before.review).toEqual({ required: false, reasons: [] });
      await json(
        await call("POST", "/v1/portal/tok_01/requests/req_01/explain", {
          reason_code: "paid_in_cash",
        }),
      );
      const after = await parallel<Review>("/v1/app/assessments/asm_unverified");
      for (const a of after) {
        expect(a.review?.required).toBe(true);
        expect(a.review?.reasons.length).toBeGreaterThan(0);
        expect(a.review?.reasons[0]).toMatch(/paid in cash/);
      }
    },
    SLOW,
  );

  it("the counterpart, asm_evidence, carries review not required, with no reasons", async () => {
    const a = await json<Review>(await call("GET", "/v1/app/assessments/asm_evidence"));
    expect(a.review).toEqual({ required: false, reasons: [] });
  });
});

describe("SIG-51 SIG-50's portal state is kept", () => {
  type Session = { step: string };
  type Position = { household_earners?: number | null; assets: { amount: number }[] };

  it(
    "a financial-position PUT is what the next GETs return",
    async () => {
      const seeded = await json<Position & Record<string, unknown>>(
        await call("GET", "/v1/portal/tok_01/financial-position"),
      );
      const edited = {
        ...seeded,
        household_earners: 1,
        assets: [
          { type: "savings", provider: "Synthetic Bank", amount: 42000, source: "applicant" },
        ],
      };
      const put = await json<Position>(
        await call("PUT", "/v1/portal/tok_01/financial-position", edited),
      );
      expect(put).toEqual(edited);
      for (const got of await parallel<Position>("/v1/portal/tok_01/financial-position"))
        expect(got).toEqual(edited);
    },
    SLOW,
  );

  it("a financial-position PUT that isn't a financial position is refused", async () => {
    const res = await call("PUT", "/v1/portal/tok_01/financial-position", { assets: "none" });
    expect(res.status).toBe(400);
  });

  it(
    "session progress: welcome, then progress after connect, then done after the finances",
    async () => {
      const step = async () => (await parallel<Session>("/v1/portal/tok_01")).map((s) => s.step);
      expect(await step()).toEqual(Array(PARALLEL).fill("welcome"));
      await json(await call("POST", "/v1/portal/tok_01/connect"));
      expect(await step()).toEqual(Array(PARALLEL).fill("progress"));
      const seeded = await json<object>(await call("GET", "/v1/portal/tok_01/financial-position"));
      await json(await call("PUT", "/v1/portal/tok_01/financial-position", seeded));
      expect(await step()).toEqual(Array(PARALLEL).fill("done"));
    },
    SLOW,
  );

  it(
    "withdraw holds: the session stays withdrawn on every read",
    async () => {
      const w = await json<Session>(await call("POST", "/v1/portal/tok_01/withdraw"));
      expect(w.step).toBe("withdrawn");
      for (const s of await parallel<Session>("/v1/portal/tok_01"))
        expect(s.step).toBe("withdrawn");
    },
    SLOW,
  );
});

describe("SIG-51 concurrency: no cap, so nothing is throttled", () => {
  it(
    "8 parallel requests to different endpoints all return 200",
    async () => {
      const paths = [
        "/v1/app/me",
        "/v1/app/applicants",
        "/v1/app/assessments/asm_01",
        "/v1/app/assessments/asm_income",
        "/v1/app/settings/policy/home",
        "/v1/app/benchmarks",
        APP,
        PORTAL,
      ];
      const all = await Promise.all(paths.map((p) => call("GET", p)));
      expect(all.map((r) => r.status)).toEqual(Array(paths.length).fill(200));
    },
    SLOW,
  );
});
