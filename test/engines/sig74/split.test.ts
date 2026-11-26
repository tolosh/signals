// SIG-74 T1 to T4 (ticket section 6; review 16, SIG-64 comment 40700; rulings 40705 and of
// 26 November 2026), written before the change they test. The oracle reads only the committed word
// list (words.ts), never src/. T3's baseline was taken at ff66973 (make-baseline.ts).
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { INCOME_METHOD_VERSION } from "../../../src/engines/affordability/income.js";
import { KEYWORD_LIST_VERSION, maskText } from "../../../src/engines/display-mask.js";
import { INC_VERSION } from "../../../src/engines/families/inc/index.js";
import { LIA_VERSION } from "../../../src/engines/families/lia/index.js";
import { LENDER_NAMES, lenderOf } from "../../../src/engines/families/lia/lenders.js";
import { repeat } from "../../families/lia/script.js";
import { runProbe, strings, type ProbeRun } from "../sig64/probes.js";
import {
  applicantFor,
  fragmentsOf,
  keywordsIn,
  KEYWORDS,
  leaksOf,
  SPLITTERS,
  tokensOf,
} from "./corpus.js";
import { BASELINE_74, corpusHashes, setHashes } from "./hashes.js";

const plain = new Map<string, ProbeRun>();
beforeAll(() => {
  for (const k of KEYWORDS) plain.set(k, applicantFor(k, null));
}, 300_000);

/**
 * T1 as run (comment 40710): it fails on CARDIOLOG and CARDIAC only, in every splitter, through
 * LIA's loan-type reading ("CAR<ZWSP>DIOLOGY" is typed a car loan, so "(car loan)" shows). Colin
 * accepted the result as run on 26 November 2026, and the type reading is SIG-75. Deviation D2
 * (D28): CI asserts that this recorded result reproduces exactly, so any other leak, or a change
 * to these, fails. SIG-75 removes the exception.
 */
const T1_AS_RUN = ["CARDIOLOG: fragment CAR", "CARDIAC: fragment CAR"];

describe("T1: a keyword split by an invisible character at any position leaves nothing", () => {
  it("the plain controls show no keyword", () => {
    const found = KEYWORDS.flatMap((k) =>
      strings(plain.get(k))
        .flatMap(keywordsIn)
        .map((w) => `${k}: ${w}`),
    );
    expect(found).toEqual([]);
  });
  it.each(SPLITTERS.map(([name, c]) => [name, c]))(
    "split by %s: only the recorded CAR result (as run, D2); otherwise 0 keywords and 0 fragments",
    (_name, c) => {
      const failures: string[] = [];
      for (const k of KEYWORDS) {
        const base = plain.get(k);
        if (!base) throw new Error(`no plain control for ${k}`);
        const leaks = leaksOf(k, applicantFor(k, c), base);
        if (leaks.length > 0) failures.push(`${k}: ${leaks.join(", ")}`);
      }
      expect(failures).toEqual(T1_AS_RUN);
    },
    300_000,
  );
});

/** Review 16's E6 strings (SIG-74 section 1). */
const E6: readonly [string, string][] = [
  ["IV\u200bF", "IVF"],
  ["CARDIO\u200bLOGY", "CARDIOLOGY"],
  ["HOSP\u200bITAL", "HOSPITAL"],
  ["CATH\u2060OLIC", "CATHOLIC"],
  ["PAR\u00adISH", "PARISH"],
];
const provider = (s: string) =>
  s
    .toUpperCase()
    .replace(/\d/g, "")
    .replace(/[^A-Z ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["LOAN", "REPAYMENT", "REPAY"].includes(w))
    .join(" ");

describe("T2: review 16's E6 strings show the real lender, [withheld] or a lender, never a fragment", () => {
  // Deviation D1 (Colin, 26 November 2026): as first written, this check counted any token equal
  // to a fragment, so "credit card", which LIA prints for every card account, counted as the
  // fragment CARD of CARDIOLOGY. It now counts against the same probe with the keyword unsplit,
  // as T1 does.
  const noFragment = (k: string, texts: string[], plainTexts: string[]) => {
    const tally = (xs: string[]) => {
      const m = new Map<string, number>();
      for (const t of xs.flatMap(tokensOf)) m.set(t, (m.get(t) ?? 0) + 1);
      return m;
    };
    const now = tally(texts);
    const base = tally(plainTexts);
    return fragmentsOf(k).filter((f) => (now.get(f) ?? 0) > (base.get(f) ?? 0));
  };
  it.each(E6)("%s before a lender shows the lender (NIMBLE)", (s, k) => {
    expect(lenderOf(provider(`${s} NIMBLE REPAY`), `${s} NIMBLE REPAY`)).toBe("NIMBLE");
    const r = runProbe(
      repeat(13, 14, { description: `${s} NIMBLE REPAY`, amount: -45, category: "sacc_loan" }, 3),
      [],
    );
    const p = runProbe(
      repeat(13, 14, { description: `${k} NIMBLE REPAY`, amount: -45, category: "sacc_loan" }, 3),
      [],
    );
    const shown = (x: ProbeRun) => [
      ...x.lia.liabilities.map((l) => l.provider),
      x.lia.signals.find((y) => y.id === "LIA-03")?.reason ?? "",
    ];
    expect(r.lia.liabilities.map((l) => l.provider)).toEqual(["NIMBLE"]);
    expect(noFragment(k, shown(r), shown(p))).toEqual([]);
  });
  it.each(E6)("%s alone shows a lender or [withheld]", (s, k) => {
    const r = runProbe(
      repeat(6, 30, {
        description: `${s} LOAN REPAYMENT 88123`,
        amount: -310,
        category: "loan_repayment",
      }),
      [],
    );
    const plainRun = runProbe(
      repeat(6, 30, {
        description: `${k} LOAN REPAYMENT 88123`,
        amount: -310,
        category: "loan_repayment",
      }),
      [],
    );
    for (const p of r.lia.liabilities.map((l) => l.provider))
      expect(["a lender", "[withheld]"]).toContain(p);
    expect(noFragment(k, strings(r.lia), strings(plainRun.lia))).toEqual([]);
  });
  it.each(E6)("%s in a loan or card account's product name shows no fragment", (s, k) => {
    const r = runProbe(
      [],
      [],
      [
        { accountId: "acc-loan", productCategory: "PERS_LOANS", productName: `${s} Lending` },
        { accountId: "acc-card", productCategory: "CRED_AND_CHRG_CARDS", productName: `${s} Visa` },
      ],
    );
    const plainRun = runProbe(
      [],
      [],
      [
        { accountId: "acc-loan", productCategory: "PERS_LOANS", productName: `${k} Lending` },
        { accountId: "acc-card", productCategory: "CRED_AND_CHRG_CARDS", productName: `${k} Visa` },
      ],
    );
    expect(r.lia.liabilities).toHaveLength(2);
    expect(noFragment(k, strings(r.lia), strings(plainRun.lia))).toEqual([]);
    expect(strings(r.lia).flatMap(keywordsIn)).toEqual([]);
  });
  it("a default-ignorable character that isn't Cf is removed before matching: I\u034fVF CLINIC", () => {
    expect(maskText("I\u034fVF CLINIC")).toBe("[withheld] [withheld]");
    expect(maskText("I\ufe0fVF CLINIC")).toBe("[withheld] [withheld]");
    expect(maskText("I\u2800VF CLINIC")).toBe("[withheld] [withheld]");
  });
});

describe("T3: states, values, counts and figures are unchanged", () => {
  const baseline = JSON.parse(readFileSync(BASELINE_74, "utf8")) as {
    commit: string;
    sets: Record<string, Record<string, string>>;
    corpus: Record<string, string | number>;
  };
  it("the baseline was taken at ff66973, before any SIG-74 change", () => {
    expect(baseline.commit).toBe("ff66973333b436e898979c5ac88b8b304f577cd2");
  });
  it.each(["synthetic-v1", "synthetic-v2.2"] as const)(
    "%s: LIA, INC and observed income are byte-identical to LIA 1.3.5, INC 1.2.3 and 1.0.2, text included",
    (set) => {
      expect(setHashes(set)).toEqual(baseline.sets[set]);
    },
    600_000,
  );
  it("the all-positions corpus: every engine's states, values, counts and figures are unchanged", () => {
    expect(corpusHashes()).toEqual(baseline.corpus);
  }, 600_000);
});

describe("T4: every LENDER_NAMES entry, and any CREDIT UNION, still shows unmasked", () => {
  it.each([...LENDER_NAMES, "EXAMPLE CREDIT UNION"].map((n) => [n]))("%s", (n) => {
    expect(maskText(n)).toBe(n);
    if (!n.endsWith("CREDIT UNION") || LENDER_NAMES.includes(n))
      expect(lenderOf(provider(n), `${n} LOAN 4417`)).toBe(n);
  });
});

describe("versions (SIG-74 method, Versions; Colin, 26 November 2026)", () => {
  it("keyword list 1.1.0, LIA 1.3.6, INC 1.2.4, observed income 1.0.3", () => {
    expect(KEYWORD_LIST_VERSION).toBe("1.1.0");
    expect(LIA_VERSION).toBe("1.3.6");
    expect(INC_VERSION).toBe("1.2.4");
    expect(INCOME_METHOD_VERSION).toBe("1.0.3");
  });
  it("every result records the keyword list's version", () => {
    const r = applicantFor("IVF", "\u200b");
    expect([r.lia, r.inc, r.income].map((x) => x.keyword_list_version)).toEqual([
      "1.1.0",
      "1.1.0",
      "1.1.0",
    ]);
  });
  it("SIG-16-team-grants.json records observed income 1.0.3, amended on 26 November", () => {
    const prereg = readFileSync("research/preregistrations/SIG-16-team-grants.json", "utf8");
    expect(prereg).toContain('"income_method_version": "1.0.3"');
    expect(prereg).toMatch(/2026-11-26[^"]*1\.0\.2[^"]*1\.0\.3/);
  });
});
