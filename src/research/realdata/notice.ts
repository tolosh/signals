// SIG-61 rulings, 9 November 2026 (Colin, comment 40198).
//
// N-1: openfeed's onward-disclosure terms apply. Data disclosed to Signals ceases to be CDR data
// and is held under the Privacy Act 1988 and the APPs (openfeed terms cl 3.1, 4.2). Users must be
// told so (cl 4.4), and nothing Moroku shows may say or imply that Moroku is accredited or acting
// under the CDR (cl 4.4(a)). Moroku owes an APP 5 collection notice at the point of connection.
//
// N-2: the disclosure purpose registered with openfeed must name the comparison with the person's
// declared figures (cl 4.1 limits use to that purpose).
//
// THE NOTICE BELOW IS A PLACEHOLDER FOR LEGAL TO FINALISE. It covers each APP 5.2 matter with the
// facts as built; the wording, Moroku's contact details and the privacy policy link are legal's.
// Its version starts at 0.x while it is a placeholder; legal's text becomes 1.0. The connect flow
// shows it before openfeed and records the version shown with the consent (connect.ts).
import { RETENTION_DAYS } from "./consent.js";

/** The APP 5.2 matters, in the order of APP 5.2(a) to (j). */
export const APP5_MATTERS = [
  "identity_and_contact",
  "how_collected",
  "required_by_law",
  "purposes",
  "consequences_if_not_collected",
  "usual_disclosures",
  "access_and_correction",
  "complaints",
  "overseas_disclosure",
] as const;
export type App5Matter = (typeof APP5_MATTERS)[number];

/**
 * The purpose to register with openfeed as the disclosure purpose (N-2), versioned. Colin registers
 * it; this is the text the connect flow and the consent record refer to.
 */
export const DISCLOSURE_PURPOSE = Object.freeze({
  version: "1",
  text:
    "To test Moroku Signals on your own accounts: Signals assesses your transaction data, and " +
    "compares what it finds with the figures you declare to us (your payslip's gross and net pay, " +
    "your employer, and your loans, cards and buy now pay later accounts), to check how accurate " +
    "Signals is.",
});

export const COLLECTION_NOTICE: {
  readonly version: string;
  readonly status: "placeholder: for legal to finalise";
  readonly sections: Readonly<Record<App5Matter, string>>;
} = Object.freeze({
  version: "0.1",
  status: "placeholder: for legal to finalise",
  sections: Object.freeze({
    identity_and_contact:
      "Moroku Pty Ltd [legal to confirm entity name and ABN] collects this information. " +
      "Contact: [privacy contact email and address, legal to supply].",
    how_collected:
      "We receive your bank transaction and account data from openfeed, after you agree on " +
      "openfeed's screen to share it with us. Once openfeed passes it to Moroku, your data is " +
      "handled under the Privacy Act 1988 and the Australian Privacy Principles, not under the " +
      "Consumer Data Right rules. You give us your declared figures yourself, on a form.",
    required_by_law: "No Australian law requires us to collect this information.",
    purposes:
      `${DISCLOSURE_PURPOSE.text} We use it only for that. It is not kept for research, ` +
      "not de-identified for other uses, and not used to make any decision about you. We delete " +
      `it when the comparison is done, and in any case within ${RETENTION_DAYS} days of your ` +
      "connecting. If you stop sharing on openfeed's dashboard, we delete it within 24 hours.",
    consequences_if_not_collected:
      "Taking part is voluntary. If you don't share your data or declare your figures, you " +
      "can't take part in this test, and nothing else changes for you.",
    usual_disclosures:
      "We don't disclose your information to anyone else. It is stored encrypted on Amazon Web " +
      "Services in Sydney, which hosts it for us. Only counts and rates leave the secure store, " +
      "never your details.",
    access_and_correction:
      "Our privacy policy [link, legal to supply] explains how to ask to see or correct the " +
      "information we hold about you, and how to ask us to delete it sooner.",
    complaints:
      "Our privacy policy also explains how to complain about a breach of the Australian Privacy " +
      "Principles and how we will deal with it. You can also complain to the Office of the " +
      "Australian Information Commissioner.",
    overseas_disclosure:
      "We don't send your information overseas. It stays in Australia (AWS Sydney).",
  }),
});

/** Claims no user-facing text may make (openfeed terms cl 4.4(a); ruling N-1). */
const CLAIMS: [string, RegExp][] = [
  ["accredited", /\baccredit(ed|ation)\b/i],
  ["sponsored", /\bsponsor(ed|ship)?\b/i],
  ["under the CDR", /\bunder the (CDR|Consumer Data Right)\b(?! rules)/i],
  ["CDR participant", /\bCDR (representative|participant|affiliate|recipient)\b/i],
];

/** The kinds of CDR claim found in a text, by name (never the text itself). */
export function findCdrClaims(text: string): string[] {
  return CLAIMS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const HEADINGS: Record<App5Matter, string> = {
  identity_and_contact: "Who we are",
  how_collected: "How we get your information",
  required_by_law: "Whether the law requires it",
  purposes: "Why we collect it",
  consequences_if_not_collected: "If you don't take part",
  usual_disclosures: "Who else sees it",
  access_and_correction: "Seeing and correcting it",
  complaints: "Complaints",
  overseas_disclosure: "Overseas",
};

/** The notice as a page, with a link on to openfeed. */
export function noticePage(continueHref: string): string {
  const sections = APP5_MATTERS.map(
    (m) => `<h2>${escape(HEADINGS[m])}</h2>\n<p>${escape(COLLECTION_NOTICE.sections[m])}</p>`,
  ).join("\n");
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Before you connect</title></head><body>",
    `<p><strong>DRAFT notice ${escape(COLLECTION_NOTICE.version)}: ${escape(COLLECTION_NOTICE.status)}.</strong></p>`,
    "<h1>Before you connect your accounts</h1>",
    sections,
    `<p><a href="${escape(continueHref)}">I've read this. Continue to openfeed</a></p>`,
    "</body></html>",
  ].join("\n");
}
