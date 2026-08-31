import type { RunResult, TrialResult } from "../types.js";
import {
  describeTrial,
  escapeXml,
  failureHeadline,
  formatCommand,
  renderProcessSummary,
  summarizeAssertion,
  summarizeChange,
} from "./common.js";

function formatSeconds(durationMs: number): string {
  return (durationMs / 1_000).toFixed(3);
}

function renderFailureNode(trial: TrialResult): string {
  const body = [
    trial.error,
    ...trial.assertions
      .filter((assertion) => !assertion.passed)
      .map((assertion) => summarizeAssertion(assertion)),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");

  if (trial.status === "failed") {
    return `    <failure message="${escapeXml(failureHeadline(trial))}" type="assertion_failure">${escapeXml(body)}</failure>`;
  }

  return `    <error message="${escapeXml(failureHeadline(trial))}" type="runtime_error">${escapeXml(body)}</error>`;
}

function renderSystemOut(trial: TrialResult): string {
  const lines = [
    `Case: ${trial.caseId}`,
    `Agent: ${trial.agentId}`,
    `Trial: ${trial.trial}`,
    `Status: ${trial.status}`,
    `Command: ${formatCommand(trial.process.command, trial.process.args)}`,
    ...renderProcessSummary(trial),
  ];

  if (trial.changes.length > 0) {
    lines.push("Changes:", ...trial.changes.map((change) => `- ${summarizeChange(change)}`));
  }

  if (trial.assertions.length > 0) {
    lines.push(
      "Assertions:",
      ...trial.assertions.map((assertion) => `- ${summarizeAssertion(assertion)}`),
    );
  }

  if (trial.process.stdout) {
    lines.push("Stdout:", trial.process.stdout);
  }

  return `    <system-out>${escapeXml(lines.join("\n"))}</system-out>`;
}

function renderSystemErr(trial: TrialResult): string | undefined {
  const chunks = [trial.process.stderr, trial.error].filter((value): value is string =>
    Boolean(value),
  );
  if (chunks.length === 0) {
    return undefined;
  }
  return `    <system-err>${escapeXml(chunks.join("\n\n"))}</system-err>`;
}

function renderTestCase(trial: TrialResult): string {
  const lines = [
    `  <testcase classname="${escapeXml(trial.agentId)}" name="${escapeXml(describeTrial(trial))}" time="${formatSeconds(trial.durationMs)}" timestamp="${escapeXml(trial.startedAt)}">`,
  ];

  if (trial.status !== "passed") {
    lines.push(renderFailureNode(trial));
  }

  lines.push(renderSystemOut(trial));
  const systemErr = renderSystemErr(trial);
  if (systemErr) {
    lines.push(systemErr);
  }
  lines.push("  </testcase>");

  return lines.join("\n");
}

export function renderJunitReport(result: RunResult): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="${escapeXml(result.suiteName)}" tests="${result.summary.total}" failures="${result.summary.failed}" errors="${result.summary.errors}" skipped="0" time="${formatSeconds(result.summary.durationMs)}" timestamp="${escapeXml(result.startedAt)}">`,
    ...result.trials.map((trial) => renderTestCase(trial)),
    "</testsuite>",
  ];

  return `${lines.join("\n")}\n`;
}
