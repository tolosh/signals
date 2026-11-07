// Mock of the S3 presigned PUT for workspace logos (SIG-11; contract 1.2.0). The mock signs
// each upload for its type, size and expiry, refuses a PUT that differs (as S3 does), and keeps
// uploads in memory. Synthetic use only: nothing is written to disk, and state lasts as long as
// the process (a warm Lambda container, or the local server).
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml"] as const;
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const UPLOAD_TTL_MS = 10 * 60 * 1000;
export const UPLOAD_PREFIX = "/mock-uploads/";
export const LOGO_PREFIX = "/mock-logos/";

type Signed = { type: string; size: number; expires: number };
type Stored = { type: string; bytes: Buffer };

const secret = randomBytes(32);
const signed = new Map<string, Signed>();
const stored = new Map<string, Stored>();

/** A 1x1 transparent PNG: what the mock serves for an SVG, standing in for the re-render. */
const RENDERED_SVG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
  "base64",
);

const signature = (key: string, s: Signed) =>
  createHmac("sha256", secret).update(`${key}\n${s.type}\n${s.size}\n${s.expires}`).digest("hex");

export function issueUpload(
  workspaceId: string,
  type: string,
  size: number,
  origin: string,
  now: number,
) {
  const key = `${workspaceId}/logo/${randomUUID()}`;
  const s = { type, size, expires: now + UPLOAD_TTL_MS };
  signed.set(key, s);
  const query = `X-Amz-Expires=600&expires=${s.expires}&sig=${signature(key, s)}`;
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
  const expected = Buffer.from(signature(key, s), "utf8");
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
