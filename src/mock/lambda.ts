// API Gateway HTTP API (payload v2) adapter for the mock. No request data is logged.
import { createMockHandler } from "./server.js";

type HttpApiEvent = {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string }; domainName?: string };
};

const handle = createMockHandler();

export const handler = async (event: HttpApiEvent) => {
  const raw = event.body ?? "";
  const contentType = event.headers?.["content-type"];
  const host = event.requestContext.domainName ?? event.headers?.host ?? "";
  const { status, headers, body, base64 } = handle(
    event.requestContext.http.method,
    event.rawPath,
    event.headers?.prefer,
    event.rawQueryString ?? "",
    {
      body: Buffer.from(raw, event.isBase64Encoded ? "base64" : "utf8"),
      ...(contentType ? { contentType } : {}),
      origin: `https://${host}`,
    },
  );
  return { statusCode: status, headers, body, isBase64Encoded: base64 === true };
};
