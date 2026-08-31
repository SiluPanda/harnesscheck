import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const rootUrl = new URL("../", import.meta.url);
const schemaUrl = new URL("harnesscheck.schema.json", rootUrl);
const { HARNESSCHECK_JSON_SCHEMA } = await import(new URL("dist/index.js", rootUrl));
const expected = `${JSON.stringify(HARNESSCHECK_JSON_SCHEMA, null, 2)}\n`;
const mode = process.argv[2];

if (mode === "--write") {
  await writeFile(schemaUrl, expected, "utf8");
  console.log(`Wrote ${fileURLToPath(schemaUrl)}`);
} else if (mode === "--check") {
  let actual = "";
  try {
    actual = await readFile(schemaUrl, "utf8");
  } catch {
    // The mismatch message below is more actionable than the raw ENOENT.
  }
  if (actual !== expected) {
    console.error(
      "harnesscheck.schema.json is stale. Run `npm run schema:write` and commit the result.",
    );
    process.exitCode = 1;
  } else {
    console.log("harnesscheck.schema.json is current.");
  }
} else {
  console.error("Usage: node scripts/sync-schema.mjs --write|--check");
  process.exitCode = 2;
}
