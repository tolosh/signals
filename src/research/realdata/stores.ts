// SIG-61 T3: the stores of the secure processing environment (ADR 0008). Stub: the tests are
// written first and fail on their assertions until the stores are implemented.
export const STORES = [
  "raw_grant_data",
  "derived_features",
  "truth_capture",
  "run_inputs",
] as const;
export type StoreName = (typeof STORES)[number];
export const CONSUMER_REF = /^cr_[0-9a-z]{16,64}$/;
export function assertConsumerRef(ref: string): void {
  void ref;
}

export interface ConsumerStore {
  readonly name: StoreName;
  put(consumerRef: string, recordId: string, record: unknown): Promise<void>;
  get(consumerRef: string): Promise<unknown[]>;
  count(consumerRef: string): Promise<number>;
  deleteConsumer(consumerRef: string): Promise<number>;
}

export class MemoryStore implements ConsumerStore {
  constructor(readonly name: StoreName) {}
  async put(): Promise<void> {}
  async get(consumerRef: string): Promise<unknown[]> {
    void consumerRef;
    return [];
  }
  async count(consumerRef: string): Promise<number> {
    void consumerRef;
    return 0;
  }
  async deleteConsumer(consumerRef: string): Promise<number> {
    void consumerRef;
    return 0;
  }
}

export class FileStore extends MemoryStore {
  constructor(name: StoreName, root: string) {
    super(name);
    void root;
  }
}
