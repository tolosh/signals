// SIG-63 T7 re-registration r2 (research/preregistrations/SIG-63-r2.json), written before the
// runner reads it: r2 carries SIG-63.json by hash, and only the v2.2 channels D-L4-1c and D-L4-1d
// change; every other channel is SIG-63.json's or SIG-60.json's, unchanged.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as sig63 from "../../../src/research/leakage/sig63.js";

const R2 = JSON.parse(readFileSync("research/preregistrations/SIG-63-r2.json", "utf8")) as {
  carries: { file: string; sha256: string };
  channels_replaced: { id: string; caught_by: { label: string; family: string }[] }[];
};
const S63 = JSON.parse(readFileSync("research/preregistrations/SIG-63.json", "utf8")) as {
  channels_added: { id: string; caught_by: { label: string; family: string }[] }[];
};
type Channels = (set: string, registration: string) => { id: string; caught_by: unknown[] }[];
const channelsFor = (sig63 as unknown as { channelsFor?: Channels }).channelsFor;

describe("SIG-63 r2", () => {
  it("carries SIG-63.json unchanged, by hash", () => {
    const sha = createHash("sha256").update(readFileSync(R2.carries.file)).digest("hex");
    expect(sha).toBe(R2.carries.sha256);
  });
  it("under r2, v2.2's D-L4-1c and D-L4-1d are r2's; D-L4-1a and D-L4-1b are SIG-63.json's", () => {
    expect(channelsFor, "sig63.ts exports channelsFor").toBeTypeOf("function");
    const r2 = channelsFor?.("v2.2", "r2") ?? [];
    const r1 = channelsFor?.("v2.2", "r1") ?? [];
    expect(r2.map((c) => c.id)).toEqual(["D-L4-1a", "D-L4-1b", "D-L4-1c", "D-L4-1d"]);
    for (const c of r2) {
      const replaced = R2.channels_replaced.find((x) => x.id === c.id);
      const orig = S63.channels_added.find((x) => x.id === c.id);
      expect(c.caught_by).toEqual((replaced ?? orig)?.caught_by);
    }
    expect(r1).toEqual(S63.channels_added.map((c) => ({ ...c })));
  });
  it("v2 and v2.1 channels are SIG-60's under both registrations", () => {
    for (const set of ["v2", "v2.1"])
      expect(channelsFor?.(set, "r2")).toEqual(channelsFor?.(set, "r1"));
    expect(channelsFor?.("v2", "r2")?.length).toBe(10);
    expect(channelsFor?.("v2.1", "r2")?.length).toBe(17);
  });
});
