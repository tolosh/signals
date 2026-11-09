// SIG-61 stub (tests first).
import { MemoryStore, type StoreName } from "./stores.js";
export class S3Store extends MemoryStore {
  constructor(name: StoreName, _a: unknown, _s: unknown) {
    super(name);
  }
}
export class S3RevocationState {
  constructor(_a: unknown, _s: unknown) {}
  async lastSuccess() {
    return "x";
  }
  async setLastSuccess(_a: string) {}
  async enqueue(_r: string, _a: string) {}
  async dequeue(_r: string) {}
  async pending() {
    return [{}];
  }
}
export class S3PendingConnects {
  constructor(_a: unknown, _s: unknown) {}
  async put(_s: string, _p: unknown) {}
  async take(_s: string) {
    return {};
  }
}
