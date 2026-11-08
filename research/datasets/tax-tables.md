# Synthetic set v2: the generator's tax tables (SIG-54)

Set v2 takes gross income as the input and computes net forward, through the ATO resident tax
schedule and the Medicare levy (SIG-46 ruling, 7 November 2026). The code is
`src/research/generator/tax.ts`. It imports nothing from `src/engines/`, and nothing there imports
it, so SIG-46's T2 tests the gross-up method rather than the generator
(`test/research/v2/tax.test.ts`). The Confluence pages remain the source of truth for the method;
this file records the table and the choices made where the ticket could not be followed as written.

## Source, checked 8 November 2026

- **Resident rates:** <https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents>
  (page updated 13 August 2026). For 2026-27: nil to $18,200; 15c per dollar to $45,000; $4,020
  plus 30c to $135,000; $31,020 plus 37c to $190,000; $51,370 plus 45c above. The page says these
  rates exclude the Medicare levy of 2%.
- **Medicare levy reduction for low-income earners:**
  <https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-for-low-income-earners>
  (page updated 30 June 2026). It gives 2025-26 single thresholds only: $28,011 lower and $35,013
  upper, without SAPTO. Its worked example: Angie, taxable income $29,000, levy reduced to $98.90.

ato.gov.au refuses automated fetches, so the pages were read in a browser and transcribed. The
table records the URLs, each page's update date and the date checked.

## Interpretations, for ruling

| ID  | Question                         | The generator does                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X-1 | FY 2026-27 Medicare thresholds   | **Not published by the ATO yet.** 2025-26's ($28,011 / $35,013) are used, marked `thresholds_provisional`. They matter only for gross under $35,013, which no set v2 salaried applicant has (gross is drawn from $55,000 to $200,000).                                                                |
| X-2 | T4's "ATO worked examples"       | **The ATO publishes none for 2026-27 net from gross.** T4 checks instead: the ATO's "tax on this income" base at each 2026-27 threshold ($4,020, $31,020, $51,370), to the dollar; the ATO's Medicare example (Angie, $98.90) under 2025-26; and the 2025-26 table as the negative control. |
| X-3 | What "net" is                    | **Gross less the schedule's tax less the Medicare levy**, as the ticket words it. No deductions (so the $1,000 instant work-expense deduction from 2026-27 is not applied) and no offsets (so the low income tax offset is not applied). It is an annual figure divided evenly across pays, not PAYG withholding. |
| X-4 | Overtime and bonuses             | Given as **net** amounts on top of the regular pay. `gross_annual` is the base salary only, as an application states it.                                                                                                                                                                            |

A ruling that changes any of these changes only the table or this module; set v2 is then
regenerated, and its hash in the manifest changes with it.
