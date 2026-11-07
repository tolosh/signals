// Mock of openapi.yaml for the Lovable front ends (SIG-11). Routes come from the contract and
// responses from fixtures.ts. Writes return a fixture and change nothing, except auto top-up and
// the workspace logo, which the mock remembers (contract 1.2.0). Uploads go to uploads.ts.
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { fixtures, IDS, variants, type MockError } from "./fixtures.js";
import { acceptUpload, LOGO_PREFIX, servedLogo, UPLOAD_PREFIX } from "./uploads.js";

const METHODS = ["get", "post", "put", "patch", "delete"];

type Operation = { responses: Record<string, unknown> };
type Route = {
  template: string;
  regex: RegExp;
  literal: boolean;
  operations: Record<string, Operation>;
};
export type MockResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** True when body is base64 (a served logo). */
  base64?: boolean;
};
/** The rest of the request: raw body, its content type, and the origin the mock is served on. */
export type MockRequestInfo = { body?: Buffer; contentType?: string; origin?: string };
export type MockHandler = (
  method: string,
  path: string,
  prefer?: string,
  query?: string,
  request?: MockRequestInfo,
) => MockResponse;

function loadRoutes(): Route[] {
  const doc = parse(readFileSync("openapi.yaml", "utf8")) as {
    paths: Record<string, Record<string, Operation>>;
  };
  const routes = Object.entries(doc.paths).map(([template, item]) => ({
    template,
    literal: !template.includes("{"),
    regex: new RegExp(
      "^" +
        template
          .replace(/[.]/g, "\\.")
          .replace(/\{(\w+)\}/g, (_, name: string) => `(?<${name}>[^/]+)`) +
        "$",
    ),
    operations: Object.fromEntries(Object.entries(item).filter(([m]) => METHODS.includes(m))),
  }));
  // Literal paths win over templates, so /benchmarks/template.csv is never read as an ID.
  return routes.sort((a, b) => Number(b.literal) - Number(a.literal));
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type,idempotency-key,prefer",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
};
const JSON_TYPE = { "content-type": "application/json" };

const error = (status: number, code: string, message: string, details?: unknown): MockResponse => ({
  status,
  headers: { ...CORS, ...JSON_TYPE },
  body: JSON.stringify({ error: { code, message, ...(details === undefined ? {} : { details }) } }),
});

const successStatus = (op: Operation) =>
  Number(Object.keys(op.responses).find((code) => /^[23]/.test(code)));

const parseJson = (request: MockRequestInfo): unknown => {
  if (!request.body?.length) return undefined;
  try {
    return JSON.parse(request.body.toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
};

export function createMockHandler(): MockHandler {
  const routes = loadRoutes();
  return (rawMethod, path, prefer, query = "", request = {}) => {
    const method = rawMethod.toLowerCase();
    if (method === "options") return { status: 204, headers: CORS, body: "" };

    // The presigned PUT and the served logo are not contract paths: S3 serves them in production.
    if (path.startsWith(UPLOAD_PREFIX) && method === "put") {
      const key = decodeURIComponent(path.slice(UPLOAD_PREFIX.length));
      const status = acceptUpload(
        key,
        new URLSearchParams(query),
        request.contentType,
        request.body ?? Buffer.alloc(0),
        Date.now(),
      );
      return { status, headers: CORS, body: "" };
    }
    if (path.startsWith(LOGO_PREFIX) && method === "get") {
      const logo = servedLogo(decodeURIComponent(path.slice(LOGO_PREFIX.length)));
      if (!logo) return error(404, "not_found", "No such logo");
      const headers = { ...CORS, "content-type": logo.type, "x-content-type-options": "nosniff" };
      return { status: 200, headers, body: logo.bytes.toString("base64"), base64: true };
    }

    let route: Route | undefined;
    let match: RegExpExecArray | null = null;
    for (const candidate of routes) {
      match = candidate.regex.exec(path);
      if (match) {
        route = candidate;
        break;
      }
    }
    if (!route || !match) return error(404, "not_found", "No such path");

    const op = route.operations[method];
    if (!op) return error(405, "method_not_allowed", "Method not allowed");

    const key = `${method} ${route.template}`;
    const params = { ...match.groups };
    const fixture = fixtures[key];
    const req = {
      body: parseJson(request),
      text: request.body?.toString("utf8") ?? "",
      origin: request.origin ?? "",
      now: Date.now(),
    };
    let body: unknown =
      typeof fixture === "function" ? fixture(params, new URLSearchParams(query), req) : fixture;
    if (body && typeof body === "object" && "mockError" in body) {
      const e = (body as MockError).mockError;
      return error(e.status, e.code, e.message, e.details);
    }

    // A plain fixture is keyed by template, so its path IDs are checked against the known set.
    const unknownId =
      typeof fixture !== "function" && Object.values(params).some((value) => !IDS.has(value));
    if (body === undefined || unknownId) return error(404, "not_found", "No such record");

    const variant = /example=(\w+)/.exec(prefer ?? "")?.[1];
    if (variant && variants[key]?.[variant]) body = variants[key][variant];

    const status = successStatus(op);
    if (status === 204) return { status, headers: CORS, body: "" };
    if (status === 302) {
      const location = (body as { redirect: string }).redirect;
      return { status, headers: { ...CORS, location }, body: "" };
    }
    if (path.endsWith(".pdf")) {
      const headers = { ...CORS, "content-type": "application/pdf" };
      return { status, headers, body: "%PDF-1.7\n% Mock credit file\n" };
    }
    if (path.endsWith(".csv")) {
      const headers = { ...CORS, "content-type": "text/csv" };
      return { status, headers, body: (body as { csv: string }).csv };
    }
    return { status, headers: { ...CORS, ...JSON_TYPE }, body: JSON.stringify(body) };
  };
}

export function createMockServer(): Server {
  const handle = createMockHandler();
  return createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://mock");
      const out = handle(
        req.method ?? "GET",
        url.pathname,
        String(req.headers.prefer ?? ""),
        url.search.slice(1),
        {
          body: Buffer.concat(chunks),
          ...(req.headers["content-type"] ? { contentType: req.headers["content-type"] } : {}),
          origin: `http://${req.headers.host ?? "127.0.0.1"}`,
        },
      );
      res.writeHead(out.status, out.headers);
      res.end(out.base64 ? Buffer.from(out.body, "base64") : out.body);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4010);
  createMockServer().listen(port, "127.0.0.1", () => {
    console.log(`Signals mock on http://127.0.0.1:${port}`);
  });
}
