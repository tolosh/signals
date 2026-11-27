// SIG-83: LIA's category-independent detection (research/preregistrations/SIG-83.json; ruling
// 40766). Written before the change and pushed failing. T1 to T6 are the ticket's tests.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dayOf } from "../../../src/engines/evidence/dates.js";
import { LIA_VERSION } from "../../../src/engines/families/lia/index.js";
import { detectLiabilities } from "../../../src/engines/liabilities/index.js";
import { checkRotation, rotateListed, rot13 } from "../../../src/research/sig83/control.js";
import { AS_OF, build, run, type Line } from "../../families/lia/script.js";

const END = dayOf(AS_OF);
/** The 15th of each month from May to October 2026: six calendar-monthly dates. */
const MONTHLY = ["05", "06", "07", "08", "09", "10"].map((m) => END - dayOf(`2026-${m}-15`));
const debits = (
  description: string,
  amounts: number[],
  agos = MONTHLY,
  extra: Partial<Line> = {},
) =>
  agos.map((ago, i) => ({
    ago,
    description,
    amount: -(amounts[i % amounts.length] as number),
    category: "other_expenses",
    ...extra,
  }));
const found = (lines: Line[], config: Record<string, unknown> = {}) =>
  run({ lines }, { declared_liabilities: [] }, config as never).liabilities;
const PL = "COMMONWEALTH BANK PL REPAYMENT 448812";

describe("T1: a recurring debit to a listed lender is detected whatever its category", () => {
  it("monthly, same amount, categorised other_expenses: a loan to COMMONWEALTH BANK", () => {
    const l = found(debits(PL, [412.5]));
    const hit = l.find((d) => d.provider === "COMMONWEALTH BANK");
    expect(hit).toMatchObject({ family: "loan", cadence: "monthly", occurrences: 6 });
    expect(hit?.declared).toBe(false);
    expect(hit?.monthly).toBe(412.5);
  });
  it("fortnightly and weekly cadences, and amounts within 5% of the median", () => {
    const fortnightly = Array.from({ length: 8 }, (_, i) => 5 + i * 14);
    const weekly = Array.from({ length: 10 }, (_, i) => 4 + i * 7);
    expect(found(debits(PL, [200, 205, 196], fortnightly))[0]).toMatchObject({
      provider: "COMMONWEALTH BANK",
      cadence: "fortnightly",
    });
    expect(found(debits("BENDIGO BANK LOAN 9921", [80], weekly))[0]).toMatchObject({
      provider: "BENDIGO BANK",
      cadence: "weekly",
    });
  });
  it("the biller name is read when the narrative names no listed lender", () => {
    const l = found(debits("BPAY 448812", [300], MONTHLY, { billerName: "MACQUARIE BANK" }));
    expect(l.map((d) => d.provider)).toContain("MACQUARIE BANK");
  });
  it("a card, when the text has CARD", () => {
    const l = found(debits("AMERICAN EXPRESS CARD PAYMENT", [150]));
    expect(l[0]).toMatchObject({ family: "credit_card", provider: "AMERICAN EXPRESS" });
  });
  it("amounts beyond 5% of the median aren't detected", () => {
    expect(found(debits(PL, [400, 450, 360, 430, 470, 350]))).toEqual([]);
  });
  it("irregular dates aren't detected", () => {
    expect(found(debits(PL, [412.5], [5, 12, 50, 61, 100, 160]))).toEqual([]);
  });
  it("fewer than 3 debits aren't detected", () => {
    expect(found(debits(PL, [412.5], MONTHLY.slice(0, 2)))).toEqual([]);
  });
  it("an unlisted name (COMMBANK) isn't a candidate (40766, 1: LENDER_NAMES only)", () => {
    expect(found(debits("COMMBANK PL REPAYMENT 448812", [412.5]))).toEqual([]);
  });
  it("LIA 1.3.6's arm (step (d) off) doesn't detect it", () => {
    expect(found(debits(PL, [412.5]), { category_independent: false })).toEqual([]);
  });
});

describe("T2: own-account transfers and transfers aren't detected", () => {
  it("a narrative with a BSB and account number, naming the applicant's bank", () => {
    expect(found(debits("COMMONWEALTH BANK 062-000 11112222", [500]))).toEqual([]);
  });
  it("a debit categorised transfer", () => {
    expect(found(debits(PL, [412.5], MONTHLY, { category: "transfer" }))).toEqual([]);
  });
});

describe("T3: the negative control", () => {
  it("ROT13 rotates every listed name, whole words, and leaves the rest", () => {
    expect(rot13("COMMONWEALTH BANK")).toBe("PBZZBAJRNYGU ONAX");
    expect(rotateListed(PL)).toBe("PBZZBAJRNYGU ONAX PL REPAYMENT 448812");
    expect(rotateListed("COLES 4729")).toBe("COLES 4729");
  });
  it("a rotated feed names no listed lender, and the rotated control detects nothing new", () => {
    const { feed } = build({ lines: debits(rotateListed(PL), [412.5]) });
    expect(() => checkRotation([feed])).not.toThrow();
    expect(found(debits(rotateListed(PL), [412.5]))).toEqual([]);
  });
  it("the committed control record passed", () => {
    expect(existsSync("research/runs/sig83-control.json")).toBe(true);
    const r = JSON.parse(readFileSync("research/runs/sig83-control.json", "utf8")) as {
      control_passes: boolean;
      rotation_check: { passed: boolean };
    };
    expect(r.rotation_check.passed).toBe(true);
    expect(r.control_passes).toBe(true);
  });
});

type Rec = {
  lia_version: string;
  applicants_whose_liabilities_changed: string[];
  arms: Record<string, { precision: number | null; recall: number | null }>;
};
const record = (r: string) => {
  const path = `research/runs/sig83-${r}.json`;
  expect(existsSync(path), path).toBe(true);
  return JSON.parse(readFileSync(path, "utf8")) as Rec;
};

describe("T4: set v1 unchanged; v2.2 reported against 1.3.6", () => {
  it("set v1: 1.4.0's liabilities are byte-identical to 1.3.6's, at 1.00 and 1.00", () => {
    const r = record("v1");
    expect(r.lia_version).toBe("1.4.0");
    expect(r.applicants_whose_liabilities_changed).toEqual([]);
    expect(r.arms["1.4.0"]).toEqual(r.arms["1.3.6"]);
  });
  it("set v2.2's record holds both arms' precision and recall, as run", () => {
    const r = record("v2.2");
    for (const arm of ["1.3.6", "1.4.0"]) {
      expect(typeof r.arms[arm]?.precision).toBe("number");
      expect(typeof r.arms[arm]?.recall).toBe("number");
    }
  });
});

describe("T5: commit order", () => {
  const firstCommit = (path: string) =>
    execFileSync("git", ["log", "--format=%H", "--diff-filter=A", "--reverse", "--", path], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")[0] ?? "";
  const isAncestor = (a: string, b: string) => {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", a, b]);
      return a !== b;
    } catch {
      return false;
    }
  };
  it("the pre-registration precedes the change and every SIG-83 run record", () => {
    const prereg = firstCommit("research/preregistrations/SIG-83.json");
    expect(prereg).not.toBe("");
    const change = execFileSync(
      "git",
      [
        "log",
        "--format=%H",
        "--reverse",
        "-S",
        'LIA_VERSION = "1.4.0"',
        "--",
        "src/engines/families/lia/index.ts",
      ],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")[0];
    expect(change).toBeTruthy();
    expect(isAncestor(prereg, change as string)).toBe(true);
    for (const r of ["control", "v2.2", "v1", "v2.3"]) {
      const path = `research/runs/sig83-${r}.json`;
      expect(existsSync(path), path).toBe(true);
      expect(isAncestor(prereg, firstCommit(path)), path).toBe(true);
    }
  });
});

describe("T6: mutation, step (d) restricted to the liability categories", () => {
  it("T1's debit is then not detected, so T1 would fail", () => {
    const { feed, categories } = build({ lines: debits(PL, [412.5]) });
    const input = {
      feed,
      categories,
      declared: [],
      as_of: AS_OF,
      min_occurrences: 3,
      amount_tolerance: 0.15,
    };
    const any = detectLiabilities({ ...input, step_d: { categories: "any" } } as never);
    const mutated = detectLiabilities({
      ...input,
      step_d: { categories: "liability_only" },
    } as never);
    expect(any.liabilities.map((d) => d.provider)).toContain("COMMONWEALTH BANK");
    expect(mutated.liabilities.map((d) => d.provider)).not.toContain("COMMONWEALTH BANK");
  });
});

describe("version", () => {
  it("LIA is 1.4.0 and records detector 1.1.0", () => {
    expect(LIA_VERSION).toBe("1.4.0");
    expect(run({ lines: [] }, { declared_liabilities: [] }).detector.method_version).toBe("1.1.0");
  });
});
