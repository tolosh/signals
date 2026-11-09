// SIG-61 (ADR 0008, section 2): the secure store in the secure environment, on S3 with SSE-KMS,
// one bucket per store. Nothing real goes in DynamoDB (ADR 0008; DynamoDB is the mock's only,
// ADR 0005). Inside a store's bucket:
//   <SHA-256 of the consumer reference>/<record ID>.json   one record
//   <SHA-256 of the consumer reference>/_ref               the opaque reference, for listConsumers
// so the reference itself is never a key. Every write names the store's KMS key, which the bucket
// policy requires. The buckets keep no versions: a deleted record is gone at once, so a purge
// completes inside the 24-hour window (ADR 0008 section 2, amended).
// The revocation queue and the connections in progress live in the control bucket.
import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { PendingConnect, PendingConnects } from "./connect.js";
import type { Pending, RevocationState } from "./revocation.js";
import { assertConsumerRef, type ConsumerStore, type StoreName } from "./stores.js";

export type S3Send = (command: unknown) => Promise<unknown>;
export type S3Location = { bucket: string; kmsKeyId: string };

const RECORD_ID = /^[0-9a-z_-]{1,64}$/;
const REF_OBJECT = "_ref";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const isRef = (key: string) => key.endsWith(`/${REF_OBJECT}`);

type ListPage = {
  Contents?: { Key?: string }[];
  CommonPrefixes?: { Prefix?: string }[];
  IsTruncated?: boolean;
  NextContinuationToken?: string;
};

async function list(
  send: S3Send,
  bucket: string,
  prefix: string,
  delimiter?: string,
): Promise<{ keys: string[]; prefixes: string[] }> {
  const keys: string[] = [];
  const prefixes: string[] = [];
  let token: string | undefined;
  do {
    const page = (await send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ...(delimiter ? { Delimiter: delimiter } : {}),
        ...(token ? { ContinuationToken: token } : {}),
      }),
    )) as ListPage;
    for (const c of page.Contents ?? []) if (c.Key) keys.push(c.Key);
    for (const p of page.CommonPrefixes ?? []) if (p.Prefix) prefixes.push(p.Prefix);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return { keys: keys.sort(), prefixes: prefixes.sort() };
}

async function getText(send: S3Send, bucket: string, key: string): Promise<string | null> {
  try {
    const out = (await send(new GetObjectCommand({ Bucket: bucket, Key: key }))) as {
      Body?: { transformToString(): Promise<string> };
    };
    return out.Body ? await out.Body.transformToString() : null;
  } catch (e) {
    if ((e as { name?: string }).name === "NoSuchKey") return null;
    throw e;
  }
}

async function putText(send: S3Send, at: S3Location, key: string, body: string): Promise<void> {
  await send(
    new PutObjectCommand({
      Bucket: at.bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: at.kmsKeyId,
    }),
  );
}

const del = (send: S3Send, bucket: string, key: string) =>
  send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

export class S3Store implements ConsumerStore {
  constructor(
    readonly name: StoreName,
    private readonly at: S3Location,
    private readonly send: S3Send,
  ) {}

  private prefix(consumerRef: string): string {
    assertConsumerRef(consumerRef);
    return `${hash(consumerRef)}/`;
  }
  private async keys(consumerRef: string): Promise<string[]> {
    return (await list(this.send, this.at.bucket, this.prefix(consumerRef))).keys;
  }

  async put(consumerRef: string, recordId: string, record: unknown): Promise<void> {
    if (!RECORD_ID.test(recordId)) throw new Error("Record IDs are lower-case identifiers");
    const p = this.prefix(consumerRef);
    await putText(this.send, this.at, `${p}${recordId}.json`, JSON.stringify(record));
    await putText(this.send, this.at, `${p}${REF_OBJECT}`, consumerRef);
  }
  async get(consumerRef: string): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const k of (await this.keys(consumerRef)).filter((x) => !isRef(x))) {
      const text = await getText(this.send, this.at.bucket, k);
      if (text !== null) out.push(JSON.parse(text) as unknown);
    }
    return out;
  }
  async count(consumerRef: string): Promise<number> {
    return (await this.keys(consumerRef)).filter((x) => !isRef(x)).length;
  }
  async deleteConsumer(consumerRef: string): Promise<number> {
    const keys = await this.keys(consumerRef);
    const records = keys.filter((k) => !isRef(k));
    // The records first and the reference last, so a failed purge can still be found and retried.
    for (const k of records) await del(this.send, this.at.bucket, k);
    for (const k of keys.filter(isRef)) await del(this.send, this.at.bucket, k);
    return records.length;
  }
  async listConsumers(): Promise<string[]> {
    const { prefixes } = await list(this.send, this.at.bucket, "", "/");
    const refs: string[] = [];
    for (const p of prefixes) {
      const ref = await getText(this.send, this.at.bucket, `${p}${REF_OBJECT}`);
      if (ref) refs.push(ref);
    }
    return refs.sort();
  }
}

const QUEUE = "revocation/queue/";
const LAST = "revocation/last_success.json";

/** The revocation queue and the last successful poll, in the control bucket. */
export class S3RevocationState implements RevocationState {
  constructor(
    private readonly at: S3Location,
    private readonly send: S3Send,
  ) {}
  async pending(): Promise<Pending[]> {
    const out: Pending[] = [];
    for (const k of (await list(this.send, this.at.bucket, QUEUE)).keys) {
      const text = await getText(this.send, this.at.bucket, k);
      if (text) out.push(JSON.parse(text) as Pending);
    }
    return out;
  }
  async enqueue(consumerRef: string, detectedAt: string): Promise<void> {
    assertConsumerRef(consumerRef);
    const key = `${QUEUE}${hash(consumerRef)}.json`;
    if ((await getText(this.send, this.at.bucket, key)) !== null) return;
    const body = JSON.stringify({ consumer_ref: consumerRef, detected_at: detectedAt });
    await putText(this.send, this.at, key, body);
  }
  async dequeue(consumerRef: string): Promise<void> {
    assertConsumerRef(consumerRef);
    await del(this.send, this.at.bucket, `${QUEUE}${hash(consumerRef)}.json`);
  }
  async lastSuccess(): Promise<string | null> {
    const text = await getText(this.send, this.at.bucket, LAST);
    return text ? (JSON.parse(text) as { at: string }).at : null;
  }
  async setLastSuccess(at: string): Promise<void> {
    await putText(this.send, this.at, LAST, JSON.stringify({ at }));
  }
}

/**
 * Connections in progress, keyed by a hash of the state value. A state is taken once (read, then
 * deleted); completeConnect refuses it after CONNECT_TTL_MINUTES, and the control bucket's
 * lifecycle rule removes any left behind after a day.
 */
export class S3PendingConnects implements PendingConnects {
  constructor(
    private readonly at: S3Location,
    private readonly send: S3Send,
  ) {}
  async put(state: string, p: PendingConnect): Promise<void> {
    assertConsumerRef(p.consumer_ref);
    if (Number.isNaN(Date.parse(p.started_at))) throw new Error("started_at is an ISO date-time");
    await putText(this.send, this.at, `connect/${hash(state)}.json`, JSON.stringify(p));
  }
  async take(state: string): Promise<PendingConnect | null> {
    const key = `connect/${hash(state)}.json`;
    const text = await getText(this.send, this.at.bucket, key);
    if (text === null) return null;
    await del(this.send, this.at.bucket, key);
    return JSON.parse(text) as PendingConnect;
  }
}
