// SIG-61: sealing secrets held in the secure store (the person's openfeed refresh token). In the
// secure environment the sealer is KMS, with the customer-managed key and the consumer reference as
// encryption context, so a sealed token can only be opened for the person it belongs to and every
// opening is in the KMS log. The AES-GCM sealer is for local runs and tests only.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DecryptCommand, EncryptCommand } from "@aws-sdk/client-kms";
import { assertConsumerRef } from "./stores.js";

export interface Sealer {
  seal(plaintext: string, consumerRef: string): Promise<string>;
  unseal(sealed: string, consumerRef: string): Promise<string>;
}

export function aesSealer(key: Buffer): Sealer {
  if (key.length !== 32) throw new Error("The AES sealer needs a 32-byte key");
  return {
    async seal(plaintext, consumerRef) {
      assertConsumerRef(consumerRef);
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      c.setAAD(Buffer.from(consumerRef));
      const body = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
    },
    async unseal(sealed, consumerRef) {
      assertConsumerRef(consumerRef);
      const raw = Buffer.from(sealed, "base64");
      const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
      d.setAAD(Buffer.from(consumerRef));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
    },
  };
}

export function kmsSealer(keyId: string, send: (command: unknown) => Promise<unknown>): Sealer {
  const context = (consumerRef: string) => {
    assertConsumerRef(consumerRef);
    return { consumer_ref: consumerRef, purpose: "openfeed-refresh-token" };
  };
  return {
    async seal(plaintext, consumerRef) {
      const out = (await send(
        new EncryptCommand({
          KeyId: keyId,
          Plaintext: Buffer.from(plaintext, "utf8"),
          EncryptionContext: context(consumerRef),
        }),
      )) as { CiphertextBlob?: Uint8Array };
      if (!out.CiphertextBlob) throw new Error("KMS returned no ciphertext");
      return Buffer.from(out.CiphertextBlob).toString("base64");
    },
    async unseal(sealed, consumerRef) {
      const out = (await send(
        new DecryptCommand({
          KeyId: keyId,
          CiphertextBlob: Buffer.from(sealed, "base64"),
          EncryptionContext: context(consumerRef),
        }),
      )) as { Plaintext?: Uint8Array };
      if (!out.Plaintext) throw new Error("KMS returned no plaintext");
      return Buffer.from(out.Plaintext).toString("utf8");
    },
  };
}
