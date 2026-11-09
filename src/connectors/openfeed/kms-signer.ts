// SIG-61 stub (tests first).
import type { Signer } from "./jose.js";
export function kmsSigner(_keyId: string, _send: (cmd: unknown) => Promise<unknown>): Signer {
  return { sign: async () => new Uint8Array(), publicJwk: async () => ({}) };
}
