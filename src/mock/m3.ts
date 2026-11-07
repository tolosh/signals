// Mock behaviour for the lender's M3 screens (SIG-11; contract 1.5.0; Lovable gaps of 7 November):
// versioned policy saves with history, expense-method options, override-created assessment
// versions (figures recomputed by the real affordability engine), and validated benchmark
// uploads. SIG-51: policy versions, override inputs and uploaded benchmarks are state slices, kept
// in the mock's table between Lambda containers. Seeded values aren't written, so reads write nothing.
import { readFileSync } from "node:fs";
import { computeAffordability, type AffordabilityInput } from "../engines/affordability/index.js";
import { registerSlice } from "./state.js";

type Json = Record<string, unknown>;
export type MockFailure = {
  mockError: { status: number; code: string; message: string; details?: unknown };
};
const fail = (code: string, message: string, details?: unknown): MockFailure => ({
  mockError: { status: 400, code, message, ...(details === undefined ? {} : { details }) },
});
const record = (body: unknown): Json =>
  body && typeof body === "object" && !Array.isArray(body) ? (body as Json) : {};

// --- Expense-method options (D26; X-2) -------------------------------------------------------
const OBSERVED_REASON =
  "Observed expenses are not available yet: they come from expense derivation (SIG-17) and the commitments register (SIG-43), neither of which supplies figures yet";
const OPTIONS: { key: string; label: string; description: string; requires: string[] }[] = [
  {
    key: "highest_of_confirmed_benchmark_observed",
    label: "Highest of confirmed, benchmark and observed",
    description:
      "The higher of the applicant's confirmed expenses, the benchmark for the household, and observed committed plus basic spending (AF-E3, the default)",
    requires: ["confirmed_expenses", "benchmark", "observed_expenses"],
  },
  {
    key: "confirmed",
    label: "Confirmed by the applicant",
    description: "The living expenses the applicant confirmed",
    requires: ["confirmed_expenses"],
  },
  {
    key: "benchmark",
    label: "Benchmark",
    description: "The benchmark for the household profile, from your benchmark table",
    requires: ["benchmark"],
  },
  {
    key: "observed",
    label: "Observed in the bank data",
    description: "Committed plus basic spending observed in the shared accounts",
    requires: ["observed_expenses"],
  },
  {
    key: "higher_of_confirmed_benchmark",
    label: "Higher of confirmed and benchmark",
    description: "The higher of the applicant's confirmed expenses and the benchmark",
    requires: ["confirmed_expenses", "benchmark"],
  },
];
export const expenseMethodOptions = () =>
  OPTIONS.map((o) => {
    const blocked = o.requires.includes("observed_expenses");
    return { ...o, available: !blocked, unavailable_reason: blocked ? OBSERVED_REASON : null };
  });

// --- Policy versions ---------------------------------------------------------------------------
const POLICY_FIELDS = [
  "buffer",
  "floor_rate",
  "income_shading",
  "card_factor",
  "expense_method",
  "ratio_thresholds",
  "income_signals",
  "liability_signals",
] as const;
// Optional on a save (income_signals 1.7.0, liability_signals 1.8.0): when absent, the previous
// version's value carries on.
const CARRIED = new Set<string>(["income_signals", "liability_signals"]);
type PolicyVersion = { policy: Json; author: string; created_at: string; changes: Change[] };
type Change = { field: string; from: unknown; to: unknown };
const policies = new Map<string, PolicyVersion[]>();

function versionsOf(product: string, base: Json): PolicyVersion[] {
  let list = policies.get(product);
  if (!list) {
    list = [
      {
        policy: { ...base, product, version: 1 },
        author: "Moroku defaults",
        created_at: "2026-10-20T09:30:00+11:00",
        changes: [],
      },
    ];
    policies.set(product, list);
  }
  return list;
}
const latest = (list: PolicyVersion[]) => list[list.length - 1] as PolicyVersion;

export const getPolicy = (product: string, base: Json) => ({
  ...latest(versionsOf(product, base)).policy,
  expense_method_options: expenseMethodOptions(),
});

export function putPolicy(product: string, base: Json, body: unknown, now: number, author: string) {
  const input = { ...record(body) };
  const missing = POLICY_FIELDS.filter((f) => !CARRIED.has(f) && !(f in input));
  if (missing.length > 0) return fail("invalid_parameter", `Missing ${missing.join(", ")}`);
  if (!OPTIONS.some((o) => o.key === input.expense_method))
    return fail("invalid_parameter", "expense_method is not a listed method");
  const list = versionsOf(product, base);
  const prev = latest(list).policy;
  for (const f of CARRIED) if (!(f in input)) input[f] = prev[f];
  const changes: Change[] = POLICY_FIELDS.filter(
    (f) => JSON.stringify(prev[f]) !== JSON.stringify(input[f]),
  ).map((f) => ({ field: f, from: prev[f], to: input[f] }));
  const next: Json = { product, version: list.length + 1 };
  for (const f of POLICY_FIELDS) next[f] = input[f];
  list.push({ policy: next, author, created_at: new Date(now).toISOString(), changes });
  return getPolicy(product, base);
}

const show = (v: unknown) => (typeof v === "object" ? JSON.stringify(v) : String(v));
export function listPolicyVersions(product: string, base: Json) {
  const items = [...versionsOf(product, base)].reverse().map((v) => ({
    version: v.policy.version,
    author: v.author,
    created_at: v.created_at,
    summary:
      v.changes.length === 0
        ? v.policy.version === 1
          ? "Initial policy"
          : "Saved with no changes"
        : v.changes.map((c) => `${c.field} ${show(c.from)} → ${show(c.to)}`).join("; "),
    changes: v.changes,
  }));
  return { items, next_cursor: null };
}

// --- Assessment versions from overrides --------------------------------------------------------
const afT1Input = () =>
  (JSON.parse(readFileSync("test/fixtures/af-t1.json", "utf8")) as { input: AffordabilityInput })
    .input;
const recompute = (input: AffordabilityInput) => computeAffordability(input).affordability;
/** The engine inputs behind each assessment version the mock can recompute. */
const inputs = new Map<string, AffordabilityInput>();

/** asm_01 version 2: the applicant later confirmed $3,500 a month of living expenses. */
export function seedVersions(assessments: Record<string, Json>) {
  const v1 = afT1Input();
  inputs.set("asm_01", v1);
  const v2: AffordabilityInput = { ...v1, expenses: { ...v1.expenses, confirmed_monthly: 3500 } };
  inputs.set("asm_01_v2", v2);
  assessments.asm_01_v2 = {
    ...(assessments.asm_01 as Json),
    id: "asm_01_v2",
    version: 2,
    affordability: recompute(v2),
  };
}

const KINDS = [
  "include_income_stream",
  "exclude_income_stream",
  "exclude_one_off_expense",
  "correct_stated_figure",
];
export function createOverride(
  id: string,
  body: unknown,
  assessments: Record<string, Json>,
  onCreated: (applicantId: string, newId: string) => void,
) {
  const base = assessments[id];
  if (!base) return undefined;
  const o = record(body);
  if (!KINDS.includes(String(o.kind)) || typeof o.target !== "string" || !o.reason)
    return fail("invalid_parameter", "An override needs a kind, a target and a reason");
  const applicantId = String(base.applicant_id);
  const chain = Object.values(assessments).filter((a) => a.applicant_id === applicantId);
  const version = Math.max(...chain.map((a) => Number(a.version))) + 1;
  const newId = `${id.replace(/_v\d+$/, "")}_v${version}`;
  const input = inputs.get(id);
  let next: AffordabilityInput | undefined;
  if (input && o.kind === "correct_stated_figure" && typeof o.value === "number") {
    const field = o.target as keyof AffordabilityInput["expenses"];
    if (field in input.expenses)
      next = { ...input, expenses: { ...input.expenses, [field]: o.value } };
  }
  next ??= input;
  if (next) inputs.set(newId, next);
  assessments[newId] = {
    ...base,
    id: newId,
    version,
    ...(next ? { affordability: recompute(next) } : {}),
  };
  onCreated(applicantId, newId);
  return summaryOf(assessments[newId] as Json);
}

export const summaryOf = (a: Json) => ({
  id: a.id,
  applicant_id: a.applicant_id,
  version: a.version,
  status: a.status,
  rollup_state: (a.rollup as Json | undefined)?.state ?? null,
  data_as_of: a.data_as_of,
  evidence_checks: a.evidence_checks ?? null,
});

// --- Benchmarks (AF-E4) --------------------------------------------------------------------------
const HEADER = "household_type,dependants,income_band,location,monthly_amount";
const STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "ACT", "NT"];
type RowError = { row: number | null; column: string | null; code: string; message: string };

/**
 * Validates a benchmark CSV against the template. Each row is checked field by field. Coverage
 * (mock rule): the file must contain every combination of the values it uses, so no household
 * profile it implies is missing. The production rules come with the AF-E4 implementation.
 */
export function validateBenchmarkCsv(text: string): RowError[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  if ((lines[0] ?? "").trim() !== HEADER)
    return [
      { row: 1, column: null, code: "invalid_header", message: `The header must be: ${HEADER}` },
    ];
  const errors: RowError[] = [];
  const seen = new Set<string>();
  const values: string[][] = [[], [], [], []];
  lines.slice(1).forEach((line, i) => {
    const row = i + 2;
    const cells = line.split(",").map((c) => c.trim());
    const [household = "", dependants = "", band = "", location = "", amount = ""] = cells;
    const bad = (column: string, message: string, code = "invalid_value") =>
      errors.push({ row, column, code, message });
    const before = errors.length;
    if (cells.length !== 5) return bad("monthly_amount", "Expected 5 values", "missing_value");
    if (!["single", "couple"].includes(household))
      bad("household_type", "household_type must be single or couple");
    if (!/^\d+$/.test(dependants)) bad("dependants", "dependants must be a whole number");
    if (!/^\d+(-\d+|\+)$/.test(band))
      bad("income_band", "income_band must look like 0-79999 or 80000+");
    const [state = "", area = ""] = location.split("-");
    if (!STATES.includes(state) || !["metro", "regional"].includes(area))
      bad("location", "location must be a state and metro or regional, for example NSW-metro");
    if (!(Number(amount) > 0)) bad("monthly_amount", "monthly_amount must be a positive number");
    if (errors.length > before) return;
    const key = [household, dependants, band, location].join("|");
    if (seen.has(key))
      bad("household_type", "This household profile appears twice", "duplicate_profile");
    seen.add(key);
    [household, dependants, band, location].forEach(
      (v, k) => values[k]?.includes(v) || values[k]?.push(v),
    );
  });
  const combos = values.reduce((n, v) => n * Math.max(v.length, 1), 1);
  if (seen.size > 0 && seen.size < combos)
    errors.push({
      row: null,
      column: null,
      code: "incomplete_coverage",
      message: `${combos - seen.size} household profiles implied by the file are missing`,
    });
  return errors.slice(0, 100);
}

/** Uploaded benchmarks, after the seed table. */
const uploaded: Json[] = [];
export function listBenchmarks(seed: Json) {
  return { items: [seed, ...uploaded] };
}
export function uploadBenchmark(seed: Json, text: string, now: number) {
  const rows = validateBenchmarkCsv(text);
  if (rows.length > 0)
    return fail("invalid_benchmark", "The benchmark CSV failed validation; nothing was saved", {
      rows,
    });
  const list = listBenchmarks(seed).items;
  const created = {
    ...seed,
    id: `bmk_${String(list.length + 1).padStart(2, "0")}`,
    name: "Lender benchmark",
    version: list.length + 1,
    source: "lender_upload",
    is_seed: false,
    effective_from: new Date(now).toISOString().slice(0, 10),
  };
  uploaded.push(created);
  return created;
}
export const benchmarkCsv = (name: "valid" | "invalid") =>
  readFileSync(`test/fixtures/benchmark-${name}.csv`, "utf8");

// --- State slices (SIG-51) ------------------------------------------------------------------------
/** The engine inputs the fixtures seed (asm_01 and asm_01_v2); only later ones are stored. */
let seededInputs = new Set<string>();
export const markInputsSeeded = () => {
  seededInputs = new Set(inputs.keys());
};
registerSlice({
  type: "policy",
  reset: () => policies.clear(),
  // Version 1 is the seeded default, created on first read; only saved versions are stored.
  snapshot: () => Object.fromEntries([...policies].filter(([, list]) => list.length > 1)),
  restore: (items) => {
    for (const [product, list] of Object.entries(items))
      policies.set(product, list as PolicyVersion[]);
  },
});
registerSlice({
  type: "input",
  reset: () => {
    for (const key of [...inputs.keys()]) if (!seededInputs.has(key)) inputs.delete(key);
  },
  snapshot: () => Object.fromEntries([...inputs].filter(([key]) => !seededInputs.has(key))),
  restore: (items) => {
    for (const [key, value] of Object.entries(items)) inputs.set(key, value as AffordabilityInput);
  },
});
registerSlice({
  type: "benchmark",
  reset: () => {
    uploaded.length = 0;
  },
  snapshot: () => Object.fromEntries(uploaded.map((b) => [String(b.id), b])),
  restore: (items) => {
    uploaded.length = 0;
    uploaded.push(
      ...Object.values(items as Record<string, Json>).sort(
        (a, b) => Number(a.version) - Number(b.version),
      ),
    );
  },
});
