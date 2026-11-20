// SIG-63 T7: the design checks, written before the structure family exists. SIG-60's T7 is carried
// unchanged (by hash); the structure family is added and is never intended evidence; on set v2.3
// the drift-pair labels replace the drift-line labels; and the false-alarm control: random labels
// over codes drawn by the v2.3 rule are within margin, and planted code-length, constant-step and
// top-rank leaks are caught on the structure family. Modules load dynamically so each test fails
// on an assertion until they exist.
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { runLeakage, type Preregistration } from "../../../src/research/leakage/index.js";
import type { Unit } from "../../../src/research/leakage/units.js";

type CodeStats = Record<string, number | string>;
type Structure = {
  codeStats: (codes: Iterable<string>) => Map<string, CodeStats>;
  STRUCTURE_FAMILIES: Record<string, string[]>;
};
type Sig63 = { preregistrationFor: (set: string) => Preregistration };
let st: Structure | null = null;
let s63: Sig63 | null = null;
beforeAll(async () => {
  try {
    st = (await import(
      /* @vite-ignore */ "../../../src/research/leakage/structure.js"
    )) as Structure;
    s63 = (await import(/* @vite-ignore */ "../../../src/research/leakage/sig63.js")) as Sig63;
  } catch {
    st = null;
    s63 = null;
  }
});
const need = () => {
  expect(st, "src/research/leakage/structure.ts exists").not.toBeNull();
  expect(s63, "src/research/leakage/sig63.ts exists").not.toBeNull();
  return { st: st as Structure, s63: s63 as Sig63 };
};
const PREREG = JSON.parse(readFileSync("research/preregistrations/SIG-63.json", "utf8")) as {
  t7_carried: { file: string; sha256: string };
  structure_family: { families: Record<string, string[]> };
};

describe("SIG-63 T7 composition", () => {
  it("SIG-60.json is unchanged: its hash is the one SIG-63 carries", () => {
    const sha = createHash("sha256").update(readFileSync(PREREG.t7_carried.file)).digest("hex");
    expect(sha).toBe(PREREG.t7_carried.sha256);
  });
  it("the structure families are SIG-63.json's, added to SIG-60's, and never intended evidence", () => {
    const { st, s63 } = need();
    expect(st.STRUCTURE_FAMILIES).toEqual(PREREG.structure_family.families);
    for (const set of ["v2", "v2.1", "v2.2", "v2.3"]) {
      const pre = s63.preregistrationFor(set);
      for (const [f, names] of Object.entries(PREREG.structure_family.families))
        expect(pre.families[f], `${set} ${f}`).toEqual(names);
      for (const l of pre.labels)
        for (const f of Object.keys(PREREG.structure_family.families))
          expect(l.intended_evidence, `${set} ${l.id}`).not.toContain(f);
    }
  });
  it("on v2.3 the drift-pair labels replace the drift-line labels; the controls keep SIG-60's", () => {
    const { s63 } = need();
    const ids = (set: string) => s63.preregistrationFor(set).labels.map((l) => l.id);
    expect(ids("v2.3")).toContain("T-drift-pair-main");
    expect(ids("v2.3")).toContain("T-drift-pair-second");
    expect(ids("v2.3")).not.toContain("T-drift-line-main");
    expect(ids("v2.3")).not.toContain("T-drift-line-second");
    for (const set of ["v2", "v2.1", "v2.2"]) {
      expect(ids(set)).toContain("T-drift-line-main");
      expect(ids(set)).not.toContain("T-drift-pair-main");
    }
    expect(ids("v2.3").length).toBe(ids("v2.2").length);
  });
});

describe("SIG-63 code features (structure_family.definitions)", () => {
  it("shape: length, first one and two digits, last digit, digit sum mod 9", () => {
    const { st } = need();
    const s = st.codeStats(["1081", "55021"]).get("55021");
    expect(s).toMatchObject({ length: 5, lead1: 5, lead2: "55", last1: 1, digit_sum_mod9: 4 });
  });
  it("rank in the set and in its length, gap to the nearest, and the constant-step share", () => {
    const { st } = need();
    const m = st.codeStats(["1081", "1172", "1263", "1354", "55021", "40000"]);
    expect(m.get("1081")?.rank_in_set).toBe(0);
    expect(m.get("55021")?.rank_in_set).toBe(1);
    expect(m.get("1354")?.rank_in_length).toBe(1);
    expect(m.get("1172")?.gap_to_nearest).toBeCloseTo(Math.log10(92), 10);
    // Three of the four 4-digit codes sit 91 above the next-lower one.
    expect(m.get("1263")?.step_share).toBe(0.75);
    expect(m.get("1081")?.step_share).toBeNaN();
  });
});

/** A uniform draw from SHA-256 of the key. */
const u = (k: string) => createHash("sha256").update(k).digest().readUInt32BE(0) / 2 ** 32;
/** A code by the v2.3 rule: SIG-63.json's lengths, HMAC digits, no leading zero. */
const LENGTHS: [number, number][] = [
  [3, 0.02],
  [4, 0.28],
  [5, 0.3],
  [6, 0.3],
  [7, 0.05],
  [8, 0.02],
  [9, 0.02],
  [10, 0.01],
];
function v23Code(id: string): string {
  const bytes = createHmac("sha256", "noise").update(id).digest();
  const x = bytes.readUInt32BE(0) / 2 ** 32;
  let acc = 0;
  let n = 10;
  for (const [len, p] of LENGTHS) {
    acc += p;
    if (x < acc) {
      n = len;
      break;
    }
  }
  return Array.from({ length: n }, (_, i) =>
    i === 0 ? 1 + ((bytes[4 + i] ?? 0) % 9) : (bytes[4 + i] ?? 0) % 10,
  ).join("");
}

/**
 * 800 applicants, 6 lines each, paying 80 billers coded by the v2.3 rule; every line carries the
 * structure features of its code. `codeOf` may plant a leak by choosing the code from the label.
 */
function lineUnits(
  st: Structure,
  label: (i: number, k: number) => boolean,
  codeOf: (biller: number, y: boolean) => string = (b) => v23Code(`biller|${b}`),
): Unit[] {
  const raw = Array.from({ length: 800 }, (_, i) =>
    Array.from({ length: 6 }, (_, k) => {
      const y = label(i, k);
      const biller = Math.floor(u(`biller|${i}|${k}`) * 80);
      return { i, k, y, code: codeOf(biller, y) };
    }),
  ).flat();
  const stats = st.codeStats(raw.map((r) => r.code));
  return raw.map((r) => {
    const s = stats.get(r.code) ?? {};
    return {
      kind: "line" as const,
      group: `a${r.i}`,
      id: `a${r.i}|${r.k}`,
      x: Object.fromEntries([
        ...Object.entries(s).map(([k, v]) => [`line_code_${k}`, v]),
        ["noise", u(`n|${r.i}|${r.k}`)],
      ]),
      y: { L: r.y },
    };
  });
}
const preFor = (st: Structure): Preregistration => {
  const shapeRank = [...st.STRUCTURE_FAMILIES.code_shape!, ...st.STRUCTURE_FAMILIES.code_rank!];
  return {
    families: {
      code_shape: st.STRUCTURE_FAMILIES.code_shape!.filter((f) => f.startsWith("line_")),
      code_rank: st.STRUCTURE_FAMILIES.code_rank!.filter((f) => f.startsWith("line_")),
      noise: ["noise"],
      unused: shapeRank.filter((f) => !f.startsWith("line_")),
    },
    labels: [
      { id: "L", unit: "line", pool: "all", label: "L", intended_evidence: [], twin: false },
    ],
    margins: {
      auc_max: 0.6,
      auc_z: 3.09,
      stump_lift: 1.5,
      stump_min_recall: 0.1,
      stump_p: 0.001,
      twin_max_base: 0.5,
    },
    row_cap: 12000,
  };
};
const structureFlags = (r: ReturnType<typeof runLeakage>[number] | undefined) =>
  (r?.families ?? []).filter((f) => f.family.startsWith("code_") && f.flags.length > 0);

describe("SIG-63 false-alarm control (structure family)", () => {
  it("random labels at 2.5%, 10% and 40% over v2.3-rule codes are within margin", () => {
    const { st } = need();
    for (const p of [0.025, 0.1, 0.4]) {
      const r = runLeakage(
        lineUnits(st, (i, k) => u(`y|${p}|${i}|${k}`) < p),
        preFor(st),
      )[0];
      expect(r?.status, `base ${p}`).toBe("within margin");
      expect(structureFlags(r), `base ${p}`).toEqual([]);
    }
  }, 300_000);
  const planted = (st: Structure, codeOf: (b: number, y: boolean) => string) =>
    structureFlags(
      runLeakage(
        lineUnits(st, (i, k) => u(`y|planted|${i}|${k}`) < 0.1, codeOf),
        preFor(st),
      )[0],
    ).map((f) => f.family);
  it("a planted code-length leak is caught on code_shape", () => {
    const { st } = need();
    // Positives' billers have 4-digit codes; the rest 5 or 6, as in v2.2 (D-L4-1a).
    const fam = planted(st, (b, y) =>
      y ? String(1000 + b * 97) : String((b % 2 ? 10000 : 100000) + b * 997),
    );
    expect(fam).toContain("code_shape");
  }, 300_000);
  it("a planted constant step is caught on code_rank", () => {
    const { st } = need();
    // Positives' codes step by 91 among same-length codes, the rest are scattered (D-L4-1b).
    const fam = planted(st, (b, y) =>
      y ? String(500000 + b * 91) : String(100000 + ((b * 7919) % 899_999)),
    );
    expect(fam).toContain("code_rank");
  }, 300_000);
  it("a planted top-rank leak is caught on code_rank", () => {
    const { st } = need();
    // Positives take the top codes of their length (D-L4-1c).
    const fam = planted(st, (b, y) => (y ? String(990000 + b) : String(100000 + b * 9001)));
    expect(fam).toContain("code_rank");
  }, 300_000);
});
