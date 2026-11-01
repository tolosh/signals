// Mock of openapi.yaml for the Lovable front ends (SIG-11). Routes come from the contract and
// responses from fixtures.ts. It is stateless: writes return a fixture and change nothing.
import { readFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { fixtures, IDS, variants } from "./fixtures.js";

const METHODS = ["get", "post", "put", "patch", "delete"];

type Operation = { responses: Record<string, unknown> };
type Route = {
  template: string;
  regex: RegExp;
  literal: boolean;
  operations: Record<string, Operation>;
};

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

function sendError(res: ServerResponse, status: number, code: string, message: string) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code, message } }));
}

const successStatus = (op: Operation) =>
  Number(Object.keys(op.responses).find((code) => /^[23]/.test(code)));

export function createMockServer(): Server {
  const routes = loadRoutes();
  return createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader(
      "access-control-allow-headers",
      "authorization,content-type,idempotency-key,prefer",
    );
    res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const path = new URL(req.url ?? "/", "http://mock").pathname;
    const method = (req.method ?? "GET").toLowerCase();
    let route: Route | undefined;
    let match: RegExpExecArray | null = null;
    for (const candidate of routes) {
      match = candidate.regex.exec(path);
      if (match) {
        route = candidate;
        break;
      }
    }
    if (!route || !match) return sendError(res, 404, "not_found", "No such path");

    const op = route.operations[method];
    if (!op) return sendError(res, 405, "method_not_allowed", "Method not allowed");

    const key = `${method} ${route.template}`;
    const params = { ...match.groups };
    const fixture = fixtures[key];
    let body: unknown = typeof fixture === "function" ? fixture(params) : fixture;

    // A plain fixture is keyed by template, so its path IDs are checked against the known set.
    const unknownId =
      typeof fixture !== "function" && Object.values(params).some((value) => !IDS.has(value));
    if (body === undefined || unknownId) return sendError(res, 404, "not_found", "No such record");

    const prefer = /example=(\w+)/.exec(String(req.headers.prefer ?? ""))?.[1];
    if (prefer && variants[key]?.[prefer]) body = variants[key][prefer];

    const status = successStatus(op);
    if (status === 204) {
      res.writeHead(204);
      res.end();
    } else if (status === 302) {
      res.writeHead(302, { location: (body as { redirect: string }).redirect });
      res.end();
    } else if (path.endsWith(".pdf")) {
      res.writeHead(status, { "content-type": "application/pdf" });
      res.end("%PDF-1.7\n% Mock credit file\n");
    } else if (path.endsWith(".csv")) {
      res.writeHead(status, { "content-type": "text/csv" });
      res.end((body as { csv: string }).csv);
    } else {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4010);
  createMockServer().listen(port, "127.0.0.1", () => {
    console.log(`Signals mock on http://127.0.0.1:${port}`);
  });
}
