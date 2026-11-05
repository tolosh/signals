import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";

export type OpenApiDoc = {
  info: { version: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown> };
};

export function loadContract(): OpenApiDoc {
  return parse(readFileSync("openapi.yaml", "utf8")) as OpenApiDoc;
}

export function schemaValidator(doc: OpenApiDoc) {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats.default(ajv);
  ajv.addSchema(doc as object, "openapi");
  return (name: string) => {
    const validate = ajv.compile({ $ref: `openapi#/components/schemas/${name}` });
    return (value: unknown) => ({ valid: validate(value) === true, errors: validate.errors });
  };
}
