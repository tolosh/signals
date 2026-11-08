// SIG-61 T4: the truth-capture record (research/schemas/truth-capture-v1.schema.json). Stub: the
// tests are written first and fail on their assertions until the validator is implemented.
import type { ConsumerStore } from "./stores.js";

export type TruthCapture = Record<string, unknown>;
export type TruthError = { path: string; rule: string };
export type TruthResult = { ok: true; value: TruthCapture } | { ok: false; errors: TruthError[] };

export function validateTruthCapture(input: unknown): TruthResult {
  return { ok: true, value: input as TruthCapture };
}

export async function captureTruth(
  store: ConsumerStore,
  input: unknown,
  recordId: string,
): Promise<TruthCapture> {
  void store;
  void recordId;
  return input as TruthCapture;
}
