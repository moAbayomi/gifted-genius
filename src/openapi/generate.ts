// src/openapi/generate.ts
//
// Writes the generated spec to docs/openapi.json so reviewers can read it
// without running the server. Run with `npm run docs:openapi`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiDocument } from "./document.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(here, "../../docs/openapi.json");
const document = buildOpenApiDocument();

fs.writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, "utf8");

console.log(
  `Wrote ${path.relative(process.cwd(), output)} (${Object.keys(document.paths ?? {}).length} paths)`,
);
