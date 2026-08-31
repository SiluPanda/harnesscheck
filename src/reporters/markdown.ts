import type { AssertionResult, RunResult, TrialResult } from "../types.js";
import {
  describeTrial,
  failureHeadline,
  formatDuration,
  formatPercentage,
  formatTimestamp,
  hasProcessOutput,
  humanizeAssertionType,
  humanizeStatus,
  renderProcessSummary,
  stableJsonStringify,
  toFileHref,
} from "./common.js";

function escapeMarkdownInline(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function renderMetadataList(result: RunResult): string {
  const entries = [
    ["Run ID", result.runId],
    ["Suite", result.suiteName],
    ["Config", result.configPath],
    ["Started", formatTimestamp(result.startedAt)],
    ["Finished", formatTimestamp(result.finishedAt)],
    ["Duration", formatDuration(result.summary.durationMs)],
    ["Redacted", result.redacted ? "yes" : "no"],
  ];

  return entries.map(([label, value]) => `- **${label}:** ${value}`).join("\n");
}

function renderReportsList(result: RunResult): string {
  return Object.entries(result.reports)
    .map(
      ([name, reportPath]) =>
        `- **${name.toUpperCase()}:** [${reportPath}](${toFileHref(reportPath)})`,
    )
    .join("\n");
}

function renderAssertionTable(assertions: AssertionResult[]): string {
  if (assertions.length === 0) {
    return "No assertions recorded.";
  }

  const header = "| Status | Type | Duration | Message |\n| --- | --- | ---: | --- |";
  const rows = assertions.map((assertion) => {
    const message = escapeMarkdownInline(assertion.message);
    return `| ${assertion.passed ? "PASS" : "FAIL"} | ${escapeMarkdownInline(humanizeAssertionType(assertion.type))} | ${formatDuration(assertion.durationMs)} | ${message} |`;
  });

  return [header, ...rows].join("\n");
}

function renderAssertionDetails(assertions: AssertionResult[]): string {
  const detailedAssertions = assertions.filter((assertion) => assertion.details !== undefined);
  if (detailedAssertions.length === 0) {
    return "";
  }

  return detailedAssertions
    .map(
      (assertion, index) =>
        `#### Assertion details ${index + 1}\n\n- **Type:** ${humanizeAssertionType(assertion.type)}\n- **Status:** ${assertion.passed ? "PASS" : "FAIL"}\n\n\
\`\`\`json\n${stableJsonStringify(assertion.details, 2)}\n\`\`\``,
    )
    .join("\n\n");
}

function renderChanges(trial: TrialResult): string {
  if (trial.changes.length === 0) {
    return "No file changes recorded.";
  }

  const header = "| Status | Path |\n| --- | --- |";
  const rows = trial.changes.map(
    (change) => `| ${change.status} | ${escapeMarkdownInline(change.path)} |`,
  );
  return [header, ...rows].join("\n");
}

function renderLogBlock(title: string, content: string): string {
  return `#### ${title}\n\n\`\`\`text\n${content}\n\`\`\``;
}

function renderTrial(trial: TrialResult): string {
  const lines = [
    `## ${describeTrial(trial)}`,
    "",
    `- **Status:** ${humanizeStatus(trial.status)}`,
    `- **Duration:** ${formatDuration(trial.durationMs)}`,
    `- **Started:** ${formatTimestamp(trial.startedAt)}`,
    `- **Finished:** ${formatTimestamp(trial.finishedAt)}`,
    `- **Fixture:** ${trial.fixture}`,
  ];

  if (trial.caseDescription) {
    lines.push(`- **Description:** ${trial.caseDescription}`);
  }

  if (trial.workspacePath) {
    lines.push(`- **Workspace:** [${trial.workspacePath}](${toFileHref(trial.workspacePath)})`);
  }

  if (trial.status !== "passed") {
    lines.push(`- **Headline:** ${failureHeadline(trial)}`);
  }

  lines.push("", "### Process", "", ...renderProcessSummary(trial).map((line) => `- ${line}`));
  lines.push("", "### Assertions", "", renderAssertionTable(trial.assertions));

  const assertionDetails = renderAssertionDetails(trial.assertions);
  if (assertionDetails) {
    lines.push("", assertionDetails);
  }

  lines.push("", "### Changes", "", renderChanges(trial));

  if (hasProcessOutput(trial)) {
    if (trial.process.stdout) {
      lines.push("", renderLogBlock("Stdout", trial.process.stdout));
    }
    if (trial.process.stderr) {
      lines.push("", renderLogBlock("Stderr", trial.process.stderr));
    }
  }

  if (trial.process.outputTruncated) {
    lines.push("", "> Output was truncated.");
  }

  if (trial.error) {
    lines.push("", renderLogBlock("Error", trial.error));
  }

  return lines.join("\n");
}

export function renderMarkdownReport(result: RunResult): string {
  const lines = [
    `# HarnessCheck report: ${result.suiteName}`,
    "",
    renderMetadataList(result),
    "",
    "## Summary",
    "",
    "| Total | Passed | Failed | Errors | Pass rate | Duration |",
    "| ---: | ---: | ---: | ---: | ---: | ---: |",
    `| ${result.summary.total} | ${result.summary.passed} | ${result.summary.failed} | ${result.summary.errors} | ${formatPercentage(result.summary.passRate)} | ${formatDuration(result.summary.durationMs)} |`,
    "",
    "## Reports",
    "",
    renderReportsList(result),
    "",
    "## Trials",
    "",
    ...result.trials.map((trial) => renderTrial(trial)),
  ];

  return `${lines.join("\n")}\n`;
}
