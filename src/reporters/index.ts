import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunResult } from "../types.js";
import { REPORT_FILE_NAMES } from "./common.js";
import { renderHtmlReport } from "./html.js";
import { renderJsonReport } from "./json.js";
import { renderJunitReport } from "./junit.js";
import { renderMarkdownReport } from "./markdown.js";

export { renderHtmlReport } from "./html.js";
export { renderJsonReport } from "./json.js";
export { renderJunitReport } from "./junit.js";
export { renderMarkdownReport } from "./markdown.js";
export { renderTerminalSummary } from "./terminal.js";

function resolveReportPaths(reportsDir: string): RunResult["reports"] {
  const baseDir = path.resolve(reportsDir);
  return {
    json: path.join(baseDir, REPORT_FILE_NAMES.json),
    html: path.join(baseDir, REPORT_FILE_NAMES.html),
    junit: path.join(baseDir, REPORT_FILE_NAMES.junit),
    markdown: path.join(baseDir, REPORT_FILE_NAMES.markdown),
  };
}

export async function writeReports(
  result: RunResult,
  reportsDir: string,
): Promise<RunResult["reports"]> {
  const resolvedReports = resolveReportPaths(reportsDir);
  const finalizedResult: RunResult = {
    ...result,
    reports: resolvedReports,
  };

  await mkdir(path.resolve(reportsDir), { recursive: true });

  await Promise.all([
    writeFile(resolvedReports.json, renderJsonReport(finalizedResult), "utf8"),
    writeFile(resolvedReports.html, renderHtmlReport(finalizedResult), "utf8"),
    writeFile(resolvedReports.junit, renderJunitReport(finalizedResult), "utf8"),
    writeFile(resolvedReports.markdown, renderMarkdownReport(finalizedResult), "utf8"),
  ]);

  return resolvedReports;
}
