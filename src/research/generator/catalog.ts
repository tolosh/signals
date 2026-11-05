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
