// SIG-51 (ruling of 7 November 2026, ADR 0005): the persistence layer behind the hosted mock.
// Each request restores the scenario's state from the table, and writes back only what changed,
// so no Lambda container serves stale state. An in-memory table stands in for DynamoDB here;
// wiping the mock's memory between requests stands in for a request reaching another container.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createPersistentHandler,
  MemoryStore,
  TTL_SECONDS,
  type PersistentHandler,
} from "../../src/mock/persist.js";
import { resetAllState } from "../../src/mock/state.js";

const NOW = Date.UTC(2026, 10, 7, 11, 0, 0);
let store: MemoryStore;
let handle: PersistentHandler;
beforeEach(() => {
  store = new MemoryStore();
  handle = createPersistentHandler(store, () => NOW);
  resetAllState();
});

const call = (method: string, path: string, scenario = "default", body?: unknown) =>
  handle({
    method,
    path,
    scenario,
    ...(body === undefined
      ? {}
      : { request: { body: Buffer.from(JSON.stringify(body)), contentType: "application/json" } }),
  });
const status = async (path: string, id: string, scenario = "default") => {
  const r = await call("GET", path, scenario);
  return (JSON.parse(r.body) as { items: { id: string; status: string }[] }).items.find(
    (x) => x.id === id,
  )?.status;
};
const APP = "/v1/app/applicants/apl_02/requests";

describe("state survives a request reaching another container", () => {
  it("a closed request stays closed after the mock's memory is wiped", async () => {
    expect((await call("POST", `${APP}/req_01/close`)).status).toBe(200);
    resetAllState();
    expect(await status(APP, "req_01")).toBe("closed");
  });

  it("a container holding old state still reads the latest write", async () => {
    // This container saw req_01 open; another container then closed it, writing the table.
    expect(await status(APP, "req_01")).toBe("open");
    const other = createPersistentHandler(store, () => NOW);
    resetAllState();
    await other({ method: "POST", path: `${APP}/req_01/close`, scenario: "default" });
    expect(await status(APP, "req_01")).toBe("closed");
  });

  it("policy saves, overrides and benchmark uploads survive too", async () => {
    const policy = JSON.parse((await call("GET", "/v1/app/settings/policy/home")).body) as Record<
      string,
      unknown
    >;
    await call("PUT", "/v1/app/settings/policy/home", "default", { ...policy, buffer: 3.5 });
    const created = JSON.parse(
      (
        await call("POST", "/v1/app/assessments/asm_evidence/overrides", "default", {
          kind: "exclude_one_off_expense",
          target: "txn_1",
          reason: "One-off",
        })
      ).body,
    ) as { id: string };
    resetAllState();
    const saved = JSON.parse((await call("GET", "/v1/app/settings/policy/home")).body) as {
      buffer: number;
      version: number;
    };
    expect(saved).toMatchObject({ buffer: 3.5, version: 2 });
    expect((await call("GET", `/v1/app/assessments/${created.id}`)).status).toBe(200);
    const versions = JSON.parse(
      (await call("GET", "/v1/app/settings/policy/home/versions")).body,
    ) as { items: unknown[] };
    expect(versions.items).toHaveLength(2);
  });

  it("a logo upload larger than one DynamoDB item is still served whole", async () => {
    const size = 1024 * 1024;
    const issued = JSON.parse(
      (
        await call("POST", "/v1/app/workspace/logo", "default", {
          content_type: "image/png",
          size_bytes: size,
        })
      ).body,
    ) as { upload_url: string; logo_key: string };
    const u = new URL(issued.upload_url);
    const bytes = Buffer.alloc(size, 7);
    resetAllState();
    const put = await handle({
      method: "PUT",
      path: u.pathname,
      query: u.search.slice(1),
      scenario: "default",
      request: { body: bytes, contentType: "image/png" },
    });
    expect(put.status).toBe(200);
    resetAllState();
    const patched = await call("PATCH", "/v1/app/workspace", "default", {
      logo_key: issued.logo_key,
    });
    expect(patched.status).toBe(200);
    resetAllState();
    const logo = await call("GET", `/mock-logos/${encodeURIComponent(issued.logo_key)}`);
    expect(Buffer.from(logo.body, "base64").equals(bytes)).toBe(true);
    for (const item of store.items()) expect(item.data.length).toBeLessThanOrEqual(350_000);
  });
});

describe("what is written to the table", () => {
  it("a read writes nothing", async () => {
    await call("GET", "/v1/app/assessments/asm_01");
    await call("GET", APP);
    expect(store.items()).toEqual([]);
  });

  it("a write is keyed by scenario, resource type and ID, and expires after 7 days", async () => {
    await call("POST", `${APP}/req_01/close`, "lovable");
    const items = store.items();
    expect(items.map((i) => [i.pk, i.sk])).toEqual([["lovable", "request#req_01"]]);
    expect(TTL_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(items[0]?.expires_at).toBe(Math.floor(NOW / 1000) + TTL_SECONDS);
  });

  it("scenarios are separate: a write in one isn't seen in another", async () => {
    await call("POST", `${APP}/req_01/close`, "one");
    expect(await status(APP, "req_01", "one")).toBe("closed");
    expect(await status(APP, "req_01", "two")).toBe("open");
    expect(await status(APP, "req_01")).toBe("open");
  });

  it("the reset route clears only its own scenario back to the seeded fixtures", async () => {
    await call("POST", `${APP}/req_01/close`, "one");
    await call("POST", `${APP}/req_01/close`, "two");
    expect((await call("POST", "/mock-reset", "one")).status).toBe(204);
    expect(await status(APP, "req_01", "one")).toBe("open");
    expect(await status(APP, "req_01", "two")).toBe("closed");
    expect(store.items().map((i) => i.pk)).toEqual(["two"]);
  });

  it("the older /mock-reset/requests route still restores the request state", async () => {
    await call("POST", `${APP}/req_01/close`);
    expect((await call("POST", "/mock-reset/requests")).status).toBe(204);
    expect(await status(APP, "req_01")).toBe("open");
  });

  it("a scenario name outside [a-z0-9-], up to 40 characters, is refused", async () => {
    expect((await call("GET", "/v1/app/me", "Bad Name!")).status).toBe(400);
    expect((await call("GET", "/v1/app/me", "x".repeat(41))).status).toBe(400);
  });
});

describe("the table is for the mock only", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });

  it("nothing outside src/mock imports the DynamoDB client or the mock's persistence", () => {
    const offenders = files("src")
      .filter((f) => !f.replaceAll("\\", "/").startsWith("src/mock/"))
      .filter((f) => /@aws-sdk|mock\/persist|mock\/state/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
