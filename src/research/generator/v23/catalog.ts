// SIG-63 set v2.3: the descriptor library, from set v2.2's (SIG-60) with biller codes removed (they
// are drawn by one rule in generate.ts), v2.2's reserved lenders replaced by invented ones, and
// product words for the alias generator. Every entry serves every group: nothing here belongs to
// a labelled population. Lenders the detector hasn't seen sit in the same pools as the rest and
// are drawn by the same process; natural names are drawn from one alias generator for everyone.
// Banks and lenders are illustrative; BSBs and biller codes are synthetic.

/** A bank: its BSB, product names and fee schedule, and how it renders narratives. */
export type Bank = {
  key: string;
  bsb: string;
  everyday: string;
  savings: string;
  /** Monthly account-keeping fee, waived in a month whose credits reach `waive_at`. */
  monthly_fee: number;
  waive_at: number;
  monthly_fee_narrative: string;
  /** One schedule amount for an outward dishonour and for an overdrawn account (0: no fee). */
  event_fee: number;
  dishonour_narrative: string;
  overdrawn_narrative: string;
  return_narrative: string;
  /** How BPAY biller names are shown: the biller's short name or its legal name. */
  biller_style: "short" | "legal";
  /** Prefixes the bank puts on direct-debit and incoming-credit narratives. */
  dd_prefix: string;
  credit_prefix: string;
};
export const BANKS: readonly Bank[] = [
  {
    key: "b1",
    bsb: "062118",
    everyday: "Everyday Account",
    savings: "NetBank Saver",
    monthly_fee: 4,
    waive_at: 4000,
    monthly_fee_narrative: "ACCOUNT KEEPING FEE",
    event_fee: 0,
    dishonour_narrative: "",
    overdrawn_narrative: "",
    return_narrative: "DIRECT DEBIT RETURN",
    biller_style: "short",
    dd_prefix: "",
    credit_prefix: "",
  },
  {
    key: "b2",
    bsb: "033271",
    everyday: "Choice Account",
    savings: "eSaver",
    monthly_fee: 5,
    waive_at: 3000,
    monthly_fee_narrative: "MONTHLY ACCOUNT FEE",
    event_fee: 10,
    dishonour_narrative: "OUTWARD DISHONOUR FEE",
    overdrawn_narrative: "OVERDRAWN FEE",
    return_narrative: "DD RETURNED",
    biller_style: "legal",
    dd_prefix: "DD ",
    credit_prefix: "DEPOSIT ",
  },
  {
    key: "b3",
    bsb: "083394",
    everyday: "Classic Banking",
    savings: "iSaver",
    monthly_fee: 0,
    waive_at: 0,
    monthly_fee_narrative: "",
    event_fee: 9,
    dishonour_narrative: "DISHONOUR FEE",
    overdrawn_narrative: "OVERDRAWN BALANCE FEE",
    return_narrative: "RETURN DIRECT DEBIT",
    biller_style: "short",
    dd_prefix: "DIRECT DEBIT ",
    credit_prefix: "",
  },
  {
    key: "b4",
    bsb: "012620",
    everyday: "Access Advantage",
    savings: "Online Saver",
    monthly_fee: 6,
    waive_at: 1000,
    monthly_fee_narrative: "MONTHLY SERVICE FEE",
    event_fee: 15,
    dishonour_narrative: "DD RETURN FEE",
    overdrawn_narrative: "OVERDRAFT FEE",
    return_narrative: "DEBIT REVERSAL",
    biller_style: "legal",
    dd_prefix: "",
    credit_prefix: "DIRECT CREDIT ",
  },
  {
    key: "b5",
    bsb: "633108",
    everyday: "Everyday",
    savings: "Bonus Saver",
    monthly_fee: 0,
    waive_at: 0,
    monthly_fee_narrative: "",
    event_fee: 12.5,
    dishonour_narrative: "RETURNED PAYMENT FEE",
    overdrawn_narrative: "OVERDRAWN FEE",
    return_narrative: "DD DISHONOUR REVERSAL",
    biller_style: "short",
    dd_prefix: "DD ",
    credit_prefix: "",
  },
  {
    key: "b6",
    bsb: "484799",
    everyday: "Complete Freedom",
    savings: "Maxi Saver",
    monthly_fee: 5,
    waive_at: 2500,
    monthly_fee_narrative: "ACCOUNT KEEPING FEE",
    event_fee: 0,
    dishonour_narrative: "",
    overdrawn_narrative: "",
    return_narrative: "DIRECT DEBIT RETURN",
    biller_style: "legal",
    dd_prefix: "",
    credit_prefix: "",
  },
];

/** Employers: the full name, a short form and initials are what payroll descriptors use. */
export const EMPLOYERS_V23: readonly string[] = [
  "HARBOUR LOGISTICS PTY LTD",
  "ACME CONSULTING PTY LTD",
  "NORTHSIDE HEALTH SERVICES",
  "BLUEGUM CONSTRUCTIONS",
  "CITY OF RIVERTON",
  "ORBIT RETAIL GROUP",
  "SOUTHERN CROSS FREIGHT",
  "MERIDIAN ENGINEERING",
  "COASTAL AGED CARE",
  "PINNACLE SOFTWARE PTY LTD",
  "WATTLE GROVE SCHOOL",
  "EASTERN TRANSIT AUTHORITY",
  "GOLDLEAF HOSPITALITY",
  "IRONBARK MINING SERVICES",
  "KESTREL ELECTRICAL",
  "LAKESIDE MEDICAL GROUP",
  "MARLIN MARINE PTY LTD",
  "NORTHERN STAR FOODS",
  "OAKRIDGE PROPERTY GROUP",
  "PACIFIC DATA CENTRES",
  "QUARTZ ACCOUNTING",
  "REDGUM ARCHITECTS",
  "SILVERWATER WAREHOUSING",
  "TALLOWOOD PHARMACEUTICALS",
  "UNITY INSURANCE SERVICES",
  "VALLEY FRESH PRODUCE",
  "WESTGATE PLUMBING",
  "YARRA CIVIL WORKS",
  "ZENITH TELECOMMUNICATIONS",
  "BRIGHTSIDE CHILDCARE",
];
export const GIG_PAYERS_V23: readonly string[] = [
  "UBER AUSTRALIA PTY",
  "DOORDASH AUSTRALIA",
  "AIRTASKER",
  "MENULOG COURIER",
];
export const BENEFIT_PAYER = "SERVICES AUSTRALIA";

const words = (s: string) => s.replace(/ PTY LTD$| LTD$/, "").split(" ");
const short = (e: string) => words(e).slice(0, 2).join(" ");
const initials = (e: string) =>
  words(e)
    .map((w) => w[0] ?? "")
    .join("");
/**
 * How a payroll or a bank shows a payer: one generator for every applicant's pay. A payer-drift
 * applicant's pay is the same pay with a later rendering drawn from the same list.
 */
export const PAY_TEMPLATES: readonly ((payer: string) => string)[] = [
  (e) => `SALARY ${e}`,
  (e) => `${e} PAYROLL`,
  (e) => `PAY ${short(e)}`,
  (e) => `${short(e)} WAGES`,
  (e) => `${short(e)} SAL`,
  (e) => `PAYROLL ${short(e)}`,
  (e) => `${initials(e)} PAY`,
  (e) => e,
  (e) => `WAGES ${short(e)}`,
  (e) => `KEYPAY ${short(e)}`,
  (e) => `ADP ${short(e)} PAY`,
  (e) => `${short(e)} P/L PAY`,
];

/** People an applicant transfers money with, in either direction. */
export const PEOPLE: readonly string[] = [
  "J NGUYEN",
  "S PATEL",
  "M SMITH",
  "L CHEN",
  "A BROWN",
  "K WILLIAMS",
  "R SINGH",
  "T JONES",
  "D TRAN",
  "E WILSON",
];

/** A biller: its short and legal names. Its BPAY code is drawn in generate.ts (SIG-63). */
export type Payee = { short: string; legal: string };
export type BillKind = {
  kind: string;
  group: "committed" | "basic" | "discretionary";
  cadences: readonly ("weekly" | "fortnightly" | "monthly" | "quarterly" | "annual")[];
  /** Monthly-equivalent range in dollars; an occurrence's amount follows from its cadence. */
  monthly: [number, number];
  p: number;
  payees: readonly Payee[];
};
export const BILLS: readonly BillKind[] = [
  {
    kind: "utilities",
    group: "committed",
    cadences: ["quarterly", "monthly"],
    monthly: [90, 320],
    p: 0.85,
    payees: [
      { short: "AGL ENERGY", legal: "AGL SALES PTY LTD" },
      { short: "ORIGIN ENERGY", legal: "ORIGIN ENERGY RETAIL" },
      { short: "ENERGYAUSTRALIA", legal: "ENERGYAUSTRALIA PTY LTD" },
      { short: "RED ENERGY", legal: "RED ENERGY PTY LIMITED" },
    ],
  },
  {
    kind: "telco",
    group: "committed",
    cadences: ["monthly"],
    monthly: [35, 140],
    p: 0.9,
    payees: [
      { short: "TELSTRA", legal: "TELSTRA LIMITED" },
      { short: "OPTUS", legal: "SINGTEL OPTUS PTY" },
      { short: "VODAFONE", legal: "TPG TELECOM LTD" },
    ],
  },
  {
    kind: "internet",
    group: "committed",
    cadences: ["monthly"],
    monthly: [55, 115],
    p: 0.6,
    payees: [
      { short: "AUSSIE BROADBAND", legal: "AUSSIE BROADBAND LTD" },
      { short: "TPG INTERNET", legal: "TPG INTERNET PTY" },
      { short: "SUPERLOOP", legal: "SUPERLOOP LIMITED" },
    ],
  },
  {
    kind: "car_insurance",
    group: "committed",
    cadences: ["monthly", "annual"],
    monthly: [45, 190],
    p: 0.55,
    payees: [
      { short: "AAMI", legal: "AAI LIMITED" },
      { short: "BUDGET DIRECT", legal: "AUTO & GENERAL INSURANCE" },
      { short: "YOUI", legal: "YOUI PTY LTD" },
    ],
  },
  {
    kind: "health_insurance",
    group: "committed",
    cadences: ["monthly", "fortnightly"],
    monthly: [90, 460],
    p: 0.5,
    payees: [
      { short: "MEDIBANK", legal: "MEDIBANK PRIVATE LTD" },
      { short: "BUPA", legal: "BUPA HI PTY LTD" },
      { short: "HCF", legal: "HOSPITALS CONTRIBUTION FUND" },
    ],
  },
  {
    kind: "gym",
    group: "discretionary",
    cadences: ["fortnightly", "monthly"],
    monthly: [25, 95],
    p: 0.45,
    payees: [
      { short: "ANYTIME FITNESS", legal: "ANYTIME FITNESS AUSTRALIA" },
      { short: "JETTS FITNESS", legal: "JETTS AUSTRALIA PTY" },
      { short: "SNAP FITNESS", legal: "SNAP FITNESS AUST" },
    ],
  },
  {
    kind: "council_rates",
    group: "committed",
    cadences: ["quarterly"],
    monthly: [100, 260],
    p: 0.35,
    payees: [
      { short: "CITY COUNCIL RATES", legal: "CITY OF RIVERTON COUNCIL" },
      { short: "SHIRE RATES", legal: "LAKES SHIRE COUNCIL" },
    ],
  },
  {
    kind: "childcare",
    group: "committed",
    cadences: ["fortnightly"],
    monthly: [350, 1900],
    p: 0.15,
    payees: [
      { short: "GOODSTART", legal: "GOODSTART EARLY LEARNING" },
      { short: "LITTLE PEOPLE CC", legal: "LITTLE PEOPLE CHILDCARE" },
    ],
  },
  {
    kind: "strata",
    group: "committed",
    cadences: ["quarterly"],
    monthly: [180, 650],
    p: 0.15,
    payees: [
      { short: "STRATA LEVIES", legal: "BCS STRATA MANAGEMENT" },
      { short: "OWNERS CORP", legal: "OWNERS CORPORATION SP" },
    ],
  },
  {
    kind: "rent",
    group: "committed",
    cadences: ["monthly", "fortnightly"],
    monthly: [1400, 3300],
    p: 0,
    payees: [
      { short: "RAY WHITE RENT", legal: "RAY WHITE REAL ESTATE" },
      { short: "LJ HOOKER RENT", legal: "LJ HOOKER PTY LTD" },
      { short: "BELLE PROPERTY", legal: "BELLE PROPERTY RENTALS" },
    ],
  },
];

export type LiabilityTypeV23 =
  "credit_card" | "personal_loan" | "car_loan" | "mortgage" | "bnpl" | "sacc" | "wage_advance";

/**
 * A lender: how the feed names it (narrative forms, one drawn per liability), other ways of
 * writing it, and its legal name (its BPAY code is drawn in generate.ts). A declared name is drawn
 * from all of these by one alias generator (generate.ts): each is "same" or "different" against
 * the feed form the liability actually shows, by the validity check's rule, so every lender has
 * names of both kinds and of overlapping lengths.
 */
export type Lender = {
  feed: readonly string[];
  same: readonly string[];
  different: readonly string[];
  legal: string;
};
const L = (feed: string[], same: string[], different: string[], legal: string): Lender => ({
  feed,
  same,
  different,
  legal,
});

export const LENDERS: Record<LiabilityTypeV23, Record<string, Lender>> = {
  credit_card: {
    CBA: L(
      ["CBA", "COMMBANK"],
      ["Comm Bank"],
      ["Commonwealth Bank", "CommBank Mastercard"],
      "COMMONWEALTH BANK",
    ),
    WESTPAC: L(["WESTPAC"], ["West Pac"], ["WBC", "St George"], "WESTPAC BANKING CORP"),
    NAB: L(
      ["NAB"],
      ["N A B"],
      ["National Australia Bank", "Nat Aust Bank"],
      "NATIONAL AUSTRALIA BANK",
    ),
    ANZ: L(
      ["ANZ"],
      ["A N Z"],
      ["Aust & NZ Bank", "Australia & NZ Banking"],
      "AUST AND NZ BANKING GROUP",
    ),
    AMEX: L(
      ["AMEX", "AMERICAN EXPRESS"],
      ["Am Ex"],
      ["AE Card", "Centurion"],
      "AMERICAN EXPRESS AUST",
    ),
    CITI: L(["CITI", "CITIBANK"], ["Citi Bank"], ["CG Card", "Diners Club"], "CITIGROUP PTY LTD"),
    "BRIGALOW BANK": L(
      ["BRIGALOW BANK", "BRIGALOW"],
      ["Brigalow"],
      ["BGB Card", "Brigalow Building Society"],
      "BRIGALOW BANK LIMITED",
    ),
    "TASMAN REACH BANK": L(
      ["TASMAN REACH BANK", "TASMAN REACH"],
      ["Tasman Reach"],
      ["TRB", "Reach Bank"],
      "TASMAN REACH BANK LTD",
    ),
    "GANNET MUTUAL": L(
      ["GANNET MUTUAL", "GANNET"],
      ["Gannet"],
      ["GM Card", "Gannet Mutual Bank"],
      "GANNET MUTUAL LTD",
    ),
  },
  personal_loan: {
    SOCIETYONE: L(["SOCIETYONE"], ["Society One"], ["S1 Personal Loans"], "SOCIETYONE AUSTRALIA"),
    PLENTI: L(["PLENTI"], ["Plenti Finance"], ["RateSetter"], "PLENTI RE LIMITED"),
    HARMONEY: L(["HARMONEY"], ["Har Money"], ["Harmony Lending"], "HARMONEY AUSTRALIA"),
    "CBA PERSONAL": L(
      ["CBA PERSONAL LOAN", "COMMBANK PL"],
      ["CBA"],
      ["Commonwealth Bank"],
      "COMMONWEALTH BANK PERSONAL LENDING",
    ),
    "QUANDONG FINANCE": L(
      ["QUANDONG FINANCE", "QUANDONG"],
      ["Quandong"],
      ["QF Loans", "Quandong Fin"],
      "QUANDONG FINANCE PTY LTD",
    ),
    "WOLLEMI LENDING": L(
      ["WOLLEMI LENDING", "WOLLEMI"],
      ["Wollemi"],
      ["WL Personal", "Wollemi Pine Lending"],
      "WOLLEMI LENDING PTY LTD",
    ),
  },
  car_loan: {
    MONEY3: L(["MONEY3"], ["Money 3"], ["M3 Auto"], "MONEY3 CORPORATION"),
    "MACQUARIE LEASING": L(
      ["MACQUARIE LEASING", "MACQ LEASING"],
      ["Macquarie Leasing"],
      ["Macquarie Bank", "MBL Auto"],
      "MACQUARIE LEASING PTY",
    ),
    FIRSTMAC: L(["FIRSTMAC"], ["First Mac"], ["FMac Car Loans"], "FIRSTMAC LIMITED"),
    "PEPPER MONEY": L(
      ["PEPPER MONEY", "PEPPER"],
      ["Peppermoney"],
      ["PM Finance"],
      "PEPPER FINANCE CORP",
    ),
    "GIBBER AUTO LOANS": L(
      ["GIBBER AUTO LOANS", "GIBBER AUTO"],
      ["Gibber"],
      ["GAL Finance", "Gibber Motors"],
      "GIBBER AUTO LOANS PTY LTD",
    ),
    "BETTONG MOTOR FINANCE": L(
      ["BETTONG MOTOR FINANCE", "BETTONG MOTOR"],
      ["Bettong"],
      ["BMF", "Bettong Car Finance"],
      "BETTONG MOTOR FINANCE PTY",
    ),
  },
  mortgage: {
    "CBA HOME LOAN": L(
      ["CBA HOME LOAN", "COMMBANK HL"],
      ["CBA"],
      ["Commonwealth Bank"],
      "COMMONWEALTH BANK HOME LENDING",
    ),
    "WESTPAC HOME LOAN": L(
      ["WESTPAC HOME LOAN", "WBC HOME LOAN"],
      ["Westpac"],
      ["St George Bank"],
      "WESTPAC HOME LENDING",
    ),
    "NAB HOME LOAN": L(["NAB HOME LOAN"], ["NAB"], ["National Australia Bank"], "NAB HOME LENDING"),
    "BOOBOOK HOME LOANS": L(
      ["BOOBOOK HOME LOANS", "BOOBOOK HL"],
      ["Boobook"],
      ["BHL Mortgages", "Boobook Lending"],
      "BOOBOOK HOME LOANS PTY LTD",
    ),
    "CURRAWONG MUTUAL": L(
      ["CURRAWONG MUTUAL", "CURRAWONG"],
      ["Currawong"],
      ["CMB Home Loans", "Currawong Bank"],
      "CURRAWONG MUTUAL LTD",
    ),
    "POTOROO HOME LENDING": L(
      ["POTOROO HOME LENDING", "POTOROO HL"],
      ["Potoroo"],
      ["PHL Mortgage", "Potoroo Lending"],
      "POTOROO HOME LENDING PTY",
    ),
  },
  bnpl: {
    AFTERPAY: L(["AFTERPAY"], ["After Pay"], ["Block Inc", "Clearpay"], "AFTERPAY PTY LTD"),
    "ZIP PAY": L(["ZIP PAY", "ZIPPAY"], ["Zippay"], ["zipMoney", "Zip Money"], "ZIPMONEY PAYMENTS"),
    HUMM: L(["HUMM", "HUMMGROUP"], ["Humm Group"], ["Flexigroup", "Oxipay"], "HUMM GROUP LTD"),
    KLARNA: L(["KLARNA"], ["Klar Na"], ["Sofort"], "KLARNA AUSTRALIA"),
    QUOLLPAY: L(
      ["QUOLLPAY", "QUOLL PAY"],
      ["Quoll Pay"],
      ["QP Instalments", "Quoll"],
      "QUOLLPAY PTY LTD",
    ),
    PAYWATTLE: L(
      ["PAYWATTLE", "PAY WATTLE"],
      ["Pay Wattle"],
      ["PW Pay", "Wattle Pay Later"],
      "PAYWATTLE PTY LTD",
    ),
    "DUNNART PAY": L(
      ["DUNNART PAY", "DUNNARTPAY"],
      ["Dunnartpay"],
      ["DP Instalments", "Dunnart"],
      "DUNNART PAY PTY LTD",
    ),
  },
  sacc: {
    "CASH CONVERTERS": L(
      ["CASH CONVERTERS", "CASHCONV"],
      ["Cashconverters"],
      ["Cash Stop Finance"],
      "CASH CONVERTERS PERSONAL",
    ),
    NIMBLE: L(["NIMBLE"], ["Nim Ble"], ["NML Loans"], "NIMBLE AUSTRALIA PTY"),
    "SUNSHINE LOANS": L(
      ["SUNSHINE LOANS", "SUNSHINE"],
      ["Sunshine Loans"],
      ["SSL Finance"],
      "SUNSHINE LOANS PTY",
    ),
    "SALTBUSH CASH": L(
      ["SALTBUSH CASH", "SALTBUSH"],
      ["Saltbush"],
      ["SBC Loans", "Saltbush Cash Loans"],
      "SALTBUSH CASH PTY LTD",
    ),
    "PADEMELON LOANS": L(
      ["PADEMELON LOANS", "PADEMELON"],
      ["Pademelon"],
      ["PML Cash", "Pademelon Lending"],
      "PADEMELON LOANS PTY LTD",
    ),
  },
  wage_advance: {
    BEFOREPAY: L(["BEFOREPAY"], ["Before Pay"], ["BFP Advance"], "BEFOREPAY GROUP LTD"),
    MYPAYNOW: L(["MYPAYNOW", "MY PAY NOW"], ["Mypaynow"], ["MPN Advance"], "MYPAYNOW PTY LTD"),
    CASHD: L(["CASHD"], ["Cash D"], ["Earned Wage CD"], "CASHD PTY LTD"),
    WAGEFERN: L(
      ["WAGEFERN", "WAGE FERN"],
      ["Wage Fern"],
      ["WF Advance", "Fern Pay"],
      "WAGEFERN PTY LTD",
    ),
    LYREPAY: L(
      ["LYREPAY", "LYRE PAY"],
      ["Lyre Pay"],
      ["LP Advance", "Lyrebird Pay"],
      "LYREPAY PTY LTD",
    ),
  },
};

/**
 * Lenders absent from SIG-18's runs and from SIG-57's alias table. Invented for set v2.3 (ruling of
 * 10 November 2026, SIG-60 comment 40216) and checked against the ASIC credit registers
 * (research/datasets/synthetic-v2.3.reserved-names-asic.json, T9). None appears in src/ or in a
 * test outside the research code (V6). They are in LENDERS like any other lender and are drawn by
 * the same process; v2.2's reserved lenders (12 of 17 real) are not in set v2.3.
 */
export const UNSEEN_PROVIDERS_V23: Record<LiabilityTypeV23, readonly string[]> = {
  credit_card: ["BRIGALOW BANK", "TASMAN REACH BANK", "GANNET MUTUAL"],
  personal_loan: ["QUANDONG FINANCE", "WOLLEMI LENDING"],
  car_loan: ["GIBBER AUTO LOANS", "BETTONG MOTOR FINANCE"],
  mortgage: ["BOOBOOK HOME LOANS", "CURRAWONG MUTUAL", "POTOROO HOME LENDING"],
  bnpl: ["QUOLLPAY", "PAYWATTLE", "DUNNART PAY"],
  sacc: ["SALTBUSH CASH", "PADEMELON LOANS"],
  wage_advance: ["WAGEFERN", "LYREPAY"],
};

/**
 * Product words an applicant may add to a declared name, of either class (V10: drawn independently
 * of whether the name genuinely differs). The validity rule ignores the type words among them.
 */
export const PRODUCT_WORDS: Record<LiabilityTypeV23, readonly string[]> = {
  credit_card: ["Visa", "Mastercard", "Platinum", "Low Rate", "Rewards", "Gold", "Low Fee"],
  personal_loan: ["Fixed", "Variable", "Debt Consolidation", "Unsecured", "Secured"],
  car_loan: ["Auto", "Vehicle", "Motor", "Novated", "Secured"],
  mortgage: ["Variable", "Fixed", "Offset", "Investment", "Basic", "Package"],
  bnpl: ["App", "Account", "Plus", "Shopping", "Later"],
  sacc: ["Cash", "Small", "Fast", "Payday", "Online"],
  wage_advance: ["App", "Advance", "Early Pay", "Wages", "Instant"],
};

/** Words a lender's narrative may add, by type. Cards' cue words are the "card" ones. */
export const LOAN_WORDS: Record<LiabilityTypeV23, readonly string[]> = {
  credit_card: ["CREDIT CARD", "CARD PAYMENT", "CREDITCARD"],
  personal_loan: ["LOAN REPAYMENT", "REPAYMENT", "PERSONAL LOAN", "LOAN"],
  car_loan: ["CAR LOAN", "LOAN REPAYMENT", "REPAYMENT", "AUTO LOAN"],
  mortgage: ["HOME LOAN", "MORTGAGE", "LOAN REPAYMENT"],
  bnpl: ["INSTALMENT", "PAYMENT", "REPAYMENT"],
  sacc: ["LOAN REPAYMENT", "REPAYMENT", "LOAN"],
  wage_advance: ["REPAYMENT", "ADVANCE REPAY", "COLLECTION"],
};

export const GROCERY_V23 = [
  { name: "Woolworths", descriptor: "WOOLWORTHS", mcc: "5411" },
  { name: "Coles", descriptor: "COLES", mcc: "5411" },
  { name: "Aldi", descriptor: "ALDI STORES", mcc: "5411" },
  { name: "IGA", descriptor: "IGA", mcc: "5411" },
];
export const FUEL_V23 = [
  { name: "Ampol", descriptor: "AMPOL", mcc: "5541" },
  { name: "BP", descriptor: "BP", mcc: "5541" },
  { name: "7-Eleven", descriptor: "7-ELEVEN", mcc: "5541" },
  { name: "Shell", descriptor: "SHELL COLES EXPRESS", mcc: "5541" },
];
export const DINING_V23 = [
  { name: "McDonald's", descriptor: "MCDONALDS", mcc: "5814" },
  { name: "Guzman y Gomez", descriptor: "GUZMAN Y GOMEZ", mcc: "5814" },
  { name: "Grill'd", descriptor: "GRILLD", mcc: "5812" },
  { name: "Menulog", descriptor: "MENULOG", mcc: "5812" },
];
export const SUBSCRIPTIONS_V23 = [
  { name: "Netflix", descriptor: "NETFLIX.COM", mcc: "4899", price: 18.99 },
  { name: "Spotify", descriptor: "SPOTIFY", mcc: "5815", price: 13.99 },
  { name: "Stan", descriptor: "STAN.COM.AU", mcc: "4899", price: 12 },
];
export const GAMBLING_V23 = [
  { name: "Sportsbet", descriptor: "SPORTSBET", mcc: "7995" },
  { name: "TAB", descriptor: "TAB TOUCH", mcc: "7995" },
];
export const SUBURBS_V23 = [
  ["SYDNEY", "NS"],
  ["PARRAMATTA", "NS"],
  ["MELBOURNE", "VI"],
  ["RICHMOND", "VI"],
  ["BRISBANE", "QL"],
  ["ADELAIDE", "SA"],
  ["PERTH", "WA"],
  ["HOBART", "TA"],
] as const;
