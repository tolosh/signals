// SIG-64: the probe corpus (reviews 9, 10 and 12, plus a new adversarial set) and an oracle for
// sensitive keywords in displayed text that is written here, apart from the engines' masker, so
// T1 and T6 don't check the masker against itself.
//
// The oracle reads text the way a person would: NFKC (fullwidth ＩＶＦ is IVF), invisible format
// characters (Unicode Cf: zero-width space, soft hyphen) removed, upper case; a word is a run of
// letters and digits, and a run of letters inside it is a word too (IVF4417 contains IVF). A
// keyword inside a known lender name, or in the phrase CREDIT UNION, is not a leak (ruling of
// 19 November 2026; SIG-64 method, Exemptions).
import { deriveIncome } from "../../../src/engines/affordability/income.js";
import { deriveObservedExpenses } from "../../../src/engines/affordability/observed-expenses.js";
import type { Feed } from "../../../src/engines/evidence/index.js";
import { assessInc } from "../../../src/engines/families/inc/index.js";
import { assessLia, type LiaResult } from "../../../src/engines/families/lia/index.js";
import { LENDER_NAMES, SENSITIVE_WORDS } from "../../../src/engines/families/lia/lenders.js";
import { AS_OF, build, repeat, type Line } from "../../families/lia/script.js";

/**
 * Review 12's list gaps and the groups SIG-64 adds (union names, denominations, medical
 * specialties, health insurers): the words the keyword list must cover from 1.0.0, beside the
 * 1.3.4 list (SENSITIVE_WORDS). A trailing * is a stem.
 */
export const ADDED_KEYWORDS: readonly string[] = [
  // unions (ACTU affiliates)
  "CFMEU",
  "CFMMEU",
  "AMWU",
  "ANMF",
  "AWU",
  "CPSU",
  "ETU",
  "HSU",
  "MUA",
  "NTEU",
  "SDA",
  "TWU",
  "UWU",
  "AEU",
  "IEU",
  "ASU",
  "CEPU",
  "RTBU",
  "FSU",
  "MEAA",
  "AMIEU",
  "UNIONS",
  // religious denominations (ABS ASCRG)
  "CATHOLIC",
  "ANGLICAN",
  "UNITING",
  "PRESBYTERIAN",
  "BAPTIST",
  "METHODIST",
  "LUTHERAN",
  "PENTECOSTAL",
  "ORTHODOX",
  "ADVENTIST",
  "SALVATION",
  "SALVOS",
  "HILLSONG",
  "CHRISTIAN",
  "ISLAMIC",
  "MUSLIM",
  "JEWISH",
  "HINDU",
  "BUDDHIST",
  "SIKH",
  "JEHOVAH",
  "MORMON",
  "CHAPEL",
  "CONGREGATION",
  // medical specialties (Medical Board of Australia list of specialties)
  "CARDIOLOG*",
  "CARDIAC",
  "DERMATOLOG*",
  "GYNAECOLOG*",
  "GYNECOLOG*",
  "OBSTETRIC*",
  "OBGYN",
  "NEUROLOG*",
  "NEUROSURG*",
  "UROLOG*",
  "ENDOCRINOLOG*",
  "GASTROENTEROLOG*",
  "HAEMATOLOG*",
  "HEMATOLOG*",
  "NEPHROLOG*",
  "RHEUMATOLOG*",
  "OPHTHALMOLOG*",
  "PAEDIATRIC*",
  "PEDIATRIC*",
  "ANAESTHE*",
  "ANESTHE*",
  "ORTHOPAED*",
  "ORTHOPED*",
  "IMMUNOLOG*",
  "ALLERGIST",
  "GERIATRIC*",
  "PALLIATIVE",
  "DIALYSIS",
  "RADIOTHERAP*",
  // health insurers (privatehealth.gov.au)
  "BUPA",
  "MEDIBANK",
  "HCF",
  "NIB",
  "AHM",
  "HBF",
  "GMHBA",
  "CBHS",
  "HIF",
  "TUH",
  "PEOPLECARE",
  "WESTFUND",
  "ONEMEDIFUND",
  "HEALTHCARE",
];

/** Lender names SIG-64 adds that must show unmasked (T2), beside every LENDER_NAMES entry. */
export const UNMASKED_NAMES = [
  "OSTEON FINANCE",
  "POLICE CREDIT UNION",
  "HEALTH PROFESSIONALS BANK",
];

const FORMAT = /\p{Cf}/gu;
const formOf = (s: string) => s.normalize("NFKC").replace(FORMAT, "").toUpperCase();
const TOKEN = /[\p{L}\p{M}\p{N}]+/gu;

/** The oracle's keyword test, over the 1.3.4 list, SIG-64's additions and any extra words. */
export function oracle(extra: readonly string[] = []) {
  const all = [...SENSITIVE_WORDS, ...ADDED_KEYWORDS, ...extra];
  const stems = all.filter((w) => w.endsWith("*")).map((w) => w.slice(0, -1));
  const words = new Set(all.filter((w) => !w.endsWith("*")));
  const hit = (w: string) => words.has(w) || stems.some((s) => w.startsWith(s));
  const phrases = [...LENDER_NAMES, ...UNMASKED_NAMES, "CREDIT UNION"].map((p) => p.split(" "));
  /** The sensitive keywords a displayed text shows, outside a lender name or CREDIT UNION. */
  return (text: string): string[] => {
    const tokens = formOf(text).match(TOKEN) ?? [];
    const exempt = new Set<number>();
    for (const p of phrases)
      for (let i = 0; i + p.length <= tokens.length; i++)
        if (p.every((w, j) => tokens[i + j] === w))
          for (let j = 0; j < p.length; j++) exempt.add(i + j);
    return tokens.filter(
      (t, i) =>
        !exempt.has(i) && (hit(t) || (t.match(/\p{L}+/gu) ?? []).some((r) => r !== t && hit(r))),
    );
  };
}

/** Every string anywhere in an engine's output. */
export function strings(x: unknown): string[] {
  if (typeof x === "string") return [x];
  if (Array.isArray(x)) return x.flatMap(strings);
  if (x && typeof x === "object") return Object.values(x).flatMap(strings);
  return [];
}

/** The written forms T1 puts each keyword in. A stem is written as the stem itself. */
export const FORMS: readonly [string, (w: string) => string][] = [
  ["plain", (w) => w],
  ["fullwidth", (w) => w.replace(/[A-Z]/g, (c) => String.fromCodePoint(c.charCodeAt(0) + 0xfee0))],
  ["zero-width-split", (w) => `${w.slice(0, 1)}\u200b${w.slice(1)}`],
  ["soft-hyphen-split", (w) => `${w.slice(0, 1)}\u00ad${w.slice(1)}`],
  ["nfd", (w) => w.normalize("NFD")],
  ["mixed-case", (w) => [...w].map((c, i) => (i % 2 ? c.toLowerCase() : c)).join("")],
  ["punctuation", (w) => `(${w}),`],
  ["hyphen-attached", (w) => `-${w}-`],
  ["digits-attached", (w) => `${w}4417`],
];
export const keywordWord = (k: string) => (k.endsWith("*") ? k.slice(0, -1) : k);

/** Review 9, 10 and 12's probe narratives, and SIG-64's adversarial ones. */
export const PROBE_NARRATIVES: readonly string[] = [
  // reviews 9 and 10
  "MACQUARIE IVF CLINIC REF",
  "HUMM SMILE DENTAL",
  "IVF NIMBLE REPAY",
  "ONCOLOGY HARMONEY LOAN",
  "IVF CASH CONVERTERS",
  "PSYCHOLOGY CLINIC WALLET WIZARD",
  "IVF CLINIC",
  "IVF HARMONEY LOAN",
  // review 12
  "ＩＶＦ NIMBLE REPAY",
  "I\u200bVF NIMBLE REPAY",
  "OSTEON FINANCE",
  "CFMEU NIMBLE",
  "CATHOLIC NIMBLE",
  "CARDIOLOGY NIMBLE",
  "BUPA NIMBLE",
  "NIMBLE4417",
  "4417NIMBLE",
  "HARMONEY88123",
  "ZÖP LOAN REPAYMENT".normalize("NFD"),
  "POLICE CREDIT UNION",
  "HEALTH PROFESSIONALS BANK",
  "ONCOLOGY PAYROLL",
  "PSYCH SERVICES PAYROLL",
  "PARISH OF ST MARY",
  "HOSPITAL SALARY",
  // adversarial (SIG-64)
  "ｃａｒｄｉｏｌｏｇｙ NIMBLE",
  "Bu\u200dpa NIMBLE",
  "(IVF), NIMBLE",
  "IVF4417 NIMBLE",
  "CA\u00adTHOLIC PAYROLL",
  "Anglican Parish Payroll",
  "MEDIBANK NIMBLE",
  "AMWU DUES NIMBLE",
];
export const PROBE_DECLARED: readonly string[] = [
  "IVF clinic loan",
  "IVF Harmoney",
  "ＩＶＦ clinic loan",
  "I\u200bVF clinic loan",
  "Osteon Finance",
  "Police Credit Union",
  "Health Professionals Bank",
  "CFMEU loan",
  "Catholic loan",
  "Cardiology loan",
  "Bupa loan",
];

/** One applicant per probe narrative: it is a loan, a SACC, a BNPL, a pay credit and an account. */
export function probeLines(narrative: string, i: number): Line[] {
  const amount = 300 + i * 7;
  return [
    ...repeat(6, 30, {
      description: `${narrative} 88123`,
      amount: -amount,
      category: "loan_repayment",
    }),
    ...repeat(13, 14, { description: narrative, amount: -(40 + i), category: "sacc_loan" }, 3),
    ...repeat(13, 14, { description: `${narrative} BNPL`, amount: -(20 + i), category: "bnpl" }, 4),
    ...repeat(6, 14, { description: narrative, amount: 1200 + i }, 1),
  ];
}
export type ProbeRun = {
  lia: LiaResult;
  inc: ReturnType<typeof assessInc>;
  income: ReturnType<typeof deriveIncome>;
  expenses: ReturnType<typeof deriveObservedExpenses>;
};

/** Runs LIA, INC, observed income and observed expenses on a probe applicant. */
export function runProbe(
  lines: Line[],
  declared: { type: string; provider: string; repayment_monthly?: number }[],
  accounts: { accountId: string; productCategory: string; productName: string }[] = [],
): ProbeRun {
  const { feed, categories } = build({ lines, accounts });
  return {
    lia: assessLia({
      feed,
      feed_type: "cdr",
      as_of: AS_OF,
      lookback_months: 6,
      categories,
      application: { declared_liabilities: declared },
    }),
    inc: assessInc({
      feed: feed as unknown as Feed,
      feed_type: "cdr",
      as_of: AS_OF,
      lookback_months: 6,
      categories,
    }),
    income: deriveIncome({
      feed: feed as never,
      as_of: AS_OF,
      lookback_months: 6,
      min_occurrences: 3,
      categories,
    }),
    expenses: deriveObservedExpenses({
      feed: feed as never,
      categories,
      as_of: AS_OF,
      lookback_months: 6,
      one_off_threshold_aud: 5000,
    }),
  };
}

/** The probe corpus: every narrative, with a declaration and an account for each. */
export function probeCorpus(): ProbeRun[] {
  return PROBE_NARRATIVES.map((n, i) =>
    runProbe(
      probeLines(n, i),
      [
        {
          type: "personal_loan",
          provider: PROBE_DECLARED[i % PROBE_DECLARED.length] ?? "",
          repayment_monthly: 300 + i * 7,
        },
      ],
      [{ accountId: "acc-loan", productCategory: "PERS_LOANS", productName: `${n} Personal Loan` }],
    ),
  );
}
