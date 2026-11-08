// SIG-61 T3: the deletion procedure (ADR 0008, docs/runbooks/real-data-deletion.md). deleteConsumer
// removes every record for one person from every store, leaves other people untouched, is safe to
// run again, fails its receipt when a store fails, and returns a receipt the T2 guard accepts.
// All records are invented for the test.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deleteConsumer, utcDate, verifyDeleted } from "../../../src/research/realdata/deletion.js";
import { guardRunRecord } from "../../../src/research/realdata/guard.js";
import {
  FileStore,
  MemoryStore,
  STORES,
  type ConsumerStore,
  type StoreName,
} from "../../../src/research/realdata/stores.js";

const A = "cr_0000000000000000aaaa";
const B = "cr_0000000000000000bbbb";
const AT = "2026-11-09T02:30:00Z";

type Kind = "memory" | "filesystem";
function makeStores(kind: Kind): ConsumerStore[] {
  const root = mkdtempSync(join(tmpdir(), "sig61-stores-"));
  return STORES.map((n) => (kind === "memory" ? new MemoryStore(n) : new FileStore(n, root)));
}

async function seed(stores: ConsumerStore[]): Promise<void> {
  for (const s of stores) {
    await s.put(A, "r1", { store: s.name, n: 1 });
    await s.put(A, "r2", { store: s.name, n: 2 });
    await s.put(B, "r1", { store: s.name, n: 3 });
  }
}

/** A store whose delete (or count) throws, standing in for an S3 outage. */
class FailingStore extends MemoryStore {
  constructor(
    name: StoreName,
    private readonly failCount = false,
  ) {
    super(name);
  }
  override async deleteConsumer(): Promise<number> {
    throw new Error("store unavailable");
  }
  override async count(ref: string): Promise<number> {
    if (this.failCount) throw new Error("store unavailable");
    return super.count(ref);
  }
}

for (const kind of ["memory", "filesystem"] as Kind[]) {
  describe(`SIG-61 T3: deleteConsumer on ${kind} stores`, () => {
    it("removes every record for the consumer from every store", async () => {
      const stores = makeStores(kind);
      await seed(stores);
      const receipt = await deleteConsumer(stores, A, AT);
      expect(receipt.status).toBe("complete");
      expect(receipt.verified).toBe(true);
      expect(receipt.stores).toEqual(
        STORES.map((store) => ({ store, deleted: 2, remaining: 0, outcome: "complete" })),
      );
      for (const s of stores) expect(await s.count(A)).toBe(0);
      expect((await verifyDeleted(stores, A)).verified).toBe(true);
    });

    it("leaves other consumers untouched", async () => {
      const stores = makeStores(kind);
      await seed(stores);
      await deleteConsumer(stores, A, AT);
      for (const s of stores) expect(await s.get(B)).toEqual([{ store: s.name, n: 3 }]);
      expect((await verifyDeleted(stores, B)).verified).toBe(false);
    });

    it("is idempotent: a second run deletes nothing and still verifies", async () => {
      const stores = makeStores(kind);
      await seed(stores);
      await deleteConsumer(stores, A, AT);
      const again = await deleteConsumer(stores, A, AT);
      expect(again.status).toBe("complete");
      expect(again.stores.map((s) => s.deleted)).toEqual([0, 0, 0, 0]);
    });
  });
}

describe("SIG-61 T3: failures and the receipt", () => {
  it("a store that fails to delete fails the receipt; the other stores are still deleted", async () => {
    const stores = makeStores("memory");
    stores[1] = new FailingStore("derived_features");
    await seed(stores);
    const receipt = await deleteConsumer(stores, A, AT);
    expect(receipt.status).toBe("failed");
    expect(receipt.verified).toBe(false);
    expect(receipt.stores.find((s) => s.store === "derived_features")).toEqual({
      store: "derived_features",
      deleted: 0,
      remaining: 2,
      outcome: "failed",
    });
    expect(await stores[0]!.count(A)).toBe(0);
    expect(await stores[2]!.count(A)).toBe(0);
  });

  it("a store that can't be read can't be verified, so the receipt fails", async () => {
    const stores = makeStores("memory");
    stores[3] = new FailingStore("run_inputs", true);
    const receipt = await deleteConsumer(stores, A, AT);
    expect(receipt.status).toBe("failed");
    expect(receipt.stores.find((s) => s.store === "run_inputs")?.remaining).toBeNull();
  });

  it("refuses a procedure that doesn't cover every store", async () => {
    const stores = makeStores("memory").filter((s) => s.name !== "truth_capture");
    await expect(deleteConsumer(stores, A, AT)).rejects.toThrow(/truth_capture/);
  });

  it("refuses a reference that is not opaque", async () => {
    await expect(deleteConsumer(makeStores("memory"), "jane.citizen", AT)).rejects.toThrow(
      /opaque/,
    );
  });

  it("dates the receipt from the timestamp passed in, never the clock", async () => {
    expect(utcDate("2026-11-09T23:30:00+11:00")).toBe("2026-11-09");
    expect(utcDate("2026-11-10T08:30:00+11:00")).toBe("2026-11-09");
    expect(() => utcDate("yesterday")).toThrow(/ISO 8601/);
    expect(() => utcDate("2026-11-09")).toThrow(/ISO 8601/);
    const receipt = await deleteConsumer(makeStores("memory"), A, "2001-02-03T04:05:06Z");
    expect(receipt.deleted_on).toBe("2001-02-03");
  });

  it("the receipt holds no personal data and passes the T2 guard as a run record", async () => {
    const stores = makeStores("memory");
    await seed(stores);
    const receipt = await deleteConsumer(stores, A, AT);
    expect(JSON.stringify(receipt)).not.toContain(A);
    expect(receipt.data_source).toBe("openfeed-production");
    expect(receipt.deidentified_data_in_scope).toBe(false);
    expect(guardRunRecord(receipt)).toEqual({ ok: true, violations: [] });
  });
});
