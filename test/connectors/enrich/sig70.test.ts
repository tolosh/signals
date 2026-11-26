// SIG-70 T1 to T7 (ticket section 6; rulings 40714 and 40719, and Colin's answers of 26 November
// 2026), written before the adapter exists. Each module is loaded through `load`, so before it
// exists the tests fail on their assertions, not on an import.
//
// The engine here is a stand-in: no Enrich build is pinned until the Enrich side publishes the
// ENR-28 fix (Colin, 26 November), and no synthetic data may reach the live API (D42), so the API
// categoriser is a stand-in too.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { deriveObservedExpenses } from "../../../src/engines/affordability/observed-expenses.js";

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (name: string): Promise<Mod> => {
  try {
    return (await import(/* @vite-ignore */ `../../../src/connectors/enrich/${name}.js`)) as Mod;
  } catch {
    return {};
  }
};

/** Three transactions, in the feed shape the engines read. */
const TXS = [
  {
    transactionId: "t1",
    description: "WOOLWORTHS 1234 SYDNEY",
    amount: "-85.40",
    merchantCategoryCode: "5411",
  },
  { transactionId: "t2", description: "NEW KIND OF THING", amount: "-12.00" },
  { transactionId: "t3", description: "SALARY ACME", amount: "3000.00" },
];

/** A stand-in Enrich engine module: the shape of @moroku-enrich/engine's categorise. */
function standInEngine() {
  const calls: { input: Record<string, unknown>; lookups: Record<string, () => unknown> }[] = [];
  return {
    calls,
    ENGINE_VERSION: "0.0.0-standin",
    TAXONOMY_VERSION: "9.9-standin",
    categorise(input: Record<string, unknown>, lookups: Record<string, () => unknown>) {
      calls.push({ input, lookups });
      const amount = Number(input.amount);
      const category =
        input.mcc === "5411" ? "groceries" : amount > 0 ? "income" : "brand_new_category";
      return {
        category,
        classification: category === "groceries" ? "essential" : "discretionary",
        confidence: 0.9,
        source: input.mcc ? "mcc" : "fallback",
        excluded: false,
        flags: [],
        merchant: { name: String(input.description) },
        engine_version: "0.0.0-standin",
        taxonomy_version: "9.9-standin",
        direction: amount < 0 ? "out" : "in",
      };
    },
    taxonomyDocument() {
      return {
        taxonomy_version: "9.9-standin",
        categories: [
          { id: "groceries", classification: "essential" },
          { id: "income", classification: "essential" },
        ],
      };
    },
  };
}

/** A stand-in for ApiEnrich: answers, or fails as told. */
function standInApi(behaviour: "ok" | "timeout" | 500 | 503 | 429) {
  const calls: unknown[] = [];
  const engine = standInEngine();
  return {
    calls,
    path: "api" as const,
    async taxonomy() {
      return engine.taxonomyDocument();
    },
    async categorise(txs: unknown[]) {
      calls.push(txs);
      if (behaviour === "timeout") return new Promise(() => undefined);
      if (typeof behaviour === "number")
        throw Object.assign(new Error(`HTTP ${behaviour}`), { status: behaviour });
      return {
        engine_version: "api-standin",
        taxonomy_version: "9.9-standin",
        results: (txs as { transactionId: string }[]).map((t) => ({
          transaction_id: t.transactionId,
          category: "groceries",
          classification: "essential",
          excluded: false,
        })),
      };
    },
  };
}

const BUILD = {
  commit: "0000000000000000000000000000000000000000",
  version: "0.0.0-standin",
  dist_sha256: "0".repeat(64),
};

async function adapter() {
  const [local, path, replay] = await Promise.all([load("local"), load("path"), load("replay")]);
  expect(typeof local.makeLocalEnrich).toBe("function");
  expect(typeof path.categoriseForAssessment).toBe("function");
  return { local, path, replay };
}

describe("T1: the path follows the lender's Enrich tenant, and is recorded", () => {
  it("active means api; pending or none means local", async () => {
    const path = await load("path");
    expect(typeof path.selectPath).toBe("function");
    expect([
      path.selectPath?.("active"),
      path.selectPath?.("pending"),
      path.selectPath?.("none"),
    ]).toEqual(["api", "local", "local"]);
  });
  it.each([
    ["active", "api"],
    ["pending", "local"],
    ["none", "local"],
  ])(
    "a tenant %s is categorised on path %s, recorded with versions and the full response",
    async (status, expected) => {
      const { local, path } = await adapter();
      const engine = standInEngine();
      const record = await path.categoriseForAssessment({
        tenant: { status },
        txs: TXS,
        local: local.makeLocalEnrich(engine, BUILD),
        api: standInApi("ok"),
        synthetic: false,
      });
      expect(record.path).toBe(expected);
      expect(record.engine_version).toBeTruthy();
      expect(record.taxonomy_version).toBeTruthy();
      expect(record.response.results).toHaveLength(TXS.length);
      if (expected === "local") expect(record.build).toEqual(BUILD);
    },
  );
  it("the demo forces local (D58): an active tenant still records path local", async () => {
    const { local, path } = await adapter();
    const api = standInApi("ok");
    const record = await path.categoriseForAssessment({
      tenant: { status: "active" },
      txs: TXS,
      local: local.makeLocalEnrich(standInEngine(), BUILD),
      api,
      synthetic: false,
      forceLocal: true,
    });
    expect(record.path).toBe("local");
    expect(api.calls).toHaveLength(0);
  });
  it("LocalEnrich calls the engine as the research script does: no dictionary, overrides or cache", async () => {
    const { local } = await adapter();
    const engine = standInEngine();
    await local.makeLocalEnrich(engine, BUILD).categorise(TXS);
    expect(engine.calls).toHaveLength(TXS.length);
    const first = engine.calls[0];
    expect(first?.input).toEqual({
      description: "WOOLWORTHS 1234 SYDNEY",
      amount: -85.4,
      mcc: "5411",
      merchant_name: undefined,
      biller_code: undefined,
      biller_name: undefined,
      reference: undefined,
    });
    expect(Object.keys(first?.lookups ?? {}).sort()).toEqual([
      "dictionary",
      "llmCache",
      "tenantOverride",
      "userOverride",
    ]);
    for (const f of Object.values(first?.lookups ?? {})) expect(f()).toBeUndefined();
  });
});

describe("T2: an API failure falls back to local, recorded, and the assessment completes", () => {
  it.each([
    ["timeout", "timeout"],
    [500, "server_error"],
    [503, "server_error"],
    [429, "rate_limited"],
  ] as const)("API %s: path api_fallback_local, reason %s", async (behaviour, reason) => {
    const { local, path } = await adapter();
    const record = await path.categoriseForAssessment({
      tenant: { status: "active" },
      txs: TXS,
      local: local.makeLocalEnrich(standInEngine(), BUILD),
      api: standInApi(behaviour),
      synthetic: false,
      timeoutMs: 20,
    });
    expect(record.path).toBe("api_fallback_local");
    expect(record.fallback).toEqual({ reason });
    expect(record.response.results).toHaveLength(TXS.length);
    expect(record.build).toEqual(BUILD);
  });
  it("an active tenant with no API client yet falls back as unavailable, never silently", async () => {
    const { local, path } = await adapter();
    const record = await path.categoriseForAssessment({
      tenant: { status: "active" },
      txs: TXS,
      local: local.makeLocalEnrich(standInEngine(), BUILD),
      api: null,
      synthetic: false,
    });
    expect(record.path).toBe("api_fallback_local");
    expect(record.fallback).toEqual({ reason: "unavailable" });
  });
});

describe("T3: the stored record replays the assessment byte-identically, without calling Enrich", () => {
  it("categories come from the stored response, and the engines give the same output", async () => {
    const { local, path, replay } = await adapter();
    expect(typeof replay.categoriesFrom).toBe("function");
    const engine = standInEngine();
    const record = await path.categoriseForAssessment({
      tenant: { status: "none" },
      txs: TXS,
      local: local.makeLocalEnrich(engine, BUILD),
      api: null,
      synthetic: false,
    });
    const calls = engine.calls.length;
    const stored = JSON.parse(JSON.stringify(record)) as unknown;
    const categories = replay.categoriesFrom(stored) as Record<string, string>;
    expect(categories).toEqual({ t1: "groceries", t2: "brand_new_category", t3: "income" });
    expect(engine.calls).toHaveLength(calls);
    const run = (c: Record<string, string>) =>
      JSON.stringify(
        deriveObservedExpenses({
          feed: {
            accounts: [
              {
                account: { accountId: "a1" },
                transactions: TXS.map((t) => ({
                  ...t,
                  accountId: "a1",
                  type: "PAYMENT",
                  postingDateTime: "2026-10-20T02:00:00Z",
                })),
              },
            ],
          } as never,
          categories: c,
          as_of: "2026-10-31",
          lookback_months: 6,
          one_off_threshold_aud: 5000,
        }),
      );
    expect(run(replay.categoriesFrom(record) as Record<string, string>)).toBe(run(categories));
  });
});

describe("T4: consumer rules at the adapter (engine-facing rules are their own ticket)", () => {
  it("the taxonomy is read from the categoriser, and recorded", async () => {
    const { local, path } = await adapter();
    const record = await path.categoriseForAssessment({
      tenant: { status: "none" },
      txs: TXS,
      local: local.makeLocalEnrich(standInEngine(), BUILD),
      api: null,
      synthetic: false,
    });
    expect(record.taxonomy_version).toBe("9.9-standin");
    expect(record.taxonomy?.taxonomy_version).toBe("9.9-standin");
  });
  it("no category id or taxonomy version is hard-coded in the adapter", () => {
    const dir = "src/connectors/enrich";
    const src = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    expect(src.length).toBeGreaterThan(0);
    expect(src).not.toMatch(
      /"(groceries|utilities|transfer|income|other_expenses|gambling|crypto)"/,
    );
    expect(src).not.toMatch(/"1\.[0-9]+"\s*[,;)]/);
  });
  it("an unknown category id is tolerated and kept as returned", async () => {
    const { local, path, replay } = await adapter();
    const record = await path.categoriseForAssessment({
      tenant: { status: "none" },
      txs: TXS,
      local: local.makeLocalEnrich(standInEngine(), BUILD),
      api: null,
      synthetic: false,
    });
    expect((replay.categoriesFrom(record) as Record<string, string>).t2).toBe("brand_new_category");
  });
  it("the stored results keep classification, excluded and direction for the engines that need them", async () => {
    const { local, path } = await adapter();
    const record = await path.categoriseForAssessment({
      tenant: { status: "none" },
      txs: TXS,
      local: local.makeLocalEnrich(standInEngine(), BUILD),
      api: null,
      synthetic: false,
    });
    for (const r of record.response.results as Record<string, unknown>[]) {
      expect(r).toHaveProperty("transaction_id");
      expect(r).toHaveProperty("classification");
      expect(r).toHaveProperty("excluded");
      expect(r).toHaveProperty("direction");
    }
  });
});

/** Files under a folder, recursively. */
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p.replace(/\\/g, "/")] : [];
  });

describe("T5: no synthetic data can reach the live API", () => {
  it("a synthetic feed is never sent to the API, even for an active tenant", async () => {
    const { local, path } = await adapter();
    const api = standInApi("ok");
    const record = await path.categoriseForAssessment({
      tenant: { status: "active" },
      txs: TXS,
      local: local.makeLocalEnrich(standInEngine(), BUILD),
      api,
      synthetic: true,
    });
    expect(api.calls).toHaveLength(0);
    expect(record.path).toBe("local");
    expect(record.api_refused).toBe("synthetic");
  });
  it("static: nothing that reads the synthetic sets imports the live API client (src/connectors/enrich/api.ts)", () => {
    const files = [...walk("src"), ...walk("scripts")];
    const readsSynthetic = (s: string) =>
      /research\/generator|research\/datasets|generateSetV2|generateApplicant/.test(s);
    const importsApi = (s: string) => /connectors\/enrich\/api(\.js)?["']/.test(s);
    const offenders = files.filter((f) => {
      const s = readFileSync(f, "utf8");
      return readsSynthetic(s) && importsApi(s);
    });
    expect(offenders).toEqual([]);
    // The adapter itself never imports the synthetic sets.
    const adapterFiles = walk("src/connectors/enrich");
    expect(adapterFiles.length).toBeGreaterThan(0);
    for (const f of adapterFiles) expect(readsSynthetic(readFileSync(f, "utf8")), f).toBe(false);
  });
});

describe("T6: dev measurements (latency, cost per 1,000, path agreement)", () => {
  it.todo(
    "not run: ENR-32's non-synthetic corpus and SIG-72's service credential are not available (ruling 40719); no synthetic substitute",
  );
});

describe("T7: the service credential is scoped to one named tenant; the lender's key is never used", () => {
  const CREDS = [
    {
      kind: "signals_service",
      tenant_id: "ten_a",
      secret_ref: "arn:aws:secretsmanager:ap-southeast-2:000:secret:enrich-ten_a",
    },
    {
      kind: "signals_service",
      tenant_id: "ten_b",
      secret_ref: "arn:aws:secretsmanager:ap-southeast-2:000:secret:enrich-ten_b",
    },
    { kind: "lender_key", tenant_id: "ten_c", secret_ref: "lender-supplied" },
  ];
  it("picks the service credential for the named tenant only", async () => {
    const c = await load("credential");
    expect(typeof c.credentialFor).toBe("function");
    expect(c.credentialFor?.("ten_a", CREDS)).toEqual(CREDS[0]);
  });
  it("refuses a lender's own key, another tenant's credential, or none", async () => {
    const c = await load("credential");
    expect(typeof c.credentialFor).toBe("function");
    expect(() => c.credentialFor("ten_c", CREDS)).toThrow(/lender/);
    expect(() => c.credentialFor("ten_z", CREDS)).toThrow(/no service credential/);
    expect(() => c.credentialFor("ten_a", [...CREDS, { ...CREDS[1], tenant_id: "ten_a" }])).toThrow(
      /more than one/,
    );
  });
});

describe("hygiene: transaction descriptions are never logged", () => {
  it("the adapter writes nothing to the console", async () => {
    const { local, path } = await adapter();
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    await path.categoriseForAssessment({
      tenant: { status: "active" },
      txs: TXS,
      local: local.makeLocalEnrich(standInEngine(), BUILD),
      api: standInApi(503),
      synthetic: false,
    });
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });
});

// The pinned build (ruling 40719, 2), and runtime categories equal to its research/enrich
// fixtures, are tested in pin.test.ts (Colin, 27 November 2026: the ENR-28 build, 1.8.0).
