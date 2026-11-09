// SIG-61 stub (tests first).
import type { KeyObject } from "node:crypto";
export interface Signer {
  sign(data: Uint8Array): Promise<Uint8Array>;
  publicJwk(): Promise<JsonWebKey>;
}
export function localSigner(_key: KeyObject): Signer {
  return { sign: async () => new Uint8Array(), publicJwk: async () => ({}) };
}
