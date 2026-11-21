// D29 display masking (SIG-64; rulings of 19 November 2026 on review 12, and 21 November 2026,
// comment 40524): one shared, versioned list of sensitive keywords, and the one masker every
// engine applies to the text a lender sees (reasons, review reasons, resolve-with text, lender
// and payer names, the applicant's declared text). It is for display only: what an engine
// detects, matches or counts never reads it. The GR-3 gate (sensitive.ts, 1.2.0) is separate and
// unchanged, and G-2 stays the limit for detection (ADR 0007).
//
// A word matches after NFKC (fullwidth ＩＶＦ is IVF), with invisible format characters (Unicode
// Cf: zero-width space and joiner, soft hyphen) removed, in upper case. A word is a run of
// letters, marks and digits; a run of letters inside it is checked too, so IVF4417 is masked. A
// stem (a keyword ending in *) covers its endings: the safer side, kept by ruling. A word inside
// a known lender name (lender-names.ts) or the phrase CREDIT UNION is never masked.
//
// Pure: no clock, no randomness, relative imports (D3).
import { LENDER_NAMES } from "./lender-names.js";

/** 1.0.0 (SIG-64): LIA 1.3.4's list, moved here and shared, with review 12's gaps added. */
export const KEYWORD_LIST_VERSION = "1.0.0";

/** Where each group's words come from. */
export const KEYWORD_SOURCES: Readonly<Record<string, string>> = Object.freeze({
  medical:
    "GR-3 medical and pharmacy (ADR 0007), as a narrative or an applicant writes them (LIA 1.3.4, SIG-42 rulings of 16 November 2026); specialties from the Medical Board of Australia's list of specialties, fields of specialty practice and related specialist titles",
  religious:
    "GR-3 religious organisations (ADR 0007); denominations from the ABS Australian Standard Classification of Religious Groups (cat. 1266.0)",
  unions: "GR-3 unions (ADR 0007); union names from the ACTU's list of affiliated unions",
  political: "GR-3 political parties (ADR 0007), LIA 1.3.4's word PARTY",
  "health insurers":
    "registered private health insurers, from privatehealth.gov.au (Commonwealth Ombudsman); HEALTH itself is a medical keyword",
});

/** Whole words, upper case; a trailing * is a stem. */
export const SENSITIVE_KEYWORDS: readonly string[] = [
  // medical and pharmacy (LIA 1.3.4)
  "IVF",
  "FERTILITY",
  "CLINIC",
  "CLINICS",
  "HOSPITAL",
  "HOSPITALS",
  "MEDICAL",
  "MEDICARE",
  "MEDICINE",
  "DOCTOR",
  "DOCTORS",
  "GP",
  "APPT",
  "APPOINTMENT",
  "SURGERY",
  "SURGICAL",
  "ONCOLOG*",
  "CANCER",
  "CHEMO*",
  "RADIOLOG*",
  "PATHOLOG*",
  "DENTAL",
  "DENTIST",
  "DENTISTS",
  "DENTISTRY",
  "ORTHODONT*",
  "SMILE",
  "PSYCH*",
  "COUNSELLING",
  "COUNSELLOR",
  "THERAPY",
  "THERAPIST",
  "REHAB",
  "REHABILITATION",
  "PHYSIO*",
  "CHIRO*",
  "OSTEO*",
  "PODIAT*",
  "OPTOMETR*",
  "AUDIOLOG*",
  "HEARING",
  "HEALTH",
  "PHARMACY",
  "PHARMACIES",
  "CHEMIST",
  "CHEMISTS",
  "DISPENSARY",
  // medical specialties (SIG-64; Medical Board of Australia)
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
  // health insurers (SIG-64; privatehealth.gov.au)
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
  // religious (LIA 1.3.4)
  "CHURCH",
  "PARISH",
  "DIOCESE",
  "MOSQUE",
  "SYNAGOGUE",
  "TEMPLE",
  "GURDWARA",
  "TITHE",
  // religious denominations (SIG-64; ABS ASCRG)
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
  // unions and political parties (LIA 1.3.4)
  "UNION",
  "PARTY",
  // union names (SIG-64; ACTU affiliates)
  "UNIONS",
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
];

/** What a masked word shows as. */
export const WITHHELD = "[withheld]";
/** Phrases never masked: every listed lender name, and CREDIT UNION. */
export const EXEMPT_PHRASES: readonly string[] = [...LENDER_NAMES, "CREDIT UNION"];

const FORMAT = /\p{Cf}/gu;
const TOKEN = /[\p{L}\p{M}\p{N}]+/gu;
const LETTERS = /\p{L}+/gu;
const STEMS = SENSITIVE_KEYWORDS.filter((w) => w.endsWith("*")).map((w) => w.slice(0, -1));
const WORDS = new Set(SENSITIVE_KEYWORDS.filter((w) => !w.endsWith("*")));
const PHRASES = EXEMPT_PHRASES.map((p) => p.split(" "));
const hit = (form: string) => WORDS.has(form) || STEMS.some((s) => form.startsWith(s));

/** Text as it is shown: invisible format characters removed, NFC. */
export const cleanText = (text: string): string => text.replace(FORMAT, "").normalize("NFC");

/** The masker's three parts, each of which T7 switches off in turn. */
export type MaskOptions = { nfkc: boolean; stripFormat: boolean; exemptions: boolean };

export function makeMasker(o: MaskOptions) {
  const formOf = (word: string) => {
    const n = word.normalize(o.nfkc ? "NFKC" : "NFC");
    return (o.stripFormat ? n.replace(FORMAT, "") : n).toUpperCase();
  };
  /** True when a word, in any case or width, is sensitive, or has a run of letters that is. */
  const isSensitiveWord = (word: string): boolean => {
    const form = formOf(word);
    return hit(form) || (form.match(LETTERS) ?? []).some((r) => r !== form && hit(r));
  };
  /** The text with each sensitive word shown as [withheld], outside a lender name. */
  const mask = (text: string): string => {
    const t = (o.stripFormat ? text.replace(FORMAT, "") : text).normalize("NFC");
    const tokens = [...t.matchAll(TOKEN)];
    const forms = tokens.map((m) => formOf(m[0]));
    const exempt = new Set<number>();
    if (o.exemptions)
      for (const p of PHRASES)
        for (let i = 0; i + p.length <= forms.length; i++)
          if (p.every((w, j) => forms[i + j] === w))
            for (let j = 0; j < p.length; j++) exempt.add(i + j);
    let out = "";
    let at = 0;
    tokens.forEach((m, i) => {
      const start = m.index ?? 0;
      out += t.slice(at, start) + (!exempt.has(i) && isSensitiveWord(m[0]) ? WITHHELD : m[0]);
      at = start + m[0].length;
    });
    return out + t.slice(at);
  };
  return { mask, isSensitiveWord };
}

const masker = makeMasker({ nfkc: true, stripFormat: true, exemptions: true });
/** Every displayed text goes through this (T7 replaces it to prove each engine does). */
export const maskText = (text: string): string => masker.mask(text);
export const isSensitiveWord = (word: string): boolean => masker.isSensitiveWord(word);
