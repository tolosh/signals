// SIG-61: the secure store's production implementations (ADR 0008, sections 2 and 6): S3 with
// SSE-KMS, one bucket per store, every write naming the store's key; the KMS signer keeps openfeed's
// signing keys inside KMS (CLAUDE.md); the KMS sealer seals refresh tokens with the consumer
// reference as encryption context. Tested against in-memory fakes of the AWS calls.
// (Corrected before push: the first version used DynamoDB, which ADR 0008 rules out for real data
// and ADR 0005 keeps for the mock.)
import { createPublicKey, generateKeyPairSync, sign as nodeSign, verify } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  DecryptCommand,
  EncryptCommand,
  GetPublicKeyCommand,
  SignCommand,
} from "@aws-sdk/client-kms";
import { describe, expect, it } from "vitest";
import { kmsSigner } from "../../../src/connectors/openfeed/kms-signer.js";
import { deleteConsumer } from "../../../src/research/realdata/deletion.js";
import {
  S3PendingConnects,
  S3RevocationState,
  S3Store,
} from "../../../src/research/realdata/s3-store.js";
import { aesSealer, kmsSealer } from "../../../src/research/realdata/sealer.js";
import { FileStore, MemoryStore, STORES } from "../../../src/research/realdata/stores.js";

const A = "cr_0000000000000000aaaa";
const B = "cr_0000000000000000bbbb";
const KEY = "arn:aws:kms:ap-southeast-2:111111111111:key/data";

/** Buckets in memory answering the four calls the stores make; lists page by 2. */
function fakeS3() {
  const buckets = new Map<string, Map<string, string>>();
  const bucket = (b: string) => {
    if (!buckets.has(b)) buckets.set(b, new Map());
    return buckets.get(b) as Map<string, string>;
  };
  const send = async (cmd: unknown): Promise<unknown> => {
    const input = (cmd as { input: Record<string, unknown> }).input;
    const b = bucket(String(input.Bucket));
    if (cmd instanceof PutObjectCommand) {
      if (input.ServerSideEncryption !== "aws:kms" || input.SSEKMSKeyId !== KEY)
        throw Object.assign(new Error("AccessDenied"), { name: "AccessDenied" });
      b.set(String(input.Key), String(input.Body));
      return {};
    }
    if (cmd instanceof GetObjectCommand) {
      const v = b.get(String(input.Key));
      if (v === undefined) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
      return { Body: { transformToString: async () => v } };
    }
    if (cmd instanceof DeleteObjectCommand) {
      b.delete(String(input.Key));
      return {};
    }
    if (cmd instanceof ListObjectsV2Command) {
      const prefix = String(input.Prefix ?? "");
      const keys = [...b.keys()].filter((k) => k.startsWith(prefix)).sort();
      const rows: { key?: string; prefix?: string }[] = input.Delimiter
        ? [...new Set(keys.map((k) => k.slice(prefix.length).split("/")[0] ?? ""))].map((x) => ({
            prefix: `${prefix}${x}/`,
          }))
        : keys.map((k) => ({ key: k }));
      const start = Number(input.ContinuationToken ?? 0);
      const page = rows.slice(start, start + 2);
      return {
        Contents: page.filter((r) => r.key).map((r) => ({ Key: r.key })),
        CommonPrefixes: page.filter((r) => r.prefix).map((r) => ({ Prefix: r.prefix })),
        IsTruncated: start + 2 < rows.length,
        NextContinuationToken: String(start + 2),
      };
    }
    throw new Error("unexpected command");
  };
  return { send, bucket };
}

describe("the secure store: the openfeed grant link is a store too", () => {
  it("covers openfeed_grants, so a deletion removes the grant link and its sealed token", () => {
    expect(STORES).toContain("openfeed_grants");
  });

  it.each(["memory", "filesystem"] as const)(
    "%s stores list the people they hold",
    async (kind) => {
      const root = mkdtempSync(join(tmpdir(), "sig61-list-"));
      const s =
        kind === "memory"
          ? new MemoryStore("openfeed_grants")
          : new FileStore("openfeed_grants", root);
      await s.put(A, "grant", { x: 1 });
      await s.put(B, "grant", { x: 2 });
      expect((await s.listConsumers()).sort()).toEqual([A, B]);
      await s.deleteConsumer(A);
      expect(await s.listConsumers()).toEqual([B]);
    },
  );
});

describe("S3Store", () => {
  const at = { bucket: "raw", kmsKeyId: KEY };

  it("puts, gets (across pages), counts, lists and deletes one person's records", async () => {
    const s3 = fakeS3();
    const s = new S3Store("raw_grant_data", at, s3.send);
    for (const r of ["r1", "r2", "r3"]) await s.put(A, r, { r });
    await s.put(B, "r1", { r: "b" });
    expect(await s.get(A)).toEqual([{ r: "r1" }, { r: "r2" }, { r: "r3" }]);
    expect(await s.count(A)).toBe(3);
    expect(await s.listConsumers()).toEqual([A, B].sort());
    expect(await s.deleteConsumer(A)).toBe(3);
    expect(await s.count(A)).toBe(0);
    expect(await s.count(B)).toBe(1);
    expect(await s.listConsumers()).toEqual([B]);
    expect(await s.deleteConsumer(A)).toBe(0);
  });

  it("names the store's KMS key on every write (the bucket policy refuses others)", async () => {
    const s3 = fakeS3();
    const wrong = new S3Store("raw_grant_data", { bucket: "raw", kmsKeyId: "other" }, s3.send);
    await expect(wrong.put(A, "r1", {})).rejects.toThrow(/AccessDenied/);
  });

  it("never uses the reference itself as a key", async () => {
    const s3 = fakeS3();
    await new S3Store("raw_grant_data", at, s3.send).put(A, "r1", { n: 1 });
    for (const k of s3.bucket("raw").keys()) expect(k).not.toContain(A);
  });

  it("serves the deletion procedure over every store, one bucket each", async () => {
    const s3 = fakeS3();
    const stores = STORES.map((n) => new S3Store(n, { bucket: n, kmsKeyId: KEY }, s3.send));
    for (const s of stores) await s.put(A, "r1", { n: 1 });
    const receipt = await deleteConsumer(stores, A, "2026-11-10T00:00:00Z");
    expect(receipt).toMatchObject({ status: "complete", verified: true });
    for (const n of STORES) expect(s3.bucket(n).size).toBe(0);
  });

  it("holds the revocation queue and the last successful poll in the control bucket", async () => {
    const s3 = fakeS3();
    const st = new S3RevocationState({ bucket: "control", kmsKeyId: KEY }, s3.send);
    expect(await st.lastSuccess()).toBeNull();
    await st.setLastSuccess("2026-11-10T00:05:00.000Z");
    await st.enqueue(A, "2026-11-10T00:05:00.000Z");
    await st.enqueue(A, "2026-11-10T00:10:00.000Z"); // a second detection keeps the first time
    expect(await st.lastSuccess()).toBe("2026-11-10T00:05:00.000Z");
    expect(await st.pending()).toEqual([
      { consumer_ref: A, detected_at: "2026-11-10T00:05:00.000Z" },
    ]);
    await st.dequeue(A);
    expect(await st.pending()).toEqual([]);
  });

  it("keeps a connection in progress under a hash of its state, taken once", async () => {
    const s3 = fakeS3();
    const p = new S3PendingConnects({ bucket: "control", kmsKeyId: KEY }, s3.send);
    await p.put("state-1", {
      consumer_ref: A,
      code_verifier: "v",
      started_at: "2026-11-10T00:00:00Z",
      notice_version: "0.1",
    });
    for (const k of s3.bucket("control").keys()) expect(k).not.toContain("state-1");
    expect(await p.take("state-1")).toMatchObject({ consumer_ref: A, code_verifier: "v" });
    expect(await p.take("state-1")).toBeNull();
  });
});

describe("KMS signer and sealer", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const der = publicKey.export({ format: "der", type: "spki" });
  const kmsFake = async (cmd: unknown): Promise<unknown> => {
    const input = (cmd as { input: Record<string, unknown> }).input;
    if (cmd instanceof GetPublicKeyCommand) return { PublicKey: new Uint8Array(der) };
    if (cmd instanceof SignCommand) {
      expect(input).toMatchObject({
        KeyId: "alias/k",
        SigningAlgorithm: "RSASSA_PSS_SHA_256",
        MessageType: "RAW",
      });
      return {
        Signature: new Uint8Array(
          nodeSign("sha256", input.Message as Uint8Array, {
            key: privateKey,
            padding: 6,
            saltLength: 32,
          }),
        ),
      };
    }
    if (cmd instanceof EncryptCommand) {
      const ctx = JSON.stringify(input.EncryptionContext);
      return {
        CiphertextBlob: new Uint8Array(
          Buffer.from(`${ctx}|${Buffer.from(input.Plaintext as Uint8Array).toString("hex")}`),
        ),
      };
    }
    if (cmd instanceof DecryptCommand) {
      const [ctx, hex] = Buffer.from(input.CiphertextBlob as Uint8Array)
        .toString()
        .split("|");
      if (ctx !== JSON.stringify(input.EncryptionContext))
        throw new Error("InvalidCiphertextException");
      return { Plaintext: new Uint8Array(Buffer.from(hex!, "hex")) };
    }
    throw new Error("unexpected");
  };

  it("signs PS256 inside KMS, and the signature verifies with the public key", async () => {
    const signer = kmsSigner("alias/k", kmsFake);
    const sig = await signer.sign(Buffer.from("header.payload"));
    expect(
      verify(
        "sha256",
        Buffer.from("header.payload"),
        { key: publicKey, padding: 6, saltLength: 32 },
        sig,
      ),
    ).toBe(true);
    const jwk = await signer.publicJwk();
    expect(jwk).toMatchObject({ kty: "RSA" });
    expect(
      createPublicKey({ key: jwk, format: "jwk" } as never).export({ format: "der", type: "spki" }),
    ).toEqual(der);
  });

  it("seals with the consumer reference as context, so a token can't be unsealed for someone else", async () => {
    for (const sealer of [kmsSealer("alias/k", kmsFake), aesSealer(Buffer.alloc(32, 1))]) {
      const sealed = await sealer.seal("rt-secret", A);
      expect(sealed).not.toContain("rt-secret");
      expect(await sealer.unseal(sealed, A)).toBe("rt-secret");
      await expect(sealer.unseal(sealed, B)).rejects.toThrow();
    }
  });
});
