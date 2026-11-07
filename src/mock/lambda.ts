// API Gateway HTTP API (payload v2) adapter for the mock. No request data is logged.
// SIG-51: state is kept in the mock's DynamoDB table (MOCK_TABLE), so every Lambda container sees
// the latest write. Without MOCK_TABLE (the offline bundle test) it uses an in-memory table.
import { createPersistentHandler, DynamoStore, MemoryStore } from "./persist.js";

type HttpApiEvent = {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string }; domainName?: string };
};

const table = process.env.MOCK_TABLE;
const handle = createPersistentHandler(table ? new DynamoStore(table) : new MemoryStore());

export const handler = async (event: HttpApiEvent) => {
  const raw = event.body ?? "";
  const contentType = event.headers?.["content-type"];
  const host = event.requestContext.domainName ?? event.headers?.host ?? "";
  const { status, headers, body, base64 } = await handle({
    method: event.requestContext.http.method,
    path: event.rawPath,
    scenario: event.headers?.["x-mock-scenario"] ?? "default",
    ...(event.headers?.prefer ? { prefer: event.headers.prefer } : {}),
    query: event.rawQueryString ?? "",
    request: {
      body: Buffer.from(raw, event.isBase64Encoded ? "base64" : "utf8"),
      ...(contentType ? { contentType } : {}),
      origin: `https://${host}`,
    },
  });
  return { statusCode: status, headers, body, isBase64Encoded: base64 === true };
};
