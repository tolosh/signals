// SIG-61: a PS256 signer whose private key stays in KMS (CLAUDE.md: openfeed signing keys never
// leave KMS). The keys are RSA_3072 SIGN_VERIFY keys in the secure environment
// (infra/realdata-stack.ts): one for the client assertion, whose public half is registered with
// openfeed, and one for DPoP proofs. KMS hashes the message itself (MessageType RAW,
// RSASSA_PSS_SHA_256).
import { createPublicKey } from "node:crypto";
import { GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";
import { rsaJwk, type PublicJwk, type Signer } from "./jose.js";

export type KmsSend = (command: unknown) => Promise<unknown>;

export function kmsSigner(keyId: string, send: KmsSend): Signer {
  let jwk: Promise<PublicJwk> | null = null;
  return {
    async sign(data) {
      const out = (await send(
        new SignCommand({
          KeyId: keyId,
          Message: data,
          MessageType: "RAW",
          SigningAlgorithm: "RSASSA_PSS_SHA_256",
        }),
      )) as { Signature?: Uint8Array };
      if (!out.Signature) throw new Error("KMS returned no signature");
      return out.Signature;
    },
    publicJwk(): Promise<PublicJwk> {
      jwk ??= (async () => {
        const out = (await send(new GetPublicKeyCommand({ KeyId: keyId }))) as {
          PublicKey?: Uint8Array;
        };
        if (!out.PublicKey) throw new Error("KMS returned no public key");
        return rsaJwk(
          createPublicKey({ key: Buffer.from(out.PublicKey), format: "der", type: "spki" }),
        );
      })();
      return jwk;
    },
  };
}
