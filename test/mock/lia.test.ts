// SIG-42 contract-first fixtures: the mock serves asm_liabilities, whose six LIA signals come from
// the family 3 engine, and the response validates against the contract.
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockServer } from "../../src/mock/server.js";
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

describe("asm_liabilities: the LIA fixtures", () => {
  it("serves all six LIA signals from the engine, valid against the contract", async () => {
    const res = await fetch(`${base}/v1/app/assessments/asm_liabilities`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { signals: { id: string; state: string }[] };
    expect(validator("Assessment")(body).errors ?? []).toEqual([]);
    expect(body.signals.map((s) => s.id)).toEqual([
      "LIA-01",
      "LIA-02",
      "LIA-03",
      "LIA-04",
      "LIA-05",
      "LIA-06",
    ]);
    expect(Object.fromEntries(body.signals.map((s) => [s.id, s.state]))).toEqual({
      "LIA-01": "amber",
      "LIA-02": "amber",
      "LIA-03": "none_observed",
      "LIA-04": "none_observed",
      "LIA-05": "amber",
      "LIA-06": "none_observed",
    });
  });
});
