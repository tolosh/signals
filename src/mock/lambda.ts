// API Gateway HTTP API (payload v2) adapter for the mock. No request data is logged.
import { createMockHandler } from "./server.js";

type HttpApiEvent = {
  rawPath: string;
  headers?: Record<string, string | undefined>;
  requestContext: { http: { method: string } };
};

const handle = createMockHandler();

export const handler = async (event: HttpApiEvent) => {
  const { status, headers, body } = handle(
    event.requestContext.http.method,
    event.rawPath,
    event.headers?.prefer,
  );
  return { statusCode: status, headers, body };
};
