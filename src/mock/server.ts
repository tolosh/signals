// Mock of openapi.yaml for the Lovable front ends (SIG-11). Routes come from the contract and
// responses from fixtures.ts. It is stateless: writes return a fixture and change nothing.
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { fixtures, IDS, variants, type MockError } from "./fixtures.js";

const METHODS = ["get", "post", "put", "patch", "delete"];

type Operation = { responses: Record<string, unknown> };
type Route = {
  template: string;
  regex: RegExp;
  literal: boolean;
  operations: Record<string, Operation>;
};
export type MockResponse = { status: number; headers: Record<string, string>; body: string };
export type MockHandler = (
  method: string,
  path: string,
  prefer?: string,
  query?: string,
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

const error = (status: number, code: string, message: string): MockResponse => ({
  status,
  headers: { ...CORS, ...JSON_TYPE },
  body: JSON.stringify({ error: { code, message } }),
});

const successStatus = (op: Operation) =>
  Number(Object.keys(op.responses).find((code) => /^[23]/.test(code)));

export function createMockHandler(): MockHandler {
  const routes = loadRoutes();
  return (rawMethod, path, prefer, query = "") => {
    const method = rawMethod.toLowerCase();
    if (method === "options") return { status: 204, headers: CORS, body: "" };

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
    let body: unknown =
      typeof fixture === "function" ? fixture(params, new URLSearchParams(query)) : fixture;
    if (body && typeof body === "object" && "mockError" in body) {
      const e = (body as MockError).mockError;
      return error(e.status, e.code, e.message);
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
    const url = new URL(req.url ?? "/", "http://mock");
    const out = handle(
      req.method ?? "GET",
      url.pathname,
      String(req.headers.prefer ?? ""),
      url.search,
    );
    res.writeHead(out.status, out.headers);
    res.end(out.body);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4010);
  createMockServer().listen(port, "127.0.0.1", () => {
    console.log(`Signals mock on http://127.0.0.1:${port}`);
  });
}
