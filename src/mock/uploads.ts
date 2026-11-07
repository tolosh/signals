// Mock of the S3 presigned PUT for workspace logos (SIG-11; contract 1.2.0). The mock signs
// each upload for its type, size and expiry, refuses a PUT that differs (as S3 does), and keeps
// uploads in memory. Synthetic use only: nothing is written to disk. SIG-51: both maps are state
// slices, kept in the mock's table, so a PUT or a served logo works on any Lambda container. The
// signature is stored with what was signed, so any container can check it.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { registerSlice } from "./state.js";

export const LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml"] as const;
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const UPLOAD_TTL_MS = 10 * 60 * 1000;
export const UPLOAD_PREFIX = "/mock-uploads/";
export const LOGO_PREFIX = "/mock-logos/";

type Signed = { type: string; size: number; expires: number; sig: string };
type Stored = { type: string; bytes: Buffer };

const secret = randomBytes(32);
const signed = new Map<string, Signed>();
const stored = new Map<string, Stored>();

/** A 1x1 transparent PNG: what the mock serves for an SVG, standing in for the re-render. */
const RENDERED_SVG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
  "base64",
);

const signature = (key: string, s: Omit<Signed, "sig">) =>
  createHmac("sha256", secret).update(`${key}\n${s.type}\n${s.size}\n${s.expires}`).digest("hex");

export function issueUpload(
  workspaceId: string,
  type: string,
  size: number,
  origin: string,
  now: number,
) {
  const key = `${workspaceId}/logo/${randomUUID()}`;
  const unsigned = { type, size, expires: now + UPLOAD_TTL_MS };
  const s = { ...unsigned, sig: signature(key, unsigned) };
  signed.set(key, s);
  const query = `X-Amz-Expires=600&expires=${s.expires}&sig=${s.sig}`;
  return {
    upload_url: `${origin}${UPLOAD_PREFIX}${key}?${query}`,
    method: "PUT" as const,
    headers: { "Content-Type": type },
    expires_at: new Date(s.expires).toISOString(),
    logo_key: key,
  };
}

/** The PUT to the upload URL: 200 when it matches what was signed, otherwise 403. */
export function acceptUpload(
  key: string,
  query: URLSearchParams,
  contentType: string | undefined,
  bytes: Buffer,
  now: number,
): number {
  const s = signed.get(key);
  if (!s) return 403;
  const given = Buffer.from(query.get("sig") ?? "", "utf8");
  const expected = Buffer.from(s.sig, "utf8");
  const sigOk = given.length === expected.length && timingSafeEqual(given, expected);
  if (!sigOk || now > s.expires || contentType !== s.type || bytes.length !== s.size) return 403;
  stored.set(key, { type: s.type, bytes });
  return 200;
}

export const isUploaded = (key: string) => stored.has(key);

/** What the logo URL serves. SVG is never served as SVG. */
export function servedLogo(key: string): { type: string; bytes: Buffer } | undefined {
  const s = stored.get(key);
  if (!s) return undefined;
  return s.type === "image/svg+xml" ? { type: "image/png", bytes: RENDERED_SVG } : s;
}

registerSlice({
  type: "upload_signed",
  reset: () => signed.clear(),
  snapshot: () => Object.fromEntries(signed),
  restore: (items) => {
    for (const [key, value] of Object.entries(items)) signed.set(key, value as Signed);
  },
});
registerSlice({
  type: "upload",
  reset: () => stored.clear(),
  snapshot: () =>
    Object.fromEntries(
      [...stored].map(([key, v]) => [key, { type: v.type, bytes: v.bytes.toString("base64") }]),
    ),
  restore: (items) => {
    for (const [key, value] of Object.entries(items)) {
      const v = value as { type: string; bytes: string };
      stored.set(key, { type: v.type, bytes: Buffer.from(v.bytes, "base64") });
    }
  },
});
