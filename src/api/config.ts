// SIG-82 (D59; sections 4 and 5): the demo stage's runtime configuration. The Enrich path is forced
// to local (D58; T3): any other value, or none, refuses to start, and ApiEnrich can't be built
// here. No configuration value may name an Enrich host (T2). The Supabase project URL and
// publishable key are public values (40779), so they are plain configuration, not secrets.

/** The Lovable origins allowed to call the API (40782; the editor's preview origin, 40835). Exact
 * matches only. */
export const DEMO_ORIGINS: readonly string[] = Object.freeze([
  "https://signals-launchpad.moroku.digital",
  "https://moroku-signals.lovable.app",
  "https://id-preview--7bb65be2-4f2d-46a9-97ef-1039aace98ee.lovable.app",
  "https://7bb65be2-4f2d-46a9-97ef-1039aace98ee.lovableproject.com",
]);
/** The demo's own front-end origin, used when a request names no allowed origin. */
export const DEFAULT_ORIGIN = "https://signals-launchpad.moroku.digital";

const ENRICH_HOST = /enrich[-_.a-z0-9]*\.moroku\.digital/i;

/** Throws if a configuration value names an Enrich host. */
export function refuseEnrichHost(name: string, value: string | null | undefined): void {
  if (value && ENRICH_HOST.test(value))
    throw new Error(`${name} names an Enrich host; the demo stage never references Enrich`);
}

export type WorkspaceKey = "A" | "B";
export type DemoConfig = {
  stage: "demo";
  enrichPath: "local";
  commit: string;
  supabaseUrl: string | null;
  supabasePublishableKey: string | null;
  /** HS256 tokens go to /auth/v1/user (40820, 2): on until Lovable's ES256 switch is confirmed. */
  hs256Fallback: boolean;
  /** Demo members by lower-case email or Supabase user id. */
  members: Readonly<Record<string, WorkspaceKey>>;
};

/** "a@x.test:A, b@y.test:B" → { "a@x.test": "A", "b@y.test": "B" }. */
export function parseMembers(text: string | undefined): Record<string, WorkspaceKey> {
  const out: Record<string, WorkspaceKey> = {};
  for (const part of (text ?? "").split(",")) {
    const entry = part.trim();
    if (!entry) continue;
    const at = entry.lastIndexOf(":");
    const who = entry.slice(0, at).trim().toLowerCase();
    const ws = entry
      .slice(at + 1)
      .trim()
      .toUpperCase();
    if (at <= 0 || !who || (ws !== "A" && ws !== "B"))
      throw new Error("DEMO_MEMBERS entries are <email or user id>:A or :B, comma-separated");
    out[who] = ws;
  }
  return out;
}

export function demoConfigFrom(env: Readonly<Record<string, string | undefined>>): DemoConfig {
  if (env.ENRICH_PATH !== "local")
    throw new Error(
      "The demo stage's Enrich path is forced to local (D58); ENRICH_PATH must be local",
    );
  for (const [k, v] of Object.entries(env))
    if (k.startsWith("SUPABASE_") || k.startsWith("DEMO_") || k === "ENRICH_PATH")
      refuseEnrichHost(k, v);
  const supabaseUrl = env.SUPABASE_URL?.replace(/\/+$/, "") || null;
  if (supabaseUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl))
    throw new Error("SUPABASE_URL must be the project's https://<ref>.supabase.co URL");
  const fallback = env.SUPABASE_HS256_FALLBACK;
  if (fallback !== undefined && fallback !== "on" && fallback !== "off")
    throw new Error("SUPABASE_HS256_FALLBACK must be on or off (40820, 2)");
  return {
    stage: "demo",
    enrichPath: "local",
    commit: env.DEMO_COMMIT ?? "unknown",
    supabaseUrl,
    supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY || null,
    hs256Fallback: fallback === "on",
    members: Object.freeze(parseMembers(env.DEMO_MEMBERS)),
  };
}

/** SIG-82 T3: ApiEnrich is never constructed in the demo stage. */
export function apiEnrichInDemo(): never {
  throw new Error(
    "The demo stage's Enrich path is forced to local (D58): ApiEnrich is never built here",
  );
}
