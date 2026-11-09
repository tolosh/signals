// SIG-61 stub (tests first).
export interface Sealer {
  seal(p: string, ref: string): Promise<string>;
  unseal(s: string, ref: string): Promise<string>;
}
export const aesSealer = (_k: Buffer): Sealer => ({ seal: async (p) => p, unseal: async (s) => s });
export const kmsSealer = (_k: string, _send: (c: unknown) => Promise<unknown>): Sealer =>
  aesSealer(Buffer.alloc(0));
