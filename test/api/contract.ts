// Validates a demo response against the contract's response schema for (template, method, status).
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { loadContract } from "../contract/helpers.js";

const doc = loadContract() as unknown as {
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
  components: { responses: Record<string, unknown> };
};
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(doc as object, "openapi");
const esc = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");
const JSON_SCHEMA = "content/application~1json/schema";

export function responseValidator(template: string, method: string, status: number) {
  const op = doc.paths[template]?.[method];
  if (!op) throw new Error(`no ${method} ${template} in the contract`);
  const res = (op.responses[String(status)] ?? op.responses.default) as { $ref?: string };
  if (!res) throw new Error(`no ${status} for ${method} ${template}`);
  const pointer = res.$ref
    ? `${res.$ref.slice(1)}/${JSON_SCHEMA}`
    : `/paths/${esc(template)}/${method}/responses/${op.responses[String(status)] ? status : "default"}/${JSON_SCHEMA}`;
  const validate = ajv.compile({ $ref: `openapi#${pointer}` });
  return (body: unknown) => ({ valid: validate(body) === true, errors: validate.errors });
}

export function schemaValidator(name: string) {
  const validate = ajv.compile({ $ref: `openapi#/components/schemas/${name}` });
  return (body: unknown) => ({ valid: validate(body) === true, errors: validate.errors });
}
