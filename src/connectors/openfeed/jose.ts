// SIG-61: the JWTs openfeed needs, signed PS256 (openfeed's docs: the app keypair is PS256/RSA).
// - the private_key_jwt client assertion (RFC 7523): iss = sub = the client ID, aud = the issuer,
//   a fresh jti, exp 60 seconds after iat;
// - the DPoP proof (RFC 9449): typ dpop+jwt, the public JWK in the header, htm, htu, iat, jti,
//   the server's nonce when it asks for one, and ath on calls that carry an access token.
// The signer is an interface. In the secure environment it is KMS (kms-signer.ts), so the private
// keys never leave KMS (CLAUDE.md); locally and in tests it is a node key.
import { createHash, createPublicKey, sign, type KeyObject } from "node:crypto";

/** An RSA public key as a JWK: kty, n and e only. */
export type PublicJwk = { kty: string; n: string; e: string };

export interface Signer {
  /** Signs with RSASSA-PSS, SHA-256, salt length 32 (JWS PS256). */
  sign(data: Uint8Array): Promise<Uint8Array>;
  publicJwk(): Promise<PublicJwk>;
}

/** The RSA public JWK of a node key. */
export function rsaJwk(key: KeyObject): PublicJwk {
  const j = (key.type === "public" ? key : createPublicKey(key)).export({ format: "jwk" });
  if (j.kty !== "RSA" || !j.n || !j.e) throw new Error("Not an RSA key");
  return { kty: j.kty, n: j.n, e: j.e };
}

const PSS = { padding: 6 /* RSA_PKCS1_PSS_PADDING */, saltLength: 32 } as const;

export function localSigner(privateKey: KeyObject): Signer {
  const jwk = rsaJwk(privateKey);
  return {
    sign: async (data) => new Uint8Array(sign("sha256", data, { key: privateKey, ...PSS })),
    publicJwk: async () => jwk,
  };
}

export const b64url = (b: Uint8Array | string): string => Buffer.from(b).toString("base64url");

export async function signJwt(
  signer: Signer,
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<string> {
  const head = b64url(JSON.stringify({ alg: "PS256", ...header }));
  const input = `${head}.${b64url(JSON.stringify(payload))}`;
  return `${input}.${b64url(await signer.sign(Buffer.from(input)))}`;
}

export function clientAssertion(
  signer: Signer,
  o: { clientId: string; issuer: string; now: number; jti: string },
): Promise<string> {
  return signJwt(
    signer,
    { typ: "JWT" },
    { iss: o.clientId, sub: o.clientId, aud: o.issuer, jti: o.jti, iat: o.now, exp: o.now + 60 },
  );
}

export async function dpopProof(
  signer: Signer,
  o: {
    method: string;
    url: string;
    now: number;
    jti: string;
    nonce?: string;
    accessToken?: string;
  },
): Promise<string> {
  const u = new URL(o.url);
  const htu = `${u.origin}${u.pathname}`;
  return signJwt(
    signer,
    { typ: "dpop+jwt", jwk: await signer.publicJwk() },
    {
      htm: o.method,
      htu,
      iat: o.now,
      jti: o.jti,
      ...(o.nonce ? { nonce: o.nonce } : {}),
      ...(o.accessToken !== undefined
        ? { ath: createHash("sha256").update(o.accessToken).digest("base64url") }
        : {}),
    },
  );
}
