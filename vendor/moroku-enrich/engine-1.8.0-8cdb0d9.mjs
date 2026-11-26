// Moroku Enrich engine 1.8.0 (taxonomy 1.4), moroku-enrich 8cdb0d926f7a9473051655fdeed5d69c1ceffaeb.
// Packaged by scripts/enrich-package.ts (SIG-70); do not edit. See pin.json.
// packages/taxonomy/dist/index.js
var TAXONOMY_VERSION = "1.4";
var CLASSIFICATIONS = ["essential", "discretionary", "financial_commitment"];
var EXPENSE_CATEGORIES = [
  cat("mortgage", "Mortgage", "financial_commitment"),
  cat("rent", "Rent", "financial_commitment"),
  cat("loan_repayment", "Loan Repayment", "financial_commitment"),
  cat("groceries", "Groceries", "essential"),
  cat("utilities", "Utilities", "essential"),
  cat("vehicle_running", "Vehicle Running", "essential"),
  cat("transport", "Transport", "essential"),
  cat("insurance", "Insurance", "essential"),
  cat("strata", "Strata", "essential"),
  cat("education", "Education", "essential"),
  cat("subscriptions", "Subscriptions", "discretionary"),
  cat("dining_entertainment", "Dining & Entertainment", "discretionary"),
  cat("clothing", "Clothing", "discretionary"),
  cat("healthcare", "Healthcare", "essential"),
  cat("other_expenses", "Other Expenses", "discretionary"),
  // --- ext-006 (additive) ---
  cat("bnpl", "Buy Now Pay Later", "financial_commitment"),
  cat("general_retail", "General Retail", "discretionary"),
  // --- ext-007 (additive): high-risk lending signals (ENR-24) ---
  // The merchants a responsible-lending / RG 209 assessment weights most. Each
  // needs its own id so the signal survives — folding a payday loan into
  // `loan_repayment` or a collector into `other_expenses` loses exactly the
  // flag a reviewer wants. BNPL already has `bnpl` (ext-006).
  cat("sacc_loan", "Small Amount Credit (SACC)", "financial_commitment"),
  cat("wage_advance", "Wage Advance", "financial_commitment"),
  cat("debt_collection", "Debt Collection", "financial_commitment"),
  // `fines_penalties`: `financial_commitment` (ENR-26, confirmed by Colin). The
  // lending-signals affordability engine builds living expenses (GLE) from
  // essential/basic spend and counts commitments separately, so this keeps fines
  // OUT of living expenses — a one-off fine must not inflate monthly GLE across
  // the lookback, and a fine paid in instalments is picked up as a repayment.
  // (`essential` would distort DSR/NDI; `discretionary` would imply it's cuttable.)
  cat("fines_penalties", "Fines & Penalties", "financial_commitment"),
  // --- ext-008 (additive): gambling & quasi-cash (ENR-25) ---
  // Gambling is the strongest behavioural red flag in an RG 209 assessment.
  // `discretionary`, never essential. Lottery is split from wagering so a weekly
  // ticket is not scored like sports betting. These default `excluded: false`
  // (a deposit is discretionary spend); the chain overrides `excluded: true` on
  // gambling INFLOWS (winnings) so they never inflate spend — a per-direction
  // decision the static taxonomy cannot carry. Crypto flows are excluded in
  // both directions, so they are non-expense outcomes below, not here.
  cat("gambling_wagering", "Gambling \u2014 Wagering", "discretionary"),
  cat("gambling_casino", "Gambling \u2014 Casino", "discretionary"),
  cat("gambling_lottery", "Gambling \u2014 Lottery", "discretionary"),
  // `quasi_cash`: the low-confidence MCC-only fallback for quasi-cash codes
  // (6050/6051/6540) with no brand match. Discretionary.
  cat("quasi_cash", "Quasi-Cash", "discretionary")
];
function cat(id, label, default_classification) {
  return { id, label, default_classification, excluded: false, kind: "expense" };
}
function nonExpense(id, label) {
  return {
    id,
    label,
    default_classification: "essential",
    excluded: true,
    kind: "non_expense"
  };
}
var NON_EXPENSE_OUTCOMES = [
  nonExpense("transfer", "Transfer"),
  // ext-006 deviation 1: was `excluded: false` while the chain forced
  // `excluded: true` on the credit path — so a *user override* to this id
  // resolved as spend and diluted confident_pct. Aligned to true; the chain
  // path is unchanged.
  nonExpense("uncategorised_credit", "Uncategorised Credit"),
  // --- ext-006 (additive) ---
  // Recognised salary/benefit credits (spec §2, pulled forward from phase 2).
  // Excluded: income is emphatically not spend, and must never enter the
  // confident_pct or fallback-rate denominators.
  nonExpense("income", "Income"),
  // Savings movements, subtyped out of `transfer` so a deposit is
  // distinguishable from a withdrawal. Both stay excluded — they are transfers,
  // not spend, and the spend denominators must not move.
  nonExpense("savings_deposit", "Savings Deposit"),
  nonExpense("savings_withdrawal", "Savings Withdrawal"),
  // --- ext-008 (additive): crypto flows (ENR-25) ---
  // Exchange buys/sells and crypto ATMs. Excluded from living expenses in BOTH
  // directions — speculative flow, not a living cost. Kept here (not as expense
  // categories) so they stay out of the spend / confident_pct denominators, and
  // so a crypto SALE inflow is never mistaken for income. `crypto_atm` is split
  // out because crypto ATMs matter for scam detection.
  nonExpense("crypto_exchange", "Crypto Exchange"),
  nonExpense("crypto_atm", "Crypto ATM")
];
function allCategories() {
  return [...EXPENSE_CATEGORIES, ...NON_EXPENSE_OUTCOMES];
}
var CATEGORY_INDEX = new Map(allCategories().map((c) => [c.id, c]));
function getCategory(id) {
  return CATEGORY_INDEX.get(id);
}
function isValidCategory(id) {
  return CATEGORY_INDEX.has(id);
}
function defaultClassificationFor(id) {
  return CATEGORY_INDEX.get(id)?.default_classification;
}
function taxonomyDocument() {
  return {
    taxonomy_version: TAXONOMY_VERSION,
    classifications: CLASSIFICATIONS,
    categories: allCategories()
  };
}

// packages/engine/dist/version.js
var NORMALISER_VERSION = "1.1.0";
var MCC_TABLE_VERSION = "1.3.0";
var RULES_VERSION = "1.4.0";
var INCOME_VERSION = "1.0.0";
var SAVINGS_VERSION = "1.0.0";
var HIGH_RISK_VERSION = "1.1.0";
var ENGINE_VERSION = "1.8.0";

// packages/engine/dist/normaliser.js
var GATEWAY_PREFIX_TOKENS = [
  "SQ",
  // Square
  "SQC",
  // Square (alt)
  "PAYPAL",
  "PP",
  // PayPal (alt)
  "ZIP",
  // Zip Pay
  "EZI",
  // Ezidebit
  "SP",
  // generic storefront (Shopify / Stripe-style)
  "TST",
  // Toast
  "PY"
  // generic pay aggregator
];
var GATEWAY_PREFIX_RE = new RegExp(`^(?:${GATEWAY_PREFIX_TOKENS.join("|")})\\s*\\*\\s*`, "i");
var AU_STATES = /* @__PURE__ */ new Set([
  "NSW",
  "VIC",
  "QLD",
  "QLND",
  "WA",
  "SA",
  "TAS",
  "ACT",
  "NT"
]);
var COUNTRY_TOKENS = /* @__PURE__ */ new Set(["AU", "AUS", "AUST", "AUSTRALIA"]);
var SUBURB_TOKENS = /* @__PURE__ */ new Set([
  // capitals + major cities
  "SYDNEY",
  "MELBOURNE",
  "BRISBANE",
  "PERTH",
  "ADELAIDE",
  "HOBART",
  "DARWIN",
  "CANBERRA",
  "NEWCASTLE",
  "WOLLONGONG",
  "GEELONG",
  "TOWNSVILLE",
  "CAIRNS",
  "TOOWOOMBA",
  "BALLARAT",
  "BENDIGO",
  "LAUNCESTON",
  // common suburbs / multi-word location fragments
  "GOLD",
  "COAST",
  "SUNSHINE",
  "BONDI",
  "JUNCTION",
  "PARRAMATTA",
  "CHATSWOOD",
  "MANLY",
  "CBD",
  "NORTH",
  "SOUTH",
  "EAST",
  "WEST",
  "CENTRAL",
  "HEIGHTS",
  "PARK",
  "BAY",
  "HILL",
  "HILLS",
  "POINT",
  "CREEK",
  "VALE",
  "VALLEY",
  "RIDGE",
  "WATERS",
  "BEACH"
]);
var STORE_MARKER_TOKENS = /* @__PURE__ */ new Set([
  "STORE",
  "STR",
  "TERM",
  "TERMINAL",
  "POS",
  "TILL",
  "REG",
  "SHOP",
  "UNIT",
  "LANE",
  "PUMP"
]);
function stripGatewayPrefixes(input) {
  let s = input;
  for (let i = 0; i < 4; i++) {
    const next = s.replace(GATEWAY_PREFIX_RE, "");
    if (next === s)
      break;
    s = next.trimStart();
  }
  return s;
}
var POS_PREFIX_TOKENS = ["EFTPOS", "VISA", "DEBIT", "V"];
var POS_PREFIX_RE = new RegExp(`^(?:${POS_PREFIX_TOKENS.join("|")})\\b\\s+`);
function stripPosPrefixes(input) {
  let s = input;
  for (let i = 0; i < 4; i++) {
    const next = s.replace(POS_PREFIX_RE, "");
    if (next === s)
      break;
    s = next.trimStart();
  }
  return s;
}
function stripCardAndDateNoise(input) {
  return input.replace(/\bCARD\s?X{2,4}\d{2,6}\b/g, " ").replace(/\bX{1,4}\d{2,6}\b/g, " ").replace(/\*{2,}\d{2,6}\b/g, " ").replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ").replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, " ").replace(/\b\d{1,2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{0,4}\b/g, " ");
}
function tokens(s) {
  return s.split(/\s+/).filter((t) => t.length > 0);
}
function isStoreNumberToken(token) {
  if (/^#\d+$/.test(token))
    return true;
  if (/^\d{2,}$/.test(token))
    return true;
  if (/^[A-Z]\d{2,}$/.test(token))
    return true;
  return false;
}
function stripTrailingStoreNumbers(toks) {
  const out = [...toks];
  while (out.length > 1) {
    const last = out[out.length - 1];
    if (isStoreNumberToken(last)) {
      out.pop();
      const prev = out[out.length - 1];
      if (out.length > 1 && prev && STORE_MARKER_TOKENS.has(prev))
        out.pop();
      continue;
    }
    break;
  }
  return out;
}
function stripTrailingLocation(toks) {
  const out = [...toks];
  let markerSeen = false;
  while (out.length > 1 && COUNTRY_TOKENS.has(out[out.length - 1])) {
    out.pop();
    markerSeen = true;
  }
  if (out.length > 1 && AU_STATES.has(out[out.length - 1])) {
    out.pop();
    markerSeen = true;
  }
  if (markerSeen) {
    let popped = 0;
    while (out.length > 1 && popped < 3 && SUBURB_TOKENS.has(out[out.length - 1])) {
      out.pop();
      popped++;
    }
  }
  return out;
}
function titleCase(matchKey) {
  return matchKey.split(" ").filter((w) => w.length > 0).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
function normaliseMerchant(rawDescription) {
  const normalised_from = (rawDescription ?? "").trim();
  let work = normalised_from.toUpperCase();
  work = stripGatewayPrefixes(work);
  work = stripPosPrefixes(work);
  work = stripCardAndDateNoise(work);
  let toks = tokens(work);
  const beforeStrip = [...toks];
  for (let i = 0; i < toks.length; i++) {
    const len = toks.length;
    toks = stripTrailingStoreNumbers(toks);
    toks = stripTrailingLocation(toks);
    if (toks.length === len)
      break;
  }
  if (toks.length === 0)
    toks = beforeStrip;
  const match_key = toks.join(" ").toLowerCase().trim();
  const canonical_name = titleCase(match_key);
  return { match_key, canonical_name, normalised_from };
}
var normaliserVersion = NORMALISER_VERSION;

// packages/engine/dist/categories.js
var PENDING_PREFIX = "__pending__:";
function isPendingCategory(id) {
  return id.startsWith(PENDING_PREFIX);
}
var CATEGORY = {
  MORTGAGE: "mortgage",
  RENT: "rent",
  LOAN_REPAYMENT: "loan_repayment",
  GROCERIES: "groceries",
  UTILITIES: "utilities",
  VEHICLE_RUNNING: "vehicle_running",
  TRANSPORT: "transport",
  INSURANCE: "insurance",
  STRATA: "strata",
  EDUCATION: "education",
  SUBSCRIPTIONS: "subscriptions",
  DINING_ENTERTAINMENT: "dining_entertainment",
  CLOTHING: "clothing",
  HEALTHCARE: "healthcare",
  OTHER_EXPENSES: "other_expenses",
  // --- ext-006 additions ---
  BNPL: "bnpl",
  GENERAL_RETAIL: "general_retail",
  // --- ext-007 additions: high-risk lending signals (ENR-24) ---
  SACC_LOAN: "sacc_loan",
  WAGE_ADVANCE: "wage_advance",
  DEBT_COLLECTION: "debt_collection",
  FINES_PENALTIES: "fines_penalties",
  // --- ext-008 additions: gambling & quasi-cash (ENR-25) ---
  GAMBLING_WAGERING: "gambling_wagering",
  GAMBLING_CASINO: "gambling_casino",
  GAMBLING_LOTTERY: "gambling_lottery",
  QUASI_CASH: "quasi_cash"
};
var NON_EXPENSE = {
  TRANSFER: "transfer",
  UNCATEGORISED_CREDIT: "uncategorised_credit",
  INCOME: "income",
  SAVINGS_DEPOSIT: "savings_deposit",
  SAVINGS_WITHDRAWAL: "savings_withdrawal",
  // --- ext-008 additions: crypto flows, excluded both directions (ENR-25) ---
  CRYPTO_EXCHANGE: "crypto_exchange",
  CRYPTO_ATM: "crypto_atm"
};
var ALL_PLACEHOLDER_CATEGORIES = [
  ...Object.values(CATEGORY),
  ...Object.values(NON_EXPENSE)
];
function reconcileCategories() {
  const pendingLeft = [];
  const invalid = [];
  for (const value of ALL_PLACEHOLDER_CATEGORIES) {
    if (isPendingCategory(value)) {
      pendingLeft.push(value);
      continue;
    }
    if (!isValidCategory(value))
      invalid.push(value);
  }
  return { pending: pendingLeft, invalid };
}

// packages/engine/dist/types.js
var EMPTY_LOOKUPS = {
  userOverride: () => void 0,
  tenantOverride: () => void 0,
  dictionary: () => void 0,
  llmCache: () => void 0
};

// packages/engine/dist/exclusions.js
var EXCLUSION_CODES = /* @__PURE__ */ new Set(["TNFC", "OTFD"]);
var EXCLUSION_PATTERNS = [
  /\b(?:TRANSFER|TFR)\b/,
  /\bWITHDRAWAL\b/,
  /\bCASH\s+ADV(?:ANCE)?\b/,
  /\bATM\b/,
  /\bCASH\s+OUT\b/
];
function isBpay(input) {
  if (input.biller_code && String(input.biller_code).trim())
    return true;
  return /\bBPAY\b/.test((input.description ?? "").toUpperCase());
}
var CREDIT_CARD_CUE = /\b(CREDIT\s*CARD|CARD\s+PAYMENT|CC\s+PAYMENT)\b/;
function isBpayCreditCardRepayment(input) {
  if (!isBpay(input))
    return false;
  const hay = `${input.description ?? ""} ${input.biller_name ?? ""}`.toUpperCase();
  return CREDIT_CARD_CUE.test(hay);
}
function isExclusion(input) {
  const code = input.source_category_code?.trim().toUpperCase();
  if (code && EXCLUSION_CODES.has(code))
    return true;
  const desc = (input.description ?? "").toUpperCase();
  if (EXCLUSION_PATTERNS.some((re) => re.test(desc)))
    return true;
  return isBpayCreditCardRepayment(input);
}
var CASH_WITHDRAWAL_PATTERNS = [
  /\bWITHDRAWAL\b/,
  /\bATM\b/,
  /\bCASH\s+OUT\b/
];
var VENUE_CASH_CUE = /\b(?:HOTEL|RSL|LEAGUES|TAVERN|CLUB)\b/;
function isVenueCashWithdrawal(input) {
  const desc = (input.description ?? "").toUpperCase();
  return CASH_WITHDRAWAL_PATTERNS.some((re) => re.test(desc)) && VENUE_CASH_CUE.test(desc);
}

// packages/engine/dist/savings.js
var SAVINGS_ACCOUNT_TYPE = "savings";
var SAVINGS_NOUN = "(?:SAVINGS?|SAVER|SAVINGS ACCOUNT|GOAL)";
var TO_SAVINGS = new RegExp(`\\b(?:TO|INTO)\\b[^A-Z0-9]{0,12}\\b${SAVINGS_NOUN}\\b`);
var FROM_SAVINGS = new RegExp(`\\b(?:FROM|OUT\\s+OF)\\b[^A-Z0-9]{0,12}\\b${SAVINGS_NOUN}\\b`);
function isSavingsAccount(input) {
  return input.account_type?.trim().toLowerCase() === SAVINGS_ACCOUNT_TYPE;
}
function isExplicitSavingsMovement(input) {
  const desc = (input.description ?? "").toUpperCase();
  return TO_SAVINGS.test(desc) || FROM_SAVINGS.test(desc);
}
function resolveSavingsOutcome(input) {
  if (isSavingsAccount(input) && typeof input.amount === "number" && input.amount !== 0) {
    return input.amount > 0 ? NON_EXPENSE.SAVINGS_DEPOSIT : NON_EXPENSE.SAVINGS_WITHDRAWAL;
  }
  const desc = (input.description ?? "").toUpperCase();
  if (TO_SAVINGS.test(desc))
    return NON_EXPENSE.SAVINGS_DEPOSIT;
  if (FROM_SAVINGS.test(desc))
    return NON_EXPENSE.SAVINGS_WITHDRAWAL;
  return void 0;
}

// packages/engine/dist/income.js
var INCOME_CONFIDENCE = 0.9;
var INCOME_RULES = [
  { id: "I1-salary", pattern: /\b(salary|salaries)\b/ },
  { id: "I2-payroll", pattern: /\b(payroll|pay ?run|payrun)\b/ },
  { id: "I3-wages", pattern: /\b(wages|wage payment)\b/ },
  {
    id: "I4-benefits",
    pattern: /\b(centrelink|services australia|jobseeker|youth allowance|austudy|abstudy|family tax benefit|paid parental leave|dept veterans affairs|veterans affairs)\b/
  },
  { id: "I5-pension", pattern: /\b(pension|superannuation payment|super payment)\b/ }
];
function recogniseIncome(merchant, input) {
  const haystack = [
    input.source_category_description ?? "",
    input.description ?? "",
    merchant.match_key
  ].join(" ").toLowerCase().trim();
  for (const rule of INCOME_RULES) {
    if (rule.pattern.test(haystack)) {
      return { category: NON_EXPENSE.INCOME, ruleId: rule.id };
    }
  }
  return void 0;
}

// packages/engine/dist/mcc.js
var MCC_CONFIDENCE = 0.95;
var MCC_GROUPS = [
  {
    category: CATEGORY.GROCERIES,
    codes: ["5411", "5422", "5441", "5451", "5462", "5499"]
  },
  {
    category: CATEGORY.DINING_ENTERTAINMENT,
    // Eating/drinking + entertainment (kickoff: entertainment MCCs → dining_entertainment).
    codes: [
      "5811",
      "5812",
      "5813",
      "5814",
      "7832",
      "7841",
      "7829",
      "7922",
      "7929",
      "7911",
      "7997",
      "7996",
      "7998",
      "7999",
      "7933",
      "7992",
      "7941"
    ]
  },
  {
    category: CATEGORY.VEHICLE_RUNNING,
    // Fuel is the canonical priority cue (kickoff: 5541/5542 → vehicle_running).
    codes: ["5172", "5541", "5542", "5983", "5533", "5531", "5532", "7538", "7549", "7534", "7523"],
    note: "fuel 5541/5542 override 'Coles Express'-style merchant names"
  },
  {
    category: CATEGORY.TRANSPORT,
    codes: ["4111", "4112", "4121", "4131", "4784", "4789", "4011", "4304", "7512", "7513", "7519"]
  },
  {
    // 4900 is utilities proper. 4899 (cable/satellite/pay-TV/streaming) moved to
    // subscriptions below — real traffic (NETFLIX.COM, SPOTIFY AU) arrives on
    // 4899 and must NOT inflate essential spend (compliance: conservative posture).
    category: CATEGORY.UTILITIES,
    codes: ["4812", "4814", "4821", "4900"]
  },
  {
    // Digital subscriptions / streaming / continuity (discretionary). Shadow-mode
    // fix: 4899 streaming was classifying as utilities/essential at 0.95.
    category: CATEGORY.SUBSCRIPTIONS,
    codes: ["4899", "5815", "5816", "5817", "5818", "5968"]
  },
  {
    category: CATEGORY.INSURANCE,
    codes: ["5960", "6300", "6381", "6399"]
  },
  {
    category: CATEGORY.HEALTHCARE,
    codes: [
      "5122",
      "5292",
      "5295",
      "5912",
      "5975",
      "5976",
      "8011",
      "8021",
      "8031",
      "8041",
      "8042",
      "8043",
      "8049",
      "8050",
      "8062",
      "8071",
      "8099"
    ]
  },
  {
    category: CATEGORY.CLOTHING,
    codes: ["5611", "5621", "5631", "5641", "5651", "5655", "5661", "5681", "5691", "5697", "5698", "5699", "5948", "5949"]
  },
  {
    category: CATEGORY.EDUCATION,
    codes: ["8211", "8220", "8241", "8244", "8249", "8299", "8351"]
  },
  {
    category: CATEGORY.RENT,
    // Real-estate agents / property managers — rent (ext-002 §5 anchor 6513).
    codes: ["6513"]
  },
  {
    // ext-006: general retail / department / electronics / homewares / hobby —
    // lifted out of the other_expenses catch-all into a category of its own.
    // Classification is unchanged (both default `discretionary`), so no
    // affordability number moves; what changes is that `other_expenses` now
    // means "genuinely unclassified" rather than "retail plus everything else".
    category: CATEGORY.GENERAL_RETAIL,
    codes: [
      "5200",
      "5211",
      "5231",
      "5251",
      "5261",
      "5300",
      "5309",
      "5310",
      "5311",
      "5331",
      "5399",
      "5712",
      "5713",
      "5714",
      "5718",
      "5719",
      "5722",
      "5732",
      "5733",
      "5734",
      "5735",
      "5931",
      "5940",
      "5941",
      "5942",
      "5943",
      "5944",
      "5945",
      "5946",
      "5947",
      "5970",
      "5992",
      "5999"
    ]
  },
  {
    // Taxonomy still has no travel/personal-care/services/government categories
    // — these ISO groups fall to the discretionary catch-all.
    category: CATEGORY.OTHER_EXPENSES,
    codes: [
      // travel & lodging (deviation 4: lodging → other_expenses)
      "3000",
      "3501",
      "4411",
      "4457",
      "4511",
      "4722",
      "4723",
      "7011",
      "7012",
      "7032",
      "7033",
      // personal care & services
      "5977",
      "7230",
      "7297",
      "7298",
      "7210",
      "7211",
      "7216",
      "7251",
      "7261",
      // professional / business services
      "7276",
      "7277",
      "7311",
      "7333",
      "7338",
      "7339",
      "7372",
      "7392",
      "7393",
      "7399",
      "8111",
      "8911",
      "8931",
      "8999",
      // government / non-profit / misc (9211/9222/9223 moved to fines_penalties, ext-007)
      "8398",
      "8641",
      "8651",
      "8661",
      "8675",
      "8699",
      "9311",
      "9399",
      "9402",
      "9405"
    ]
  },
  {
    // ext-007 (ENR-24): debt collection agencies. No diff — 7322 was unmapped.
    category: CATEGORY.DEBT_COLLECTION,
    codes: ["7322"]
  },
  {
    // ext-007 (ENR-24): court costs / fines / bail. Re-homed from other_expenses
    // now that a category exists — a behavioural diff on these three codes.
    // 9311 (tax payments) is NOT a fine and stays in other_expenses.
    category: CATEGORY.FINES_PENALTIES,
    codes: ["9211", "9222", "9223"]
  }
];
var MCC_TABLE = (() => {
  const map = /* @__PURE__ */ new Map();
  for (const group of MCC_GROUPS) {
    for (const code of group.codes) {
      if (map.has(code)) {
        throw new Error(`MCC ${code} mapped twice (${map.get(code)} vs ${group.category})`);
      }
      map.set(code, group.category);
    }
  }
  return map;
})();
var mccTableVersion = MCC_TABLE_VERSION;
function lookupMcc(mcc) {
  if (!mcc)
    return void 0;
  const category = MCC_TABLE.get(mcc.trim());
  if (!category)
    return void 0;
  return { category, confidence: MCC_CONFIDENCE };
}

// packages/engine/dist/rules.js
var RULES_CONFIDENCE = 0.7;
var RULES = [
  // --- Priority cues (outrank the brand rules) ---
  { id: "P1-fuel", pattern: /\b(fuel|petrol|service station)\b/, category: CATEGORY.VEHICLE_RUNNING },
  {
    id: "P2-cinema",
    pattern: /\b(cinema|cinemas|hoyts|event cinemas|village cinemas|ticketek|ticketmaster)\b/,
    category: CATEGORY.DINING_ENTERTAINMENT
  },
  {
    // ext-006. Sits with the priority cues because a BNPL instalment is a
    // scheduled obligation wherever it appears, and because `afterpay` /
    // `zip pay` previously resolved to loan_repayment via rule 3 — this rule
    // takes them over (same classification, sharper category).
    //
    // Note the normaliser strips `ZIP *` as a GATEWAY prefix, so `ZIP*BIGW`
    // normalises to `bigw` and is correctly treated as the underlying purchase,
    // not a BNPL repayment. Only the spaced/suffixed brand forms reach here.
    // `latitude` (bare) deliberately stays on rule 3: Latitude writes personal
    // loans as well as LatitudePay.
    id: "P3-bnpl",
    pattern: /\b(afterpay|zip pay|zippay|zip money|zipmoney|zip co|klarna|humm|hummgroup|openpay|payright|sezzle|latitude ?pay|brighte)\b/,
    category: CATEGORY.BNPL
  },
  {
    // ext-007 (ENR-24). High-risk lending cues, ahead of the brand chain so a
    // SACC/payday loan is tagged as such rather than collapsing into the generic
    // `3-loan` rule (loan_repayment). Curated AU brand seeds — REPLACEABLE,
    // extend from real Kanopi data. Conf 0.70 like every rules hit; the seed
    // (scripts/seed-merchants.ts) lifts the common brands to dictionary strength.
    id: "P4-sacc",
    pattern: /\b(nimble|cash ?converters|wallet wizard|moneyme|money me|sunshine loans|credit24|ferratum|cigno|jacaranda finance|fair ?go finance|swoosh finance|speckle|fundo|beyond cash|good ?2 ?go)\b/,
    category: CATEGORY.SACC_LOAN
  },
  {
    // Earned-wage-access / pay-advance. NB the chain only reaches the rules tier
    // on debits: a wage ADVANCE is an inflow and is handled by the income/credit
    // tier first, so this tags the repayment/fee debit, not the advance itself.
    // `advancepay` is matched specifically — a bare `advance` would collide with
    // "cash advance" (an exclusion).
    id: "P5-wage-advance",
    pattern: /\b(beforepay|mypaynow|my pay now|advancepay|commbank advancepay|earnd|wagetap|wage tap|payactiv|wagestream)\b/,
    category: CATEGORY.WAGE_ADVANCE
  },
  {
    // Debt collectors / buyers. Bare short forms (arl, ccs) are deliberately
    // omitted to avoid false positives; match the full agency names.
    id: "P6-debt-collection",
    pattern: /\b(baycorp|credit ?corp|panthera|milton graham|pioneer credit|collection house|recoveries corp|complete credit solutions|prushka|probe group|indebted|arl collect|lion finance)\b/,
    category: CATEGORY.DEBT_COLLECTION
  },
  {
    // Fines / infringements / statutory penalties. `revenue nsw` (fines) not bare
    // `service nsw` (also licensing/rego). Tolls are transport, not fines, so no
    // toll brands here.
    id: "P7-fines",
    pattern: /\b(revenue nsw|fines victoria|state debt recovery|sdro|revenue sa|revenuesa|infringement|penalty notice|court fine)\b/,
    category: CATEGORY.FINES_PENALTIES
  },
  // --- Brand chain ---
  { id: "1-mortgage", codes: ["MRTG"], pattern: /\b(mortgage|home loan)\b/, category: CATEGORY.MORTGAGE },
  { id: "2-rent", codes: ["RNT"], pattern: /\brent(al)?\b/, category: CATEGORY.RENT },
  {
    // ext-006: afterpay / zip pay / zippay moved up to P3-bnpl. `latitude`
    // stays — Latitude Financial writes personal loans, and the BNPL brand is
    // matched by its explicit `latitudepay` form in P3.
    id: "3-loan",
    pattern: /\b(personal loan|car loan|loan repayment|latitude|plenti|harmoney)\b/,
    category: CATEGORY.LOAN_REPAYMENT
  },
  {
    id: "4-groceries",
    codes: ["GROC"],
    pattern: /\b(grocery|grocer|woolworths|coles|aldi|iga|foodworks|harris farm)\b/,
    category: CATEGORY.GROCERIES
  },
  {
    id: "5-utilities",
    // OTHD ("other debits") removed (ext-004 §1): it is a DocuScan catch-all
    // code carrying no category signal, and it was short-circuiting to utilities
    // before description matching (the Opal bug). Codes match only when specific.
    // Audit: OTHD was the only catch-all in the chain; all other codes (MRTG,
    // RNT, GROC, UTIL, UTLW, VHFL, TRVL, INSDC, SRTA, EDUCP, STRM, REST, CLTH,
    // HLTH) are category-specific and retained.
    codes: ["UTIL", "UTLW"],
    pattern: /\b(utility|electric|electricity|energy|gas|water|internet|broadband|phone|mobile|telstra|optus|vodafone|agl|origin|energyaustralia|red energy)\b/,
    category: CATEGORY.UTILITIES
  },
  {
    id: "6-fuel-brands",
    codes: ["VHFL"],
    pattern: /\b(diesel|caltex|shell|bp|ampol|7-eleven fuel|united petroleum)\b/,
    category: CATEGORY.VEHICLE_RUNNING
  },
  {
    id: "7-transport",
    codes: ["TRVL"],
    pattern: /\b(transport|uber|taxi|didi|ola|ferry|train|bus|tram|opal|myki|translink|toll|linkt|eastlink)\b/,
    category: CATEGORY.TRANSPORT
  },
  {
    id: "8-insurance",
    codes: ["INSDC"],
    pattern: /\b(insurance|nrma|aami|allianz|budget direct|youi|medibank|bupa|hcf|nib)\b/,
    category: CATEGORY.INSURANCE
  },
  {
    id: "9-strata",
    codes: ["SRTA"],
    pattern: /\b(strata|body corporate|owners corporation)\b/,
    category: CATEGORY.STRATA
  },
  {
    id: "10-education",
    codes: ["EDUCP"],
    // Bare `fees` removed (ext-002 deviation 2).
    pattern: /\b(school|education|tuition|tafe|university|childcare|kindergarten)\b/,
    category: CATEGORY.EDUCATION
  },
  {
    id: "11-subscriptions",
    codes: ["STRM"],
    pattern: /\b(netflix|spotify|stan|binge|kayo|disney|youtube premium|apple\.com\/bill|amazon prime|subscription|stream)\b/,
    category: CATEGORY.SUBSCRIPTIONS
  },
  {
    id: "12-dining",
    codes: ["REST"],
    // hotel/bar stay in dining_entertainment (ext-002 deviation 4).
    pattern: /\b(restaurant|cafe|coffee|hotel|bar|pub|takeaway|doordash|uber eats|menulog|deliveroo|mcdonald|kfc|hungry jack|domino)\b/,
    category: CATEGORY.DINING_ENTERTAINMENT
  },
  {
    id: "13-clothing",
    codes: ["CLTH"],
    pattern: /\b(clothing|fashion|myer|david jones|kmart|target|big w|uniqlo|cotton on)\b/,
    category: CATEGORY.CLOTHING
  },
  {
    id: "14-healthcare",
    codes: ["HLTH"],
    pattern: /\b(medical|health|pharmacy|chemist|doctor|dental|dentist|physio|optometrist|terry white|priceline)\b/,
    category: CATEGORY.HEALTHCARE
  },
  {
    // ext-006. LAST in the chain by design: it is the broadest net here, so
    // every more specific rule — including 11-subscriptions, which must keep
    // `amazon prime` — gets first refusal. Department stores that sell mostly
    // apparel (myer, kmart, target, big w) stay on 13-clothing, unchanged.
    id: "15-general-retail",
    pattern: /\b(jb hi-?fi|jbhifi|harvey norman|the good guys|officeworks|bunnings|ikea|amazon (?:au|marketplace)|catch\.com|temu|ebay|department store)\b/,
    category: CATEGORY.GENERAL_RETAIL
  }
];
function applyRules(merchant, input) {
  const code = input.source_category_code?.trim().toUpperCase();
  const haystack = `${input.source_category_description ?? ""} ${input.biller_name ?? ""} ${merchant.match_key}`.toLowerCase().trim();
  for (const rule of RULES) {
    if (code && rule.codes && rule.codes.includes(code)) {
      return { category: rule.category, ruleId: rule.id };
    }
    if (rule.pattern && rule.pattern.test(haystack)) {
      return { category: rule.category, ruleId: rule.id };
    }
  }
  return void 0;
}

// packages/engine/dist/high-risk-flow.js
var CONF_BRAND_AND_MCC = 0.95;
var CONF_BRAND_ALONE = 0.8;
var CONF_GAMBLING_MCC_ALONE = 0.8;
var CONF_QUASI_CASH_MCC_ALONE = 0.5;
var BRAND_RULES = [
  {
    id: "G1-lottery",
    pattern: /\b(the lott|lotterywest|keno)\b/,
    category: CATEGORY.GAMBLING_LOTTERY
  },
  {
    // `crown`/`star`/`treasury` are anchored to their venue forms to avoid
    // Crown Street / "star" cafés / the Treasury department.
    id: "G2-casino",
    pattern: /\b(crown (?:melbourne|sydney|perth|casino|resorts|towers)|the star (?:sydney|gold coast)|star (?:entertainment|casino|city)|skycity|treasury (?:brisbane|casino))\b/,
    category: CATEGORY.GAMBLING_CASINO
  },
  {
    // `tab` only in anchored forms; `betr` word-bounded (won't hit "better").
    id: "G3-wagering",
    pattern: /\b(sportsbet|tabcorp|tabtouch|tab\.com\.au|tab limited|bet365|ladbrokes|neds|pointsbet|betfair|unibet|bluebet|betr|dabble|playup|topsport|palmerbet)\b/,
    category: CATEGORY.GAMBLING_WAGERING
  },
  {
    id: "C1-crypto-atm",
    pattern: /\b(coinflip|localcoin)\b/,
    category: NON_EXPENSE.CRYPTO_ATM
  },
  {
    id: "C2-crypto-exchange",
    pattern: /\b(coinspot|swyftx|independent reserve|btc markets|coinjar|digital surge|coinbase|binance|kraken|crypto\.com)\b/,
    category: NON_EXPENSE.CRYPTO_EXCHANGE
  }
];
var GAMBLING_MCC = {
  "7995": CATEGORY.GAMBLING_WAGERING,
  // betting incl. lottery tickets & casino chips
  "7800": CATEGORY.GAMBLING_LOTTERY,
  // government-owned lotteries
  "7801": CATEGORY.GAMBLING_CASINO,
  // government-licensed online casinos
  "7802": CATEGORY.GAMBLING_WAGERING,
  // government-licensed horse/dog racing
  "9754": CATEGORY.GAMBLING_WAGERING
  // horse/dog racing, state lotteries
};
var QUASI_CASH_MCC = /* @__PURE__ */ new Set(["6050", "6051", "6540"]);
var BILLER_CODES = {
  "89672": {
    category: CATEGORY.GAMBLING_WAGERING,
    id: "biller-sportsbet-89672",
    brand: "Sportsbet",
    source: "published",
    found_date: "2026-10-22",
    source_url: "https://helpcentre.sportsbet.com.au/hc/en-us/articles/18421939318925",
    review_after: "2027-01-20"
  },
  "1214": {
    category: CATEGORY.GAMBLING_WAGERING,
    id: "biller-tabtouch-1214",
    brand: "TABtouch",
    source: "published",
    found_date: "2026-10-22",
    source_url: "https://help.tabtouch.com.au/knowledge-base/manage-my-funds/",
    review_after: "2027-01-20"
  }
};
function billerCodesDueForReview(asOf = /* @__PURE__ */ new Date()) {
  return Object.entries(BILLER_CODES).filter(([, e]) => e.source === "published" && !!e.review_after && new Date(e.review_after) <= asOf).map(([code, e]) => ({
    code,
    brand: e.brand,
    found_date: e.found_date,
    source_url: e.source_url
  }));
}
function familyOf(category) {
  if (category.startsWith("gambling_"))
    return "gambling";
  if (category.startsWith("crypto_"))
    return "crypto";
  return "other";
}
function detectHighRiskFlow(merchant, input) {
  const haystack = [
    input.source_category_description,
    merchant.match_key,
    input.merchant_name,
    input.reference,
    input.biller_name
  ].filter((s) => Boolean(s)).join(" ").toLowerCase();
  const mcc = input.mcc?.trim();
  const gamblingMcc = mcc ? GAMBLING_MCC[mcc] : void 0;
  const isQuasiMcc = mcc ? QUASI_CASH_MCC.has(mcc) : false;
  let brand;
  for (const rule of BRAND_RULES) {
    if (rule.pattern.test(haystack)) {
      brand = { category: rule.category, ruleId: rule.id };
      break;
    }
  }
  if (!brand && input.biller_code) {
    const b = BILLER_CODES[input.biller_code.trim()];
    if (b)
      brand = { category: b.category, ruleId: b.id };
  }
  if (brand) {
    const fam = familyOf(brand.category);
    const consistentMcc = fam === "gambling" && gamblingMcc !== void 0 || fam === "crypto" && isQuasiMcc;
    return {
      category: brand.category,
      confidence: consistentMcc ? CONF_BRAND_AND_MCC : CONF_BRAND_ALONE,
      matchedRuleId: brand.ruleId
    };
  }
  if (gamblingMcc) {
    return { category: gamblingMcc, confidence: CONF_GAMBLING_MCC_ALONE, matchedRuleId: `mcc-${mcc}` };
  }
  if (isQuasiMcc) {
    return { category: CATEGORY.QUASI_CASH, confidence: CONF_QUASI_CASH_MCC_ALONE, matchedRuleId: `mcc-${mcc}` };
  }
  return void 0;
}
var HIGH_RISK_SEED_GROUPS = [
  {
    category: CATEGORY.GAMBLING_LOTTERY,
    brands: ["The Lott", "Lotterywest", "Keno"]
  },
  {
    category: CATEGORY.GAMBLING_CASINO,
    brands: [
      "Crown Melbourne",
      "Crown Sydney",
      "Crown Perth",
      "The Star Sydney",
      "The Star Gold Coast",
      "Star Entertainment",
      "SkyCity Adelaide",
      "Treasury Brisbane"
    ]
  },
  {
    category: CATEGORY.GAMBLING_WAGERING,
    brands: [
      "Sportsbet",
      "Tabcorp",
      "TABtouch",
      "bet365",
      "Ladbrokes",
      "Neds",
      "PointsBet",
      "Betfair",
      "Unibet",
      "BlueBet",
      "Betr",
      "Dabble",
      "PlayUp",
      "TopSport",
      "Palmerbet"
    ]
  },
  {
    category: NON_EXPENSE.CRYPTO_ATM,
    brands: ["Coinflip", "Localcoin"]
  },
  {
    category: NON_EXPENSE.CRYPTO_EXCHANGE,
    brands: [
      "CoinSpot",
      "Swyftx",
      "Independent Reserve",
      "BTC Markets",
      "CoinJar",
      "Digital Surge",
      "Coinbase",
      "Binance",
      "Kraken",
      "Crypto.com"
    ]
  }
];

// packages/engine/dist/chain.js
var TRANSFER_CATEGORY = NON_EXPENSE.TRANSFER;
var CREDIT_CATEGORY = NON_EXPENSE.UNCATEGORISED_CREDIT;
var FALLBACK_CATEGORY = CATEGORY.OTHER_EXPENSES;
var FALLBACK_CLASSIFICATION = "essential";
var FALLBACK_CONFIDENCE = 0.3;
var DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.8;
var DEFAULT_LLM_TRUST_THRESHOLD = 0.6;
function resolveClassification(category, explicit) {
  return explicit ?? defaultClassificationFor(category) ?? "essential";
}
function build(source, category, classification, confidence, merchant, opts) {
  const flags = [...opts.flags ?? []];
  if (source !== "fallback" && confidence < opts.lowConfidenceThreshold && !flags.includes("low_confidence")) {
    flags.push("low_confidence");
  }
  return {
    category,
    classification,
    confidence,
    source,
    // Derive `excluded` from the taxonomy when not set explicitly, so a
    // non-fallback path that resolves to an excluded outcome (e.g. a user
    // override to `transfer`, ext-004 §5) is correctly marked excluded.
    excluded: opts.excluded ?? getCategory(category)?.excluded ?? false,
    flags,
    merchant,
    engine_version: ENGINE_VERSION,
    taxonomy_version: TAXONOMY_VERSION,
    // ext-008: direction (from the amount sign) and the matched rule id, both
    // omitted when absent so a consumer never sees a null field.
    ...opts.direction ? { direction: opts.direction } : {},
    ...opts.matchedRuleId ? { matched_rule_id: opts.matchedRuleId } : {}
  };
}
function categorise(input, lookups, options = {}) {
  const lowConfidenceThreshold = options.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  const llmTrustThreshold = options.llmTrustThreshold ?? DEFAULT_LLM_TRUST_THRESHOLD;
  const incomeSavingsEnabled = options.incomeSavingsEnabled ?? true;
  const merchant = normaliseMerchant(input.description);
  const direction = typeof input.amount === "number" ? input.amount > 0 ? "in" : input.amount < 0 ? "out" : void 0 : void 0;
  const common = { lowConfidenceThreshold, direction };
  const highRisk = detectHighRiskFlow(merchant, input);
  if (highRisk) {
    const excluded = highRisk.category.startsWith("crypto_") || highRisk.category.startsWith("gambling_") && direction === "in" ? true : void 0;
    return build("high_risk", highRisk.category, resolveClassification(highRisk.category), highRisk.confidence, merchant, { excluded, matchedRuleId: highRisk.matchedRuleId, ...common });
  }
  const explicitSavings = incomeSavingsEnabled && isExplicitSavingsMovement(input);
  if (isExclusion(input) || explicitSavings) {
    const savings = incomeSavingsEnabled ? resolveSavingsOutcome(input) : void 0;
    const category = savings ?? TRANSFER_CATEGORY;
    const venueFlag = !savings && isVenueCashWithdrawal(input) ? ["venue_cash_withdrawal"] : [];
    return build(savings ? "savings" : "exclusion", category, resolveClassification(category), 1, merchant, { excluded: true, ...venueFlag.length ? { flags: venueFlag } : {}, ...common });
  }
  if (typeof input.amount === "number" && input.amount > 0) {
    if (incomeSavingsEnabled) {
      const income = recogniseIncome(merchant, input);
      if (income) {
        return build("income", income.category, resolveClassification(income.category), INCOME_CONFIDENCE, merchant, { excluded: true, matchedRuleId: income.ruleId, ...common });
      }
    }
    return build("credit", CREDIT_CATEGORY, resolveClassification(CREDIT_CATEGORY), 1, merchant, { excluded: true, ...common });
  }
  const userOverride = lookups.userOverride(merchant.match_key);
  if (userOverride) {
    return build("user_override", userOverride.category, resolveClassification(userOverride.category, userOverride.classification), 1, merchant, common);
  }
  const tenantOverride = lookups.tenantOverride(merchant.match_key);
  if (tenantOverride) {
    return build("tenant_override", tenantOverride.category, resolveClassification(tenantOverride.category, tenantOverride.classification), 0.98, merchant, common);
  }
  const mcc = lookupMcc(input.mcc);
  if (mcc) {
    return build("mcc", mcc.category, resolveClassification(mcc.category), mcc.confidence, merchant, common);
  }
  const dict = lookups.dictionary(merchant.match_key);
  if (dict) {
    return build("dictionary", dict.category, resolveClassification(dict.category, dict.classification), dict.confidence, merchant, common);
  }
  const rule = applyRules(merchant, input);
  if (rule) {
    return build("rules", rule.category, resolveClassification(rule.category), RULES_CONFIDENCE, merchant, { matchedRuleId: rule.ruleId, ...common });
  }
  const cache = lookups.llmCache(merchant.match_key);
  if (cache && cache.confidence >= llmTrustThreshold) {
    return build("llm_cache", cache.category, resolveClassification(cache.category, cache.classification), cache.confidence, merchant, common);
  }
  return build("fallback", FALLBACK_CATEGORY, FALLBACK_CLASSIFICATION, FALLBACK_CONFIDENCE, merchant, { flags: ["unverified"], ...common });
}
export {
  ALL_PLACEHOLDER_CATEGORIES,
  AU_STATES,
  BILLER_CODES,
  CATEGORY,
  COUNTRY_TOKENS,
  EMPTY_LOOKUPS,
  ENGINE_VERSION,
  EXCLUSION_CODES,
  EXCLUSION_PATTERNS,
  FALLBACK_CONFIDENCE,
  GATEWAY_PREFIX_TOKENS,
  HIGH_RISK_SEED_GROUPS,
  HIGH_RISK_VERSION,
  INCOME_CONFIDENCE,
  INCOME_RULES,
  INCOME_VERSION,
  MCC_CONFIDENCE,
  MCC_TABLE,
  MCC_TABLE_VERSION,
  NON_EXPENSE,
  NORMALISER_VERSION,
  PENDING_PREFIX,
  POS_PREFIX_TOKENS,
  RULES,
  RULES_CONFIDENCE,
  RULES_VERSION,
  SAVINGS_VERSION,
  SUBURB_TOKENS,
  TAXONOMY_VERSION,
  VENUE_CASH_CUE,
  applyRules,
  billerCodesDueForReview,
  categorise,
  detectHighRiskFlow,
  isBpayCreditCardRepayment,
  isExclusion,
  isExplicitSavingsMovement,
  isPendingCategory,
  isVenueCashWithdrawal,
  lookupMcc,
  mccTableVersion,
  normaliseMerchant,
  normaliserVersion,
  recogniseIncome,
  reconcileCategories,
  resolveSavingsOutcome,
  taxonomyDocument
};
