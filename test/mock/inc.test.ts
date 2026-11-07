// SIG-41 contract-first fixtures: the mock serves asm_income, whose 13 INC signals come from the
// family 1 engine, and the response validates against the contract.
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockServer } from "../../src/mock/server.js";
import { DEFINITIONS } from "../../src/engines/evidence/index.js";
import { loadContract, schemaValidator } from "../contract/helpers.js";

const validator = schemaValidator(loadContract());
let server: Server;
let base: string;
beforeAll(async () => {
  server = createMockServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  server.closeAllConnections();
});

describe("asm_income: the INC fixtures", () => {
  it("serves all 13 INC signals, valid against the contract", async () => {
    const res = await fetch(`${base}/v1/app/assessments/asm_income`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { signals: { id: string; state: string }[] };
    const result = validator("Assessment")(body);
    expect(result.errors ?? []).toEqual([]);
    const inc = Object.keys(DEFINITIONS).filter((id) => id.startsWith("INC-"));
    expect(body.signals.map((s) => s.id)).toEqual(inc);
    const states = Object.fromEntries(body.signals.map((s) => [s.id, s.state]));
    expect(states).toMatchObject({
      "INC-02": "unverified",
      "INC-03": "amber",
      "INC-05": "none_observed",
      "INC-10": "amber",
    });
  });
});
