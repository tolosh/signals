# Lender-alias table: how it was compiled (v1.0.0, 2026-11-19)

## Method
I fixed the scope first from the public lists below. I then split the research into four parallel web-only research forks: top-10 banks, customer-owned banks and bank sub-brands, card/BNPL/SACC, and wage advance plus personal/car loans. Each fork worked under the same rules I did. They read only lender websites (footers, terms, how-to-pay pages, credit guides), ABN Lookup, the APRA register and ASIC pages. A merge script (`../merge_sig57.py`) combined the four part files in `parts/`, checked that every alias is upper case and has a `source_url`, and computed `shared_aliases`.

## Scope lists
- APRA Register of ADIs (updated 15 Oct 2026). I used it for bank legal and trading names: https://www.apra.gov.au/register-of-authorised-deposit-taking-institutions
- Savings.com.au, "Who are the biggest banks in Australia" (APRA data): https://www.savings.com.au/home-loans/who-are-the-biggest-banks-in-australia
- CreditCardCompare, Credit Card Issuers: https://www.creditcardcompare.com.au/issuers
- ASIC 20-280MR (REP 672 BNPL providers): https://asic.gov.au/about-asic/news-centre/find-a-media-release/2020-releases/20-280mr-asic-releases-latest-data-on-buy-now-pay-later-industry/
- Senate Economics References Committee report, ch. 3: https://aph.gov.au/Parliamentary_Business/Committees/Senate/Economics/Creditfinancialservices/Report/c03. Seen via search results only (the page returned 403).
- Cash Converters comparison page: https://www.cashconverters.com.au/loans/resources/compare-our-cashies-loan-with-other-cash-loans
- Savings.com.au wage-advance article: https://www.savings.com.au/budgeting-finance-tips/wage-advance-apps-the-good-the-bad-and-the-ugly
- Finder, non-bank personal lenders: https://finder.com.au/personal-loans/non-bank-lenders
- Savings.com.au, personal loan lenders: https://www.savings.com.au/personal-loans/lenders/

## Scope rule
- **Banks:** the top 10 by total residents' assets plus the top 10 customer-owned banks by assets (savings.com.au, APRA data).
- **Bank sub-brands:** St.George, Bank of Melbourne, BankSA, Bankwest and Virgin Money, because CreditCardCompare lists each as a separate card issuer.
- **Card issuers:** American Express, Coles and Latitude Financial Services, the major stand-alone non-bank issuers on CreditCardCompare.
- **BNPL:** all six providers in ASIC 20-280MR.
- **SACC:** the three lenders named in the Senate report, plus the other lenders on the Cash Converters comparison page.
- **Wage advance:** every provider in the savings.com.au article. CommBank AdvancePay is folded into CBA.
- **Personal and car loans:**
  - The non-bank lenders in Finder's table and Lenders section. I left out banks, Revolut, broker Driva, EBP Money, Alex and Fox Symes, so that list was not applied in full.
  - SocietyOne and Firstmac/loans.com.au from savings.com.au.

Result: 59 lenders. Newcastle Permanent and Greater Bank are two records.

## What was left out (full detail in `excluded`)
- **Lender excluded:** Openpay (defunct, in receivership since Feb 2023).
- **Aliases dropped for lack of a usable source (12):**
  - WBC
  - ST GEORGE (without the dot)
  - VIRGIN MONEY (AUSTRALIA) PTY LIMITED
  - COLES FINANCIAL SERVICES
  - LATITUDEPAY
  - HUMM90
  - MyPayFast's legal entity
  - MoneyPlace's two legal entities
  - RATESETTER
  - Wagetap's licensee names
  - NAB's legal name as issuer of the Virgin Money cards
- **Aliases dropped by policy (5), recorded in notes:**
  - NAB as issuer of the Coles cards
  - Coles Supermarkets Australia Pty Ltd
  - Citigroup Pty Limited
  - Ferratum Australia Pty Ltd
  - Firstmac service names
- **BPAY codes dropped (8):** third-party, snippet-only, unverifiable or business-only codes, including Coles code 8862.
- **Families dropped:** families with no cited product page (BOQ loan, Macquarie loan, IMB credit card, Bankwest and Virgin Money loan) and CommBank StepPay.

## Caveats
- Amex's own pages did not load. Its legal name, the AMEX abbreviation and its BPAY codes come from search-indexed Amex PDFs and from ASIC 22-352MR. The two codes (5082 and 88013) differ.
- A few family sources are site-navigation links rather than pages that were fetched. The lender notes say which.
- Generic or ambiguous aliases are flagged in the notes:
  - COLES and CASH CONVERTERS are also retail store brands.
  - IMB is short and can match inside other text.
  - EARNED WAGE ACCESS and EWA (Employment Hero) are industry terms.
  - BANK AUSTRALIA is part of other banks' names.
- Shared aliases are all legal names of divisions or brands of one entity: Westpac with St.George, Bank of Melbourne and BankSA; CBA with Bankwest; BOQ with Virgin Money; Newcastle Permanent with Greater Bank.

## Independence statement
I did not open, list, search or read anything under C:\Users\tolos\Projects\ or any local repository or dataset. All four research forks reported the same. Everything here comes from public web sources, plus the files written to this output folder and the scratchpad scripts that produced them.
