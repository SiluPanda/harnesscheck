import { writeFile } from "node:fs/promises";
import path from "node:path";

const prompt = process.argv.slice(2).join(" ");
if (!prompt.toLowerCase().includes("health")) {
  console.error("Fixture agent only understands the health-endpoint demo.");
  process.exitCode = 2;
} else {
  await writeFile(
    path.join(process.cwd(), "src", "health.js"),
    [
      "/** Return the service readiness payload. */",
      "export function health() {",
      '  return { status: "ok" };',
      "}",
      "",
    ].join("\n"),
  );
  console.log("Implemented health endpoint");
}
