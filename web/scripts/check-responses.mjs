import { readFileSync } from "node:fs";

const spec = JSON.parse(readFileSync(new URL("../../backend/docs/openapi.json", import.meta.url), "utf8"));
const problems = [];
for (const [path, item] of Object.entries(spec.paths ?? {})) {
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const operation = item[method];
    if (!operation) continue;
    for (const [status, response] of Object.entries(operation.responses ?? {})) {
      const content = response.content?.["application/json"];
      if (!content) continue;
      if (!content.schema) {
        problems.push(`${method.toUpperCase()} ${path} ${status}: missing schema`);
      }
    }
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("All JSON responses have schemas.");
