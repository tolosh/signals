// SIG-82 (40782): the labelled sandbox-consent page. It stands in for the bank's consent screen on
// the demo stage, over HTTPS on the API's own host. The applicant picks one of SIG-76's seeded
// scenarios; the page then returns to the portal's /connect/:token/progress. Synthetic data only:
// no bank, no credentials, nothing real is asked for or shared.
import { SANDBOX_SCENARIOS } from "./seed.js";

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

const shell = (body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Sandbox consent (demo)</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:32px auto;padding:0 16px;color:#1d2433;background:#fff}
.label{display:inline-block;background:#fff4d6;color:#6b4e00;border:1px solid #e8c766;border-radius:4px;padding:2px 8px;font-size:13px;font-weight:600}
fieldset{border:1px solid #d5d9e0;border-radius:8px;padding:12px 16px;margin:16px 0}
label{display:block;padding:8px 0;cursor:pointer}
button{background:#1d4ed8;color:#fff;border:0;border-radius:6px;padding:10px 18px;font-size:16px;cursor:pointer}
.problem{color:#b42318}
small{color:#5b6475}
</style></head><body>${body}</body></html>`;

export function consentPage(
  o: { kind: "unknown" } | { kind: "choose"; lender: string; token: string; problem?: string },
): string {
  if (o.kind === "unknown")
    return shell(
      `<p class="label">Sandbox: synthetic data only</p><h1>This link isn't active</h1><p>Ask the lender for a new link.</p>`,
    );
  const options = SANDBOX_SCENARIOS.map(
    (s, i) =>
      `<label><input type="radio" name="scenario" value="${s.key}"${i === 0 ? " required" : ""}> <strong>Scenario ${s.key}</strong>: ${esc(s.story)}</label>`,
  ).join("\n");
  return shell(`<p class="label">Sandbox consent: synthetic data only</p>
<h1>Share sandbox bank data with ${esc(o.lender)}</h1>
<p>This page stands in for your bank's consent screen on the Moroku Signals demo stage. No bank is contacted and nothing real is shared. Choose which seeded, synthetic applicant's data to share.</p>
${o.problem ? `<p class="problem">${esc(o.problem)}</p>` : ""}
<form method="post" action="/demo/consent/${esc(o.token)}">
<fieldset><legend>Synthetic scenario (SIG-76, set v2.3)</legend>
${options}
</fieldset>
<button type="submit">Share sandbox data</button>
</form>
<p><small>Demo stage. The figures in the assessment come from the real Signals engines, run on this synthetic data.</small></p>`);
}
