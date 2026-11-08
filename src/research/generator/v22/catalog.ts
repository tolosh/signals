// SIG-60 set v2.2: the descriptor library. Every entry serves every group: nothing here belongs to
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
export const EMPLOYERS_V22: readonly string[] = [
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
export const GIG_PAYERS_V22: readonly string[] = [
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

/** A biller: its short and legal names, and its synthetic BPAY code. */
export type Payee = { short: string; legal: string; code: string };
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
      { short: "AGL ENERGY", legal: "AGL SALES PTY LTD", code: "803072" },
      { short: "ORIGIN ENERGY", legal: "ORIGIN ENERGY RETAIL", code: "155002" },
      { short: "ENERGYAUSTRALIA", legal: "ENERGYAUSTRALIA PTY LTD", code: "250720" },
      { short: "RED ENERGY", legal: "RED ENERGY PTY LIMITED", code: "317495" },
    ],
  },
  {
    kind: "telco",
    group: "committed",
    cadences: ["monthly"],
    monthly: [35, 140],
    p: 0.9,
    payees: [
      { short: "TELSTRA", legal: "TELSTRA LIMITED", code: "23796" },
      { short: "OPTUS", legal: "SINGTEL OPTUS PTY", code: "37218" },
      { short: "VODAFONE", legal: "TPG TELECOM LTD", code: "498014" },
    ],
  },
  {
    kind: "internet",
    group: "committed",
    cadences: ["monthly"],
    monthly: [55, 115],
    p: 0.6,
    payees: [
      { short: "AUSSIE BROADBAND", legal: "AUSSIE BROADBAND LTD", code: "601930" },
      { short: "TPG INTERNET", legal: "TPG INTERNET PTY", code: "712205" },
      { short: "SUPERLOOP", legal: "SUPERLOOP LIMITED", code: "640311" },
    ],
  },
  {
    kind: "car_insurance",
    group: "committed",
    cadences: ["monthly", "annual"],
    monthly: [45, 190],
    p: 0.55,
    payees: [
      { short: "AAMI", legal: "AAI LIMITED", code: "411868" },
      { short: "BUDGET DIRECT", legal: "AUTO & GENERAL INSURANCE", code: "520114" },
      { short: "YOUI", legal: "YOUI PTY LTD", code: "387752" },
    ],
  },
  {
    kind: "health_insurance",
    group: "committed",
    cadences: ["monthly", "fortnightly"],
    monthly: [90, 460],
    p: 0.5,
    payees: [
      { short: "MEDIBANK", legal: "MEDIBANK PRIVATE LTD", code: "293225" },
      { short: "BUPA", legal: "BUPA HI PTY LTD", code: "440106" },
      { short: "HCF", legal: "HOSPITALS CONTRIBUTION FUND", code: "300947" },
    ],
  },
  {
    kind: "gym",
    group: "discretionary",
    cadences: ["fortnightly", "monthly"],
    monthly: [25, 95],
    p: 0.45,
    payees: [
      { short: "ANYTIME FITNESS", legal: "ANYTIME FITNESS AUSTRALIA", code: "667301" },
      { short: "JETTS FITNESS", legal: "JETTS AUSTRALIA PTY", code: "677512" },
      { short: "SNAP FITNESS", legal: "SNAP FITNESS AUST", code: "690028" },
    ],
  },
  {
    kind: "council_rates",
    group: "committed",
    cadences: ["quarterly"],
    monthly: [100, 260],
    p: 0.35,
    payees: [
      { short: "CITY COUNCIL RATES", legal: "CITY OF RIVERTON COUNCIL", code: "325480" },
      { short: "SHIRE RATES", legal: "LAKES SHIRE COUNCIL", code: "325911" },
    ],
  },
  {
    kind: "childcare",
    group: "committed",
    cadences: ["fortnightly"],
    monthly: [350, 1900],
    p: 0.15,
    payees: [
      { short: "GOODSTART", legal: "GOODSTART EARLY LEARNING", code: "818122" },
      { short: "LITTLE PEOPLE CC", legal: "LITTLE PEOPLE CHILDCARE", code: "818340" },
    ],
  },
  {
    kind: "strata",
    group: "committed",
    cadences: ["quarterly"],
    monthly: [180, 650],
    p: 0.15,
    payees: [
      { short: "STRATA LEVIES", legal: "BCS STRATA MANAGEMENT", code: "907114" },
      { short: "OWNERS CORP", legal: "OWNERS CORPORATION SP", code: "907562" },
    ],
  },
  {
    kind: "rent",
    group: "committed",
    cadences: ["monthly", "fortnightly"],
    monthly: [1400, 3300],
    p: 0,
    payees: [
      { short: "RAY WHITE RENT", legal: "RAY WHITE REAL ESTATE", code: "218803" },
      { short: "LJ HOOKER RENT", legal: "LJ HOOKER PTY LTD", code: "218877" },
      { short: "BELLE PROPERTY", legal: "BELLE PROPERTY RENTALS", code: "219006" },
    ],
  },
];

export type LiabilityTypeV22 =
  "credit_card" | "personal_loan" | "car_loan" | "mortgage" | "bnpl" | "sacc" | "wage_advance";

/**
 * A lender: how the feed names it (narrative forms, one drawn per liability), other ways of
 * writing it, its legal name and its synthetic biller code. An applicant's declared name is drawn
 * from all of these by one alias generator (generate.ts): each is "same" or "different" against
 * the feed form the liability actually shows, by the validity check's rule, so every lender has
 * names of both kinds and of overlapping lengths.
 */
export type Lender = {
  feed: readonly string[];
  same: readonly string[];
  different: readonly string[];
  legal: string;
  code: string;
};
const L = (
  feed: string[],
  same: string[],
  different: string[],
  legal: string,
  code: string,
): Lender => ({ feed, same, different, legal, code });

export const LENDERS: Record<LiabilityTypeV22, Record<string, Lender>> = {
  credit_card: {
    CBA: L(
      ["CBA", "COMMBANK"],
      ["Comm Bank"],
      ["Commonwealth Bank", "CommBank Mastercard"],
      "COMMONWEALTH BANK",
      "1081",
    ),
    WESTPAC: L(["WESTPAC"], ["West Pac"], ["WBC", "St George"], "WESTPAC BANKING CORP", "1172"),
    NAB: L(
      ["NAB"],
      ["N A B"],
      ["National Australia Bank", "Nat Aust Bank"],
      "NATIONAL AUSTRALIA BANK",
      "1263",
    ),
    ANZ: L(
      ["ANZ"],
      ["A N Z"],
      ["Aust & NZ Bank", "Australia & NZ Banking"],
      "AUST AND NZ BANKING GROUP",
      "1354",
    ),
    AMEX: L(
      ["AMEX", "AMERICAN EXPRESS"],
      ["Am Ex"],
      ["AE Card", "Centurion"],
      "AMERICAN EXPRESS AUST",
      "1445",
    ),
    CITI: L(
      ["CITI", "CITIBANK"],
      ["Citi Bank"],
      ["CG Card", "Diners Club"],
      "CITIGROUP PTY LTD",
      "1536",
    ),
    "GATEWAY BANK": L(["GATEWAY BANK"], ["Gateway"], ["GW Bank"], "GATEWAY BANK LTD", "1627"),
    "BANK FIRST": L(
      ["BANK FIRST", "BANKFIRST"],
      ["Bankfirst"],
      ["Victoria Teachers"],
      "BANK FIRST LIMITED",
      "1718",
    ),
    "MOVE BANK": L(["MOVE BANK"], ["Movebank"], ["Railways CU"], "MOVE BANK LTD", "1809"),
  },
  personal_loan: {
    SOCIETYONE: L(
      ["SOCIETYONE"],
      ["Society One"],
      ["S1 Personal Loans"],
      "SOCIETYONE AUSTRALIA",
      "2091",
    ),
    PLENTI: L(["PLENTI"], ["Plenti Finance"], ["RateSetter"], "PLENTI RE LIMITED", "2182"),
    HARMONEY: L(["HARMONEY"], ["Har Money"], ["Harmony Lending"], "HARMONEY AUSTRALIA", "2273"),
    "CBA PERSONAL": L(
      ["CBA PERSONAL LOAN", "COMMBANK PL"],
      ["CBA"],
      ["Commonwealth Bank"],
      "COMMONWEALTH BANK PERSONAL LENDING",
      "2364",
    ),
    FIRSTFIN: L(["FIRSTFIN"], ["First Fin"], ["FF Lending"], "FIRSTFIN PTY LTD", "2455"),
    "SECURE FUNDING": L(
      ["SECURE FUNDING", "SECUREFUNDING"],
      ["Securefunding"],
      ["SF Finance"],
      "SECURE FUNDING PTY",
      "2546",
    ),
  },
  car_loan: {
    MONEY3: L(["MONEY3"], ["Money 3"], ["M3 Auto"], "MONEY3 CORPORATION", "3093"),
    "MACQUARIE LEASING": L(
      ["MACQUARIE LEASING", "MACQ LEASING"],
      ["Macquarie Leasing"],
      ["Macquarie Bank", "MBL Auto"],
      "MACQUARIE LEASING PTY",
      "3184",
    ),
    FIRSTMAC: L(["FIRSTMAC"], ["First Mac"], ["FMac Car Loans"], "FIRSTMAC LIMITED", "3275"),
    "PEPPER MONEY": L(
      ["PEPPER MONEY", "PEPPER"],
      ["Peppermoney"],
      ["PM Finance"],
      "PEPPER FINANCE CORP",
      "3366",
    ),
    STRATTON: L(
      ["STRATTON", "STRATTON FINANCE"],
      ["Stratton"],
      ["SF Car Finance"],
      "STRATTON FINANCE PTY",
      "3457",
    ),
    "CARLOANS DIRECT": L(
      ["CARLOANS DIRECT", "CARLOANSDIRECT"],
      ["Car Loans Direct"],
      ["CLD Finance"],
      "CARLOANS DIRECT PTY",
      "3548",
    ),
  },
  mortgage: {
    "CBA HOME LOAN": L(
      ["CBA HOME LOAN", "COMMBANK HL"],
      ["CBA"],
      ["Commonwealth Bank"],
      "COMMONWEALTH BANK HOME LENDING",
      "4095",
    ),
    "WESTPAC HOME LOAN": L(
      ["WESTPAC HOME LOAN", "WBC HOME LOAN"],
      ["Westpac"],
      ["St George Bank"],
      "WESTPAC HOME LENDING",
      "4186",
    ),
    "NAB HOME LOAN": L(
      ["NAB HOME LOAN"],
      ["NAB"],
      ["National Australia Bank"],
      "NAB HOME LENDING",
      "4277",
    ),
    QUDOS: L(
      ["QUDOS BANK", "QUDOS"],
      ["Qudos"],
      ["Qantas Credit Union"],
      "QUDOS MUTUAL LTD",
      "4368",
    ),
    ATHENA: L(
      ["ATHENA HOME LOANS", "ATHENA"],
      ["Athena"],
      ["AHL Mortgages"],
      "ATHENA FINANCIAL PTY",
      "4459",
    ),
    UNLOAN: L(
      ["UNLOAN", "UNLOAN HOME"],
      ["Un Loan"],
      ["CommBank Digital"],
      "UNLOAN PTY LTD",
      "4540",
    ),
  },
  bnpl: {
    AFTERPAY: L(["AFTERPAY"], ["After Pay"], ["Block Inc", "Clearpay"], "AFTERPAY PTY LTD", "5091"),
    "ZIP PAY": L(
      ["ZIP PAY", "ZIPPAY"],
      ["Zippay"],
      ["zipMoney", "Zip Money"],
      "ZIPMONEY PAYMENTS",
      "5182",
    ),
    HUMM: L(
      ["HUMM", "HUMMGROUP"],
      ["Humm Group"],
      ["Flexigroup", "Oxipay"],
      "HUMM GROUP LTD",
      "5273",
    ),
    KLARNA: L(["KLARNA"], ["Klar Na"], ["Sofort"], "KLARNA AUSTRALIA", "5364"),
    OPENPAY: L(["OPENPAY", "OPEN PAY"], ["Open Pay"], ["OPY Payments"], "OPENPAY PTY LTD", "5455"),
    LIMEPAY: L(["LIMEPAY", "LIME PAY"], ["Lime Pay"], ["LPay"], "LIMEPAY PTY LTD", "5546"),
    SPLITIT: L(["SPLITIT", "SPLIT IT"], ["Split It"], ["SI Payments"], "SPLITIT AUSTRALIA", "5637"),
  },
  sacc: {
    "CASH CONVERTERS": L(
      ["CASH CONVERTERS", "CASHCONV"],
      ["Cashconverters"],
      ["Cash Stop Finance"],
      "CASH CONVERTERS PERSONAL",
      "6093",
    ),
    NIMBLE: L(["NIMBLE"], ["Nim Ble"], ["NML Loans"], "NIMBLE AUSTRALIA PTY", "6184"),
    "SUNSHINE LOANS": L(
      ["SUNSHINE LOANS", "SUNSHINE"],
      ["Sunshine Loans"],
      ["SSL Finance"],
      "SUNSHINE LOANS PTY",
      "6275",
    ),
    CASHTRAIN: L(
      ["CASHTRAIN", "CASH TRAIN"],
      ["Cash Train"],
      ["CT Loans"],
      "CASHTRAIN PTY LTD",
      "6366",
    ),
    SPOTCASH: L(
      ["SPOTCASH", "SPOT CASH"],
      ["Spot Cash"],
      ["SC Lending"],
      "SPOTCASH LOANS PTY",
      "6457",
    ),
  },
  wage_advance: {
    BEFOREPAY: L(["BEFOREPAY"], ["Before Pay"], ["BFP Advance"], "BEFOREPAY GROUP LTD", "7091"),
    MYPAYNOW: L(
      ["MYPAYNOW", "MY PAY NOW"],
      ["Mypaynow"],
      ["MPN Advance"],
      "MYPAYNOW PTY LTD",
      "7182",
    ),
    CASHD: L(["CASHD"], ["Cash D"], ["Earned Wage CD"], "CASHD PTY LTD", "7273"),
    WAGEWISE: L(
      ["WAGEWISE", "WAGE WISE"],
      ["Wage Wise"],
      ["WW Advance"],
      "WAGEWISE PTY LTD",
      "7364",
    ),
    PAYCHEK: L(["PAYCHEK", "PAY CHEK"], ["Pay Chek"], ["PCK Advance"], "PAYCHEK AUSTRALIA", "7455"),
  },
};

/**
 * Lenders absent from SIG-18's runs and from any alias table SIG-57 pre-registers. None appears in
 * src/ or in a test outside the research code (validity check V6). They are in LENDERS like any
 * other lender and are drawn by the same process.
 */
export const UNSEEN_PROVIDERS_V22: Record<LiabilityTypeV22, readonly string[]> = {
  credit_card: ["GATEWAY BANK", "BANK FIRST", "MOVE BANK"],
  personal_loan: ["FIRSTFIN", "SECURE FUNDING"],
  car_loan: ["STRATTON", "CARLOANS DIRECT"],
  mortgage: ["QUDOS", "ATHENA", "UNLOAN"],
  bnpl: ["OPENPAY", "LIMEPAY", "SPLITIT"],
  sacc: ["CASHTRAIN", "SPOTCASH"],
  wage_advance: ["WAGEWISE", "PAYCHEK"],
};

/** Words a lender's narrative may add, by type. Cards' cue words are the "card" ones. */
export const LOAN_WORDS: Record<LiabilityTypeV22, readonly string[]> = {
  credit_card: ["CREDIT CARD", "CARD PAYMENT", "CREDITCARD"],
  personal_loan: ["LOAN REPAYMENT", "REPAYMENT", "PERSONAL LOAN", "LOAN"],
  car_loan: ["CAR LOAN", "LOAN REPAYMENT", "REPAYMENT", "AUTO LOAN"],
  mortgage: ["HOME LOAN", "MORTGAGE", "LOAN REPAYMENT"],
  bnpl: ["INSTALMENT", "PAYMENT", "REPAYMENT"],
  sacc: ["LOAN REPAYMENT", "REPAYMENT", "LOAN"],
  wage_advance: ["REPAYMENT", "ADVANCE REPAY", "COLLECTION"],
};

export const GROCERY_V22 = [
  { name: "Woolworths", descriptor: "WOOLWORTHS", mcc: "5411" },
  { name: "Coles", descriptor: "COLES", mcc: "5411" },
  { name: "Aldi", descriptor: "ALDI STORES", mcc: "5411" },
  { name: "IGA", descriptor: "IGA", mcc: "5411" },
];
export const FUEL_V22 = [
  { name: "Ampol", descriptor: "AMPOL", mcc: "5541" },
  { name: "BP", descriptor: "BP", mcc: "5541" },
  { name: "7-Eleven", descriptor: "7-ELEVEN", mcc: "5541" },
  { name: "Shell", descriptor: "SHELL COLES EXPRESS", mcc: "5541" },
];
export const DINING_V22 = [
  { name: "McDonald's", descriptor: "MCDONALDS", mcc: "5814" },
  { name: "Guzman y Gomez", descriptor: "GUZMAN Y GOMEZ", mcc: "5814" },
  { name: "Grill'd", descriptor: "GRILLD", mcc: "5812" },
  { name: "Menulog", descriptor: "MENULOG", mcc: "5812" },
];
export const SUBSCRIPTIONS_V22 = [
  { name: "Netflix", descriptor: "NETFLIX.COM", mcc: "4899", price: 18.99 },
  { name: "Spotify", descriptor: "SPOTIFY", mcc: "5815", price: 13.99 },
  { name: "Stan", descriptor: "STAN.COM.AU", mcc: "4899", price: 12 },
];
export const GAMBLING_V22 = [
  { name: "Sportsbet", descriptor: "SPORTSBET", mcc: "7995" },
  { name: "TAB", descriptor: "TAB TOUCH", mcc: "7995" },
];
export const SUBURBS_V22 = [
  ["SYDNEY", "NS"],
  ["PARRAMATTA", "NS"],
  ["MELBOURNE", "VI"],
  ["RICHMOND", "VI"],
  ["BRISBANE", "QL"],
  ["ADELAIDE", "SA"],
  ["PERTH", "WA"],
  ["HOBART", "TA"],
] as const;
