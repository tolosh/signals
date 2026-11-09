// SIG-61 rulings, 9 November 2026 (Colin, comment 40198), N-1 and N-2. openfeed's onward-disclosure
// terms apply: data disclosed to Signals is held under the Privacy Act 1988 and the APPs, and no
// CDR claim may appear anywhere a user sees (openfeed terms cl 3.1, 4.2, 4.4). Moroku owes an APP 5
// collection notice at the point of connection. This is a placeholder for legal to finalise: it
// covers every APP 5.2 matter, says the data is handled under the Privacy Act and not the CDR rules,
// and names the purpose, including the comparison with the person's declared figures (N-2).
import { describe, expect, it } from "vitest";
import { RETENTION_DAYS } from "../../../src/research/realdata/consent.js";
import {
  APP5_MATTERS,
  COLLECTION_NOTICE,
  DISCLOSURE_PURPOSE,
  findCdrClaims,
  noticePage,
} from "../../../src/research/realdata/notice.js";

const allText = () => Object.values(COLLECTION_NOTICE.sections).join("\n");

describe("the APP 5 collection notice (a placeholder for legal)", () => {
  it("is marked as a placeholder for legal to finalise, and the page says so", () => {
    expect(COLLECTION_NOTICE.status).toBe("placeholder: for legal to finalise");
    expect(COLLECTION_NOTICE.version).toMatch(/^0\./);
    expect(noticePage("/connect/start?invite=x&notice=0.1")).toMatch(/DRAFT/);
  });

  it("covers every APP 5.2 matter, each with text", () => {
    expect(APP5_MATTERS).toEqual([
      "identity_and_contact", // 5.2(a)
      "how_collected", // 5.2(b): from openfeed, not from the person directly
      "required_by_law", // 5.2(c)
      "purposes", // 5.2(d)
      "consequences_if_not_collected", // 5.2(e)
      "usual_disclosures", // 5.2(f)
      "access_and_correction", // 5.2(g), with the privacy policy
      "complaints", // 5.2(h)
      "overseas_disclosure", // 5.2(i) and (j)
    ]);
    expect(Object.keys(COLLECTION_NOTICE.sections)).toEqual(APP5_MATTERS);
    for (const m of APP5_MATTERS)
      expect(COLLECTION_NOTICE.sections[m].length, m).toBeGreaterThan(20);
  });

  it("says the data is handled under the Privacy Act, not the CDR rules (cl 4.4)", () => {
    expect(allText()).toMatch(/Privacy Act 1988/);
    expect(allText()).toMatch(/not under the Consumer Data Right rules/);
  });

  it("names the comparison with the person's declared figures in the purpose (N-2)", () => {
    expect(DISCLOSURE_PURPOSE.text).toMatch(/compar/i);
    expect(DISCLOSURE_PURPOSE.text).toMatch(/payslip/i);
    expect(DISCLOSURE_PURPOSE.version).toBe("1");
    expect(COLLECTION_NOTICE.sections.purposes).toContain(DISCLOSURE_PURPOSE.text);
  });

  it("says nothing is kept for research, and when the data is deleted", () => {
    expect(COLLECTION_NOTICE.sections.purposes).toMatch(/not kept for research/);
    expect(allText()).toContain(`${RETENTION_DAYS} days`);
  });

  it("makes no CDR claim, in the notice or on the page", () => {
    expect(findCdrClaims(allText())).toEqual([]);
    expect(findCdrClaims(noticePage("/connect/start?invite=x&notice=0.1"))).toEqual([]);
  });

  it("links on to openfeed only through the continue link it is given, escaped", () => {
    const page = noticePage('/connect/start?invite=a&notice=0.1"><script>');
    expect(page).not.toContain("<script>");
    expect(page).toContain("&quot;&gt;&lt;script&gt;");
  });
});

describe("findCdrClaims: the claims no user-facing text may make", () => {
  it.each([
    "Moroku is an accredited data recipient",
    "Signals is a sponsored affiliate of openfeed",
    "your data is collected under the CDR",
    "Moroku is accredited under the Consumer Data Right",
    "We act as a CDR representative",
    "our CDR accreditation number",
  ])("catches %j", (text) => {
    expect(findCdrClaims(text)).not.toEqual([]);
  });

  it.each([
    "consented open banking data received through openfeed",
    "handled under the Privacy Act 1988, not under the Consumer Data Right rules",
    "Connect the accounts through open banking",
  ])("lets through %j", (text) => {
    expect(findCdrClaims(text)).toEqual([]);
  });
});
