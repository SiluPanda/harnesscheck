import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AssertionResult, FileChange, RunResult, TrialResult } from "../types.js";

export const REPORT_FILE_NAMES = {
  json: "report.json",
  html: "report.html",
  junit: "report.junit.xml",
  markdown: "report.md",
} satisfies Record<keyof RunResult["reports"], string>;

export function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJson(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalizeJson(entryValue)]),
    );
  }
  return value;
}

export function stableJsonStringify(value: unknown, space = 2): string {
  return JSON.stringify(canonicalizeJson(value), null, space);
}

function isAllowedTextCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

export function sanitizeText(value: string): string {
  let sanitized = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && isAllowedTextCodePoint(codePoint)) {
      sanitized += character;
    }
  }
  return sanitized;
}

export function escapeHtml(value: string): string {
  return sanitizeText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeXml(value: string): string {
  return sanitizeText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "0ms";
  }

  if (durationMs < 1_000) {
    return `${Math.round(durationMs)}ms`;
  }

  if (durationMs < 60_000) {
    const seconds = durationMs / 1_000;
    return `${seconds
      .toFixed(seconds >= 10 ? 1 : 2)
      .replace(/\.0+$/, "")
      .replace(/(\.\d*[1-9])0+$/, "$1")}s`;
  }

  const totalSeconds = Math.round(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

export function formatPercentage(value: number): string {
  if (!Number.isFinite(value)) return "0.0%";
  return `${value.toFixed(1)}%`;
}

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString();
}

export function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map((part) => quoteCommandPart(part)).join(" ");
}

function quoteCommandPart(value: string): string {
  if (value.length === 0) return "''";
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

export function humanizeStatus(status: TrialResult["status"]): string {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "error":
      return "Error";
  }
}

export function humanizeAssertionType(type: AssertionResult["type"]): string {
  return type.replaceAll("_", " ");
}

export function summarizeAssertion(assertion: AssertionResult): string {
  const duration = formatDuration(assertion.durationMs);
  return `${assertion.passed ? "PASS" : "FAIL"} ${humanizeAssertionType(assertion.type)} (${duration}): ${assertion.message}`;
}

export function summarizeChange(change: FileChange): string {
  return `${change.status.toUpperCase()} ${change.path}`;
}

export function failureHeadline(trial: TrialResult): string {
  if (trial.status === "error") {
    return trial.error ?? "Trial errored";
  }

  const failedAssertions = trial.assertions.filter((assertion) => !assertion.passed);
  if (failedAssertions.length === 0) {
    return trial.error ?? "Trial failed";
  }

  if (failedAssertions.length === 1) {
    return failedAssertions[0]?.message ?? "1 assertion failed";
  }

  return `${failedAssertions.length} assertions failed`;
}

export function describeTrial(trial: TrialResult): string {
  return `${trial.caseId} [${trial.agentId}] trial ${trial.trial}`;
}

export function toFileHref(filePath: string): string {
  if (!filePath) return "";
  return pathToFileURL(path.resolve(filePath)).href;
}

export function hasProcessOutput(result: TrialResult): boolean {
  return result.process.stdout.length > 0 || result.process.stderr.length > 0;
}

export function renderProcessSummary(trial: TrialResult): string[] {
  const processSummary = [
    `Command: ${formatCommand(trial.process.command, trial.process.args)}`,
    `Exit code: ${trial.process.exitCode === null ? "null" : String(trial.process.exitCode)}`,
    `Signal: ${trial.process.signal ?? "none"}`,
    `Timed out: ${trial.process.timedOut ? "yes" : "no"}`,
    `Duration: ${formatDuration(trial.process.durationMs)}`,
    `Output truncated: ${trial.process.outputTruncated ? "yes" : "no"}`,
  ];

  if (trial.process.spawnError) {
    processSummary.push(`Spawn error: ${trial.process.spawnError}`);
  }

  return processSummary;
}
