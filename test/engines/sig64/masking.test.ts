// SIG-64 T1 to T6 (ticket section 6; rulings of 19 November 2026 and 21 November 2026, comments
// 40428 and 40524), written before the change they test. The masker is SIG-64's shared, versioned
// keyword list (src/engines/display-mask.ts); the oracle in probes.ts is written apart from it.
// T5's baseline was taken at a763b95, before any SIG-64 change (make-baseline.ts).
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import * as income from "../../../src/engines/affordability/income.js";
import {
  LENDER_NAMES,
  SENSITIVE_WORDS,
  lenderOf,
} from "../../../src/engines/families/lia/lenders.js";
import { AS_OF, repeat, type Line } from "../../families/lia/script.js";
import {
  ADDED_KEYWORDS,
  FORMS,
  PROBE_NARRATIVES,
  UNMASKED_NAMES,
  keywordWord,
  oracle,
  probeCorpus,
  runProbe,
  strings,
  type ProbeRun,
} from "./probes.js";
import { BASELINE, loadReplaySet, replay, skeleton, type Replay } from "./replay.js";
import { createHash } from "node:crypto";

type Masker = { mask: (text: string) => string };
type MaskModule = {
  KEYWORD_LIST_VERSION?: string;
  SENSITIVE_KEYWORDS?: readonly string[];
  KEYWORD_SOURCES?: Readonly<Record<string, string>>;
  maskText?: (text: string) => string;
  makeMasker?: (o: { nfkc: boolean; stripFormat: boolean; exemptions: boolean }) => Masker;
};
const MODULE = "../../../src/engines/display-mask.js";
/** SIG-64's keyword module, or nothing before it exists (so the tests fail on assertions). */
async function maskModule(): Promise<MaskModule> {
  try {
    return (await import(/* @vite-ignore */ MODULE)) as MaskModule;
  } catch {
    return {};
  }
}

const leaks = oracle();
const leaksIn = (x: unknown) => strings(x).flatMap(leaks);
const keywords = (m: MaskModule) => [
  ...new Set([...SENSITIVE_WORDS, ...ADDED_KEYWORDS, ...(m.SENSITIVE_KEYWORDS ?? [])]),
];
const chunks = <T>(xs: readonly T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
/** Distinct, non-sensitive lender words for batched runs: XAVOA, XAVOB, ... */
const lenderWord = (i: number) =>
  `XAVO${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`;

let m: MaskModule;
beforeAll(async () => {
  m = await maskModule();
});

describe("SIG-64: one shared, versioned keyword list", () => {
  it("the keyword list has its own version, 1.0.0", () => {
    expect(m.KEYWORD_LIST_VERSION).toBe("1.1.0"); // SIG-74 (26 November 2026): LIA 1.3.6, INC 1.2.4, observed income 1.0.3 and keyword list 1.1.0 change output text only.
  });
  it("it keeps every 1.3.4 keyword, stems included, and adds review 12's gaps", () => {
    const list = new Set(m.SENSITIVE_KEYWORDS ?? []);
    for (const k of [...SENSITIVE_WORDS, ...ADDED_KEYWORDS]) expect(list.has(k), k).toBe(true);
    for (const k of ["CFMEU", "CATHOLIC", "CARDIOLOG*", "BUPA"]) expect(list.has(k), k).toBe(true);
  });
  it("every group of the list cites a source", () => {
    const sources = m.KEYWORD_SOURCES ?? {};
    for (const group of ["medical", "religious", "unions", "political", "health insurers"])
      expect(typeof sources[group] === "string" && sources[group].length >= 8, group).toBe(true);
  });
  it("LIA's displayed-text masking uses the shared list (one list for every engine)", () => {
    expect([...SENSITIVE_WORDS].sort()).toEqual([...(m.SENSITIVE_KEYWORDS ?? [])].sort());
  });
});

describe("T1: every keyword, in every written form, is masked in every engine's displayed text", () => {
  it("the masker masks each keyword in each form, and keeps the words around it", () => {
    expect(typeof m.maskText).toBe("function");
    const mask = m.maskText ?? ((s: string) => s);
    const failures: string[] = [];
    for (const k of keywords(m))
      for (const [form, write] of FORMS) {
        const out = mask(`${write(keywordWord(k))} NIMBLE`);
        if (leaks(out).length > 0 || !out.includes("NIMBLE") || !out.includes("[withheld]"))
          failures.push(`${k} ${form}: ${out}`);
      }
    expect(failures).toEqual([]);
  });

  it.each(FORMS.map(([form]) => form))(
    "%s: no keyword shows in LIA, INC, observed income or observed expenses",
    (form) => {
      const write = FORMS.find(([f]) => f === form)?.[1] ?? ((w: string) => w);
      const failures: string[] = [];
      for (const [c, batch] of chunks(keywords(m), 20).entries()) {
        const lines: Line[] = batch.flatMap((k, i) => {
          const w = write(keywordWord(k));
          const n = c * 20 + i;
          return [
            ...repeat(
              13,
              14,
              { description: `${w} NIMBLE REPAY`, amount: -(40 + n), category: "sacc_loan" },
              3,
            ),
            ...repeat(6, 30, {
              description: `${w} ${lenderWord(n)} PERSONAL LOAN`,
              amount: -(300 + 37 * n),
              category: "loan_repayment",
            }),
            ...repeat(
              13,
              14,
              { description: `${w} ${lenderWord(n)} BNPL`, amount: -(20 + n), category: "bnpl" },
              4,
            ),
            ...repeat(
              6,
              14,
              { description: `${w} ${lenderWord(n)} PAYROLL`, amount: 900 + 11 * n },
              1,
            ),
          ];
        });
        const declared = batch.map((k, i) => ({
          type: "personal_loan",
          provider: `${write(keywordWord(k))} loan`,
          repayment_monthly: 300 + 37 * (c * 20 + i),
        }));
        const r = runProbe(lines, declared);
        const found = leaksIn(r);
        if (found.length > 0) failures.push(`batch ${c}: ${[...new Set(found)].join(", ")}`);
      }
      expect(failures).toEqual([]);
    },
    120_000,
  );

  it("the declared text shows the masked keyword in place: [withheld] loan", () => {
    const r = runProbe(
      repeat(6, 30, {
        description: "HARMONEY PERSONAL LOAN 88123",
        amount: -450,
        category: "loan_repayment",
      }),
      [{ type: "personal_loan", provider: "ＩＶＦ clinic loan", repayment_monthly: 450 }],
    );
    const lia01 = r.lia.signals.find((s) => s.id === "LIA-01");
    expect(lia01?.reason).toContain(
      "Possibly the declared [withheld] [withheld] loan ($450 a month)",
    );
  });
});

describe("T2: known lender names and CREDIT UNION are never masked", () => {
  const names = () => [...new Set([...UNMASKED_NAMES, ...LENDER_NAMES])];
  it("the lender list has the names SIG-64 adds", () => {
    for (const n of UNMASKED_NAMES) expect(LENDER_NAMES, n).toContain(n);
  });
  it("the masker leaves each listed name, and any CREDIT UNION, as written", () => {
    const mask = m.maskText ?? (() => "");
    for (const n of names()) expect(mask(n), n).toBe(n);
    expect(mask("Osteon Finance")).toBe("Osteon Finance");
    expect(mask("Police Credit Union")).toBe("Police Credit Union");
    expect(mask("Health Professionals Bank")).toBe("Health Professionals Bank");
    expect(mask("EXAMPLE CREDIT UNION")).toBe("EXAMPLE CREDIT UNION");
  });
  it.each(UNMASKED_NAMES.map((n) => [n]))(
    "LIA names %s in full, as a lender and as a declaration",
    (n) => {
      expect(lenderOf(n.replace(/CREDIT /, ""), `${n} LOAN 88123`)).toBe(n);
      const r = runProbe(
        repeat(6, 30, {
          description: `${n} PERSONAL LOAN 88123`,
          amount: -450,
          category: "loan_repayment",
        }),
        [{ type: "personal_loan", provider: "Plenti loan", repayment_monthly: 450 }],
      );
      expect(r.lia.signals.find((s) => s.id === "LIA-01")?.reason).toContain(`${n} (`);
      const title = n.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
      const d = runProbe(
        repeat(6, 30, {
          description: "HARMONEY PERSONAL LOAN 88123",
          amount: -450,
          category: "loan_repayment",
        }),
        [{ type: "personal_loan", provider: title, repayment_monthly: 450 }],
      );
      expect(d.lia.signals.find((s) => s.id === "LIA-01")?.reason).toContain(
        `Possibly the declared ${title} (`,
      );
    },
  );
  it("every listed lender name shows in full in LIA, and as a payer in INC and observed income", () => {
    const failures: string[] = [];
    for (const n of names()) {
      const r = runProbe(
        [
          ...repeat(6, 30, {
            description: `${n} PERSONAL LOAN 88123`,
            amount: -450,
            category: "loan_repayment",
          }),
          ...repeat(6, 14, { description: `${n} PAYROLL`, amount: 1700 }, 1),
        ],
        [],
      );
      if (!r.lia.signals.find((s) => s.id === "LIA-01")?.reason.includes(`${n} (`))
        failures.push(`LIA ${n}`);
      if (/\d/.test(n)) continue; // a payer name keeps letters only (normalisePayer)
      if (!r.income.streams.some((s) => s.payer === `${n} PAYROLL`)) failures.push(`income ${n}`);
      if (!r.inc.income.some((s) => s.payer === `${n} PAYROLL`)) failures.push(`INC ${n}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("T3: a lender name shows no reference digits, and keeps its Unicode letters", () => {
  it.each([
    ["NIMBLE4417", "NIMBLE"],
    ["4417NIMBLE", "NIMBLE"],
    ["HARMONEY88123", "HARMONEY"],
    ["ZÖP".normalize("NFD"), "ZÖP".normalize("NFC")],
  ])("%s shows %s", (written, name) => {
    const provider = written
      .normalize("NFD")
      .replace(/\d/g, "")
      .replace(/[^A-Z ]/g, " ")
      .trim();
    expect(lenderOf(provider, `${written} LOAN REPAYMENT`)).toBe(name);
    const r = runProbe(
      [
        ...repeat(6, 30, {
          description: `${written} LOAN REPAYMENT`,
          amount: -310,
          category: "loan_repayment",
        }),
        ...repeat(13, 14, { description: written, amount: -45, category: "sacc_loan" }, 3),
      ],
      [],
    );
    const lia01 = r.lia.signals.find((s) => s.id === "LIA-01")?.reason ?? "";
    const lia03 = r.lia.signals.find((s) => s.id === "LIA-03")?.reason ?? "";
    expect(lia01).toContain(`${name} (`);
    expect(lia03).toContain(name);
    for (const text of [lia01, lia03, ...r.lia.liabilities.map((l) => l.provider)]) {
      expect(text).not.toMatch(/4417|88123/);
      expect(text.normalize("NFC")).toBe(text);
    }
  });
  it("a listed name with a digit keeps it: MONEY3", () => {
    expect(lenderOf("MONEY", "MONEY3 LOAN REPAYMENT 4417")).toBe("MONEY3");
  });
});

/** A steady salary, then a new payer whose narrative carries a keyword, paid for 60 days. */
const newPayer = (narrative: string): ProbeRun =>
  runProbe(repeat(5, 14, { description: narrative, amount: 900 }, 3), []);

describe("T4: income reasons are masked, and income figures and states are unchanged", () => {
  it("INC-13 shows [withheld] NIMBLE REPAY first paid on ..., not IVF", () => {
    const r = newPayer("IVF NIMBLE REPAY");
    const inc13 = r.inc.signals.find((s) => s.id === "INC-13");
    expect(inc13?.reason).toMatch(/\[withheld\] NIMBLE REPAY first paid on \d{4}-\d{2}-\d{2}/);
    expect(leaksIn(r)).toEqual([]);
  });
  it.each(["ONCOLOGY PAYROLL", "PSYCH SERVICES PAYROLL", "PARISH OF ST MARY", "HOSPITAL SALARY"])(
    "a payer written %s is masked in INC and observed income",
    (narrative) => {
      const r = newPayer(narrative);
      expect(leaksIn(r)).toEqual([]);
      const shown = `[withheld] ${narrative.split(" ").slice(1).join(" ")}`;
      expect(r.income.streams.map((s) => s.payer)).toContain(shown);
      expect(r.inc.income.map((s) => s.payer)).toContain(shown);
      expect(r.inc.signals.find((s) => s.id === "INC-13")?.reason).toContain(shown);
    },
  );
});

describe("T5 and the observed-income replay: states, values and figures are byte-identical", () => {
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as {
    commit: string;
    sets: Record<string, Replay>;
    probes: { count: number; lia: string; inc: string; income: string; expenses: string };
  };
  const hash = (xs: unknown[]) => {
    const h = createHash("sha256");
    for (const x of xs) h.update(skeleton(x)).update("\n");
    return h.digest("hex");
  };
  it("the baseline was taken at a763b95, before any SIG-64 change", () => {
    expect(baseline.commit).toBe("a763b956a10c2b6c9127c83165e802a5b7695fe1");
    expect(baseline.sets["synthetic-v1"]?.versions).toContain("lia.version=1.3.4");
  });

  describe.each(["synthetic-v1", "synthetic-v2.2"] as const)("%s", (set) => {
    let now: Replay;
    let keys: string;
    let shownIsMaskedKey: string[];
    beforeAll(async () => {
      const s = loadReplaySet(set);
      now = replay(s);
      const mask = (await maskModule()).maskText ?? ((x: string) => x);
      const byKey = (income as unknown as { deriveIncomeByPayerKey?: typeof income.deriveIncome })
        .deriveIncomeByPayerKey;
      const h = createHash("sha256");
      shownIsMaskedKey = [];
      for (const a of s.applicants) {
        const input = {
          feed: a.feed as never,
          as_of: s.as_of,
          lookback_months: 6,
          min_occurrences: 3,
          categories: s.categories,
        };
        const key = byKey ? byKey(input).streams.map((x) => x.payer) : [];
        h.update(JSON.stringify(key)).update("\n");
        const shown = income.deriveIncome(input).streams.map((x) => x.payer);
        if (JSON.stringify(shown) !== JSON.stringify(key.map(mask)))
          shownIsMaskedKey.push(shown.join("|"));
      }
      keys = h.digest("hex");
    }, 600_000);
    it("T5: LIA's states, values and counts equal LIA 1.3.4's", () => {
      expect(now.lia).toBe(baseline.sets[set]?.lia);
    });
    it("T4: INC's states and figures equal INC 1.2.2's", () => {
      expect(now.inc).toBe(baseline.sets[set]?.inc);
    });
    it("ruling 40524, 1: observed income's figures and states equal 1.0.1's", () => {
      expect(now.income).toBe(baseline.sets[set]?.income);
    });
    it("ruling 40524, 1: only the payer text changes: each payer shown is 1.0.1's payer, masked", () => {
      expect(keys).toBe(baseline.sets[set]?.income_payers);
      expect(shownIsMaskedKey).toEqual([]);
    });
    it("every result records its versions, the keyword list's included", () => {
      expect(now.versions).toEqual([
        "inc.gr3_gate_version=1.2.0",
        "inc.keyword_list_version=1.1.0",
        "inc.version=1.2.4",
        "income.gr3_gate_version=1.2.0",
        "income.keyword_list_version=1.1.0",
        "lia.gr3_gate_version=1.2.0",
        "lia.keyword_list_version=1.1.0",
        "lia.lender_names_version=1.2.0",
        "lia.version=1.4.0", // SIG-83
      ]);
    });
  });

  describe("the probe corpus (reviews 9, 10 and 12, and SIG-64's adversarial probes)", () => {
    let probes: ProbeRun[];
    beforeAll(() => {
      probes = probeCorpus();
    }, 120_000);
    it("has the same probes as the baseline", () => {
      expect(probes).toHaveLength(baseline.probes.count);
      expect(PROBE_NARRATIVES).toHaveLength(baseline.probes.count);
    });
    it("T5: LIA's states and values equal 1.3.4's", () => {
      expect(hash(probes.map((p) => p.lia))).toBe(baseline.probes.lia);
    });
    it("T4: INC and observed income figures and states equal 1.2.2's and 1.0.1's", () => {
      expect(hash(probes.map((p) => p.inc))).toBe(baseline.probes.inc);
      expect(hash(probes.map((p) => p.income))).toBe(baseline.probes.income);
    });
    it("observed expenses, which shows no narrative text, is unchanged", () => {
      expect(hash(probes.map((p) => p.expenses))).toBe(baseline.probes.expenses);
    });
    it("T6: a scan of every output field of every engine finds 0 keywords", () => {
      const found = probes.flatMap((p, i) =>
        leaksIn(p).map((k) => `${PROBE_NARRATIVES[i] ?? i}: ${k}`),
      );
      expect(found).toEqual([]);
    });
  });
});

describe("versions (SIG-64 method, Versions; ruling 40524, 1)", () => {
  it("observed income is 1.0.2, and SIG-16-team-grants.json records it, amended before any grant", () => {
    expect(income.INCOME_METHOD_VERSION).toBe("1.0.3"); // SIG-74 (26 November 2026): LIA 1.3.6, INC 1.2.4, observed income 1.0.3 and keyword list 1.1.0 change output text only.
    const prereg = readFileSync("research/preregistrations/SIG-16-team-grants.json", "utf8");
    expect(prereg).toContain('"income_method_version": "1.0.3"');
    expect(prereg).toMatch(/2026-11-21[^"]*1\.0\.1[^"]*1\.0\.2/);
  });
  it("AS_OF is the scripts' date", () => {
    expect(AS_OF).toBe("2026-10-31");
  });
});
