// Descriptor library for the synthetic generator (SIG-12). Formats follow Australian bank
// descriptors so that Enrich's deterministic tiers can categorise them (the SIG-12 caution).
// MCCs are standard ISO 18245 codes. BPAY biller codes are synthetic unless `verified` is set.

export type Merchant = { name: string; descriptor: string; mcc: string };
export type Biller = { name: string; code: string; verified: boolean };

export const SUBURBS = [
  "SYDNEY",
  "PARRAMATTA",
  "BONDI JUNCTION",
  "CHATSWOOD",
  "MELBOURNE",
  "RICHMOND",
  "BRISBANE",
  "CHERMSIDE",
  "ADELAIDE",
  "PERTH",
] as const;
export const STATES: Record<string, string> = {
  SYDNEY: "NS",
  PARRAMATTA: "NS",
  "BONDI JUNCTION": "NS",
  CHATSWOOD: "NS",
  MELBOURNE: "VI",
  RICHMOND: "VI",
  BRISBANE: "QL",
  CHERMSIDE: "QL",
  ADELAIDE: "SA",
  PERTH: "WA",
};

export const GROCERY: Merchant[] = [
  { name: "Woolworths", descriptor: "WOOLWORTHS", mcc: "5411" },
  { name: "Coles", descriptor: "COLES", mcc: "5411" },
  { name: "Aldi", descriptor: "ALDI STORES", mcc: "5411" },
];
export const FUEL: Merchant[] = [
  { name: "Ampol", descriptor: "AMPOL", mcc: "5541" },
  { name: "BP", descriptor: "BP", mcc: "5541" },
  { name: "7-Eleven", descriptor: "7-ELEVEN", mcc: "5541" },
];
export const DINING: Merchant[] = [
  { name: "McDonald's", descriptor: "MCDONALDS", mcc: "5814" },
  { name: "Guzman y Gomez", descriptor: "GUZMAN Y GOMEZ", mcc: "5814" },
  { name: "Grill'd", descriptor: "GRILLD", mcc: "5812" },
  { name: "Menulog", descriptor: "MENULOG", mcc: "5812" },
];
export const SUBSCRIPTIONS: Merchant[] = [
  { name: "Netflix", descriptor: "NETFLIX.COM", mcc: "4899" },
  { name: "Spotify", descriptor: "SPOTIFY", mcc: "5815" },
];
export const TELCO: Merchant[] = [
  { name: "Telstra", descriptor: "TELSTRA", mcc: "4814" },
  { name: "Optus", descriptor: "OPTUS", mcc: "4814" },
];
export const GAMBLING: Merchant[] = [
  { name: "Sportsbet", descriptor: "SPORTSBET", mcc: "7995" },
  { name: "TAB", descriptor: "TAB TOUCH", mcc: "7995" },
];

export const BILLERS: Record<string, Biller> = {
  ato: { name: "AUSTRALIAN TAXATION OFFICE", code: "75556", verified: true },
  utilities: { name: "AGL ENERGY", code: "803072", verified: false },
  council_rates: { name: "CITY COUNCIL RATES", code: "325480", verified: false },
  insurance: { name: "NRMA INSURANCE", code: "411868", verified: false },
  car_registration: { name: "SERVICE NSW REGO", code: "394403", verified: false },
  school_fees: { name: "ST MARYS SCHOOL FEES", code: "290122", verified: false },
  credit_card: { name: "CREDIT CARD PAYMENT", code: "613711", verified: false },
};

export const EMPLOYERS = [
  "ACME CONSULTING PTY LTD",
  "HARBOUR LOGISTICS",
  "NORTHSIDE HEALTH",
  "BLUEGUM CONSTRUCTIONS",
  "CITY OF SYDNEY",
  "ORBIT RETAIL GROUP",
] as const;
export const GIG_PAYERS = ["UBER AUSTRALIA PTY", "DOORDASH AUSTRALIA", "AIRTASKER"] as const;

export const PROVIDERS: Record<string, readonly string[]> = {
  credit_card: ["CBA", "WESTPAC", "NAB", "ANZ"],
  personal_loan: ["SOCIETYONE", "PLENTI", "HARMONEY"],
  car_loan: ["MONEY3", "MACQUARIE LEASING", "FIRSTMAC"],
  mortgage: ["CBA HOME LOAN", "WESTPAC HOME LOAN"],
  bnpl: ["AFTERPAY", "ZIP PAY"],
  sacc: ["CASH CONVERTERS", "NIMBLE"],
  wage_advance: ["BEFOREPAY", "MYPAYNOW"],
};

// --- Set v2 (SIG-54) ---------------------------------------------------------------------------

/**
 * Lenders absent from SIG-18's runs (set v1's PROVIDERS) and, by this listing, from any alias
 * table SIG-57 pre-registers: SIG-57 must not add these names, or the unseen-lender group stops
 * testing what it was built for. The manifest records them.
 */
export const UNSEEN_PROVIDERS: Record<string, readonly string[]> = {
  credit_card: ["BANKWEST", "ING", "HSBC"],
  personal_loan: ["WISR", "LATITUDE", "NOW FINANCE"],
  car_loan: ["PEPPER MONEY", "ANGLE AUTO FINANCE"],
  bnpl: ["HUMM", "KLARNA"],
  sacc: ["SUNSHINE LOANS", "MONEYME"],
  wage_advance: ["CASHD", "EARND"],
};

/** How an applicant names a lender on an application, as opposed to how the feed does. */
export const NATURAL_NAMES: Record<string, string> = {
  CBA: "Commonwealth Bank",
  WESTPAC: "Westpac Banking Corporation",
  NAB: "National Australia Bank",
  ANZ: "ANZ Bank",
  SOCIETYONE: "SocietyOne Australia",
  PLENTI: "Plenti Finance",
  HARMONEY: "Harmoney Australia",
  MONEY3: "Money3 Corporation",
  "MACQUARIE LEASING": "Macquarie Leasing Pty Ltd",
  FIRSTMAC: "Firstmac Limited",
  "CBA HOME LOAN": "Commonwealth Bank home loan",
  "WESTPAC HOME LOAN": "Westpac home loan",
  AFTERPAY: "Afterpay Pty Ltd",
  "ZIP PAY": "Zip Co",
  "CASH CONVERTERS": "Cash Converters Personal Finance",
  NIMBLE: "Nimble Australia",
  BEFOREPAY: "Beforepay Group",
  MYPAYNOW: "MyPayNow",
  BANKWEST: "Bankwest",
  ING: "ING Australia",
  HSBC: "HSBC Bank Australia",
  WISR: "Wisr Finance",
  LATITUDE: "Latitude Financial Services",
  "NOW FINANCE": "NOW Finance Group",
  "PEPPER MONEY": "Pepper Money Ltd",
  "ANGLE AUTO FINANCE": "Angle Auto Finance",
  HUMM: "humm group",
  KLARNA: "Klarna Australia",
  "SUNSHINE LOANS": "Sunshine Loans Pty Ltd",
  MONEYME: "MoneyMe Financial Group",
  CASHD: "CashD Pty Ltd",
  EARND: "Earnd Pty Ltd",
};
/** The kind of credit, as an applicant adds it after the lender's name. */
export const NATURAL_SUFFIX: Record<string, string> = {
  credit_card: " credit card",
  personal_loan: " personal loan",
  car_loan: " car loan",
  mortgage: "",
  bnpl: "",
  sacc: "",
  wage_advance: "",
};

/** The same employer under a second descriptor (payer-name drift, SIG-16). */
export const EMPLOYER_ALIASES: Record<string, string> = {
  "ACME CONSULTING PTY LTD": "ACME CONSULTING P/L PAYROLL",
  "HARBOUR LOGISTICS": "HARBOUR LOGISTICS P/L WAGES",
  "NORTHSIDE HEALTH": "NTHSIDE HEALTH SVC PAY",
  "BLUEGUM CONSTRUCTIONS": "BLUEGUM CONST PAYROLL",
  "CITY OF SYDNEY": "COUNCIL CITY OF SYD SAL",
  "ORBIT RETAIL GROUP": "ORBIT RETAIL GRP PAY",
};

// --- Set v2.1 (SIG-54 review, 8 November 2026) -------------------------------------------------

/**
 * Lenders the detector hasn't seen, for set v2.1. None may appear in src/ or in any test outside
 * the generator (test/research/v21/leakage.test.ts scans for them). Set v2's HUMM, KLARNA and
 * CASHD were in the engines' own advance and loan rules, so 2.1 replaces them.
 */
export const UNSEEN_PROVIDERS_V21: Record<string, readonly string[]> = {
  credit_card: ["BANKWEST", "ING", "HSBC"],
  personal_loan: ["WISR", "LATITUDE", "NOW FINANCE"],
  car_loan: ["PEPPER MONEY", "ANGLE AUTO FINANCE"],
  bnpl: ["PAYRIGHT", "BUNDLL"],
  sacc: ["SUNSHINE LOANS", "MONEYME"],
  wage_advance: ["EARND", "HASTEE"],
};

/**
 * Set v2.1: names an applicant would write that genuinely differ from the feed's (a different
 * leading word), not the feed name plus a suffix. The natural-declarations group draws from
 * these lenders.
 */
export const NATURAL_NAMES_V21: Record<string, string> = {
  ...NATURAL_NAMES,
  CBA: "Commonwealth Bank",
  NAB: "National Australia Bank",
  ANZ: "Australia and New Zealand Banking Group",
  SOCIETYONE: "Society One",
  PLENTI: "RateSetter",
  MONEY3: "Money 3",
  "ZIP PAY": "zipPay",
  AFTERPAY: "After Pay",
  PAYRIGHT: "Payright Pty Ltd",
  BUNDLL: "Bundll Pty Ltd",
  HASTEE: "Hastee Pay",
};
export const GENUINELY_DIFFERENT_V21: Record<string, readonly string[]> = {
  credit_card: ["CBA", "NAB", "ANZ"],
  personal_loan: ["SOCIETYONE", "PLENTI"],
  car_loan: ["MONEY3"],
  bnpl: ["ZIP PAY", "AFTERPAY"],
};

/** Set v2.1: ways a payroll system renames an employer, so drift pairs aren't a fixed few. */
export const PAYER_RENAMES_V21: readonly ((employer: string) => string)[] = [
  (e) => `${e.replace(/ PTY LTD$/, "")} P/L PAYROLL`,
  (e) => `PAYROLL ${e.split(" ").slice(0, 2).join(" ")}`,
  (e) => `${e.split(" ")[0] ?? e} WAGES`,
  (e) => `KEYPAY ${e.replace(/ PTY LTD$/, "")}`,
  (e) =>
    `${e
      .replace(/[AEIOU]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 18)
      .trim()} SAL`,
  (e) => `ADP ${e.split(" ")[0] ?? e} PAY`,
];

/** Set v2.1: second-bank everyday accounts, with their BSB and display name. */
export const SECOND_BANKS_V21: readonly { bsb: string; display: string }[] = [
  { bsb: "733000", display: "Everyday" },
  { bsb: "012003", display: "Access Advantage" },
  { bsb: "083004", display: "Classic Banking" },
  { bsb: "633000", display: "Smart Access" },
  { bsb: "484799", display: "Complete Freedom" },
];

/** Set v2.1: a dishonour fee varies by bank, in amount and narrative. */
export const DISHONOUR_FEES_V21: readonly { amount: number; description: string }[] = [
  { amount: 9, description: "DISHONOUR FEE" },
  { amount: 10, description: "DD RETURN FEE" },
  { amount: 12.5, description: "RETURNED PAYMENT FEE" },
  { amount: 15, description: "HONOUR FEE" },
  { amount: 20, description: "OUTWARD DISHONOUR FEE" },
];
