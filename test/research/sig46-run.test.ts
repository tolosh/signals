// SIG-46 T2 (D28): the committed runs reproduce from committed inputs. CI checks reproduction, not
// the target.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadV22, scoreT2, type Mode } from "../../src/research/sig46-grossup.js";

const recorded = (m: Mode) =>
  JSON.parse(
    readFileSync(`research/runs/2026-11-19-synthetic-v2.2-sig46-grossup-${m}.json`, "utf8"),
  ) as { set: { set_sha256: string }; result: ReturnType<typeof scoreT2> };

describe("SIG-46 T2 reproduces its records (D28)", () => {
  const set = loadV22();
  it.each<Mode>(["control", "primary", "method"])("%s", (m) => {
    const rec = recorded(m);
    expect(set.set_sha256).toBe(rec.set.set_sha256);
    expect(JSON.stringify(scoreT2(set, m))).toBe(JSON.stringify(rec.result));
  });
}, 300_000);
