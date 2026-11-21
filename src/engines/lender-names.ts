// Known lender names (D29; SIG-42 ruling 2 of 10 November 2026; SIG-64). A listed name is shown
// in full wherever a lender is named, and is never masked, though it may hold a sensitive word
// (HEALTH PROFESSIONALS BANK); so is any name with CREDIT UNION in it (ruling of 19 November 2026
// on review 12). Names are upper case ASCII letters and digits, single spaces.
//
// No reserved unseen-lender name of the synthetic sets may be added here (catalog.ts; checked by
// test/research/lender-names.test.ts), or those groups stop testing lenders the engines have
// never named. Pure: no clock, no randomness, relative imports (D3).

/**
 * 1.1.0 (SIG-42, 10 November 2026): matched on the bank's description before digits go.
 * 1.2.0 (SIG-64, ruling 40524): adds the customer-owned banks, credit unions and building
 * societies on APRA's register of authorised deposit-taking institutions (updated 15 October
 * 2026) and their trading names on APRA's Financial Claims Scheme list (updated 9 October 2026),
 * where the name has two words or more and no punctuation; and OSTEON FINANCE, review 12's probe
 * name (Colin, 21 November 2026), which is not an APRA-listed lender. Names with "&" or an
 * apostrophe (P&N BANK, PEOPLE'S CHOICE, B&E, G&C MUTUAL BANK, POLICE & NURSES, CAIRNS PENNY
 * SAVINGS & LOANS) are left out; one-word names (QBANK, BANKVIC, UNIBANK, IMB) need no entry.
 * Two APRA trading names are left out because they contain a reserved unseen-lender name of
 * synthetic set v2.2 (validity check V6; the rule above), so they are not written here.
 */
export const LENDER_NAMES_VERSION = "1.2.0";

export const LENDER_NAMES: readonly string[] = [
  // 1.1.0
  "AMERICAN EXPRESS",
  "BANK OF MELBOURNE",
  "BANK OF QUEENSLAND",
  "BENDIGO BANK",
  "CASH CONVERTERS",
  "COMMONWEALTH BANK",
  "GREAT SOUTHERN BANK",
  "MACQUARIE BANK",
  "MONEY3",
  "ST GEORGE",
  "WALLET WIZARD",
  // 1.2.0: APRA register of ADIs, customer-owned (legal names, without LIMITED or LTD)
  "AUSTRALIAN MILITARY BANK",
  "BANK AUSTRALIA",
  "BEYOND BANK",
  "BEYOND BANK AUSTRALIA",
  "CENTRAL MURRAY CREDIT UNION",
  "CENTRAL WEST CREDIT UNION",
  "COASTLINE CREDIT UNION",
  "COMMUNITY FIRST CREDIT UNION",
  "CREDIT UNION AUSTRALIA",
  "CREDIT UNION SA",
  "DEFENCE BANK",
  "FIRE SERVICE CREDIT UNION",
  "GOULBURN MURRAY CREDIT UNION",
  "HORIZON CREDIT UNION",
  "LABORATORIES CREDIT UNION",
  "MACARTHUR CREDIT UNION",
  "MAITLAND MUTUAL",
  "MEMBERS BANKING GROUP",
  "NEWCASTLE GREATER MUTUAL",
  "NORTHERN INLAND CREDIT UNION",
  "ORANGE CREDIT UNION",
  "POLICE BANK",
  "POLICE CREDIT UNION",
  "POLICE FINANCIAL SERVICES",
  "QUEENSLAND COUNTRY BANK",
  "RAILWAYS CREDIT UNION",
  "REGIONAL AUSTRALIA BANK",
  "SOUTH WEST SLOPES CREDIT UNION",
  "SOUTHERN CROSS CREDIT UNION",
  "TEACHERS MUTUAL BANK",
  "THE BROKEN HILL COMMUNITY CREDIT UNION",
  "THE CAPRICORNIAN",
  "TRADITIONAL CREDIT UNION",
  "TRANSPORT MUTUAL CREDIT UNION",
  "VICTORIA TEACHERS",
  "WARWICK CREDIT UNION",
  "WAW CREDIT UNION",
  // 1.2.0: their trading names (APRA Financial Claims Scheme list)
  "AUSTRALIAN MUTUAL BANK",
  "BANK OF HERITAGE ISLE",
  "BANK OF US",
  "BANK ORANGE",
  "BORDER BANK",
  "BROKEN HILL BANK",
  "CAIRNS BANK",
  "CENTRAL MURRAY BANK",
  "COASTLINE BANK",
  "COMMUNITY FIRST BANK",
  "DARLING DOWNS BANK",
  "EASY STREET FINANCIAL SERVICES",
  "FIREFIGHTERS MUTUAL BANK",
  "GOLDFIELDS MONEY",
  "GREATER BANK",
  "HEALTH PROFESSIONALS BANK",
  "HERITAGE BANK",
  "HORIZON BANK",
  "ILLAWARRA CREDIT UNION",
  "IMB BANK",
  "NEWCASTLE PERMANENT",
  "PEOPLE FIRST BANK",
  "RACQ BANK",
  "RELIANCE BANK",
  "RSL MONEY",
  "THE CAPRICORNIAN BANK",
  "THE MAC",
  "THE MUTUAL BANK",
  "THE SHIRE",
  // 1.2.0: review 12's probe name (Colin, 21 November 2026); not an APRA-listed lender
  "OSTEON FINANCE",
];
