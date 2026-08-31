import type { RunResult, TrialResult } from "../types.js";
import {
  describeTrial,
  failureHeadline,
  formatDuration,
  formatPercentage,
  formatTimestamp,
} from "./common.js";

function renderIssueSection(title: string, trials: TrialResult[]): string[] {
  if (trials.length === 0) {
    return [];
  }

  return [
    `${title}:`,
    ...trials.map((trial) => `  - ${describeTrial(trial)}: ${failureHeadline(trial)}`),
  ];
}

export function renderTerminalSummary(result: RunResult): string {
  const failedTrials = result.trials.filter((trial) => trial.status === "failed");
  const erroredTrials = result.trials.filter((trial) => trial.status === "error");

  const lines = [
    `HarnessCheck: ${result.suiteName}`,
    `Run ID: ${result.runId}`,
    `Started: ${formatTimestamp(result.startedAt)}`,
    `Finished: ${formatTimestamp(result.finishedAt)}`,
    `Duration: ${formatDuration(result.summary.durationMs)}`,
    `Summary: ${result.summary.total} total | ${result.summary.passed} passed | ${result.summary.failed} failed | ${result.summary.errors} errors | ${formatPercentage(result.summary.passRate)} pass rate`,
  ];

  const reportLines = Object.entries(result.reports)
    .filter(([, reportPath]) => reportPath.length > 0)
    .map(([name, reportPath]) => `  ${name.toUpperCase()}: ${reportPath}`);

  if (reportLines.length > 0) {
    lines.push("Reports:", ...reportLines);
  }

  if (failedTrials.length === 0 && erroredTrials.length === 0) {
    lines.push("Outcome: all trials passed.");
  } else {
    lines.push(...renderIssueSection("Failed trials", failedTrials));
    lines.push(...renderIssueSection("Errored trials", erroredTrials));
  }

  return `${lines.join("\n")}\n`;
}
