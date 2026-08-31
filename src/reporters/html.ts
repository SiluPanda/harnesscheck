import type { AssertionResult, RunResult, TrialResult } from "../types.js";
import {
  describeTrial,
  escapeHtml,
  failureHeadline,
  formatCommand,
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

function renderSummaryCard(
  label: string,
  value: string,
  tone: "neutral" | "pass" | "fail" | "error" = "neutral",
): string {
  return `
    <article class="card card-${tone}">
      <h2>${escapeHtml(label)}</h2>
      <p>${escapeHtml(value)}</p>
    </article>`;
}

function renderReports(result: RunResult): string {
  const items = Object.entries(result.reports)
    .map(
      ([name, reportPath]) => `
        <li>
          <a href="${escapeHtml(toFileHref(reportPath))}">${escapeHtml(name.toUpperCase())}</a>
          <span>${escapeHtml(reportPath)}</span>
        </li>`,
    )
    .join("");

  return `
    <section aria-labelledby="reports-title" class="panel">
      <div class="panel-header">
        <h2 id="reports-title">Report files</h2>
      </div>
      <ul class="report-list">${items}</ul>
    </section>`;
}

function renderAssertionRows(assertions: AssertionResult[]): string {
  if (assertions.length === 0) {
    return '<tr><td colspan="4">No assertions recorded.</td></tr>';
  }

  return assertions
    .map((assertion, index) => {
      const detailsBlock =
        assertion.details === undefined
          ? ""
          : `<details><summary>Details</summary><pre>${escapeHtml(stableJsonStringify(assertion.details, 2))}</pre></details>`;

      return `
        <tr>
          <th scope="row">Assertion ${index + 1}</th>
          <td><span class="badge ${assertion.passed ? "badge-pass" : "badge-fail"}">${assertion.passed ? "PASS" : "FAIL"}</span></td>
          <td>${escapeHtml(humanizeAssertionType(assertion.type))}<div class="muted">${escapeHtml(formatDuration(assertion.durationMs))}</div></td>
          <td>${escapeHtml(assertion.message)}${detailsBlock}</td>
        </tr>`;
    })
    .join("");
}

function renderChangeRows(trial: TrialResult): string {
  if (trial.changes.length === 0) {
    return '<tr><td colspan="2">No file changes recorded.</td></tr>';
  }

  return trial.changes
    .map(
      (change) => `
        <tr>
          <td><span class="badge badge-neutral">${escapeHtml(change.status)}</span></td>
          <td>${escapeHtml(change.path)}</td>
        </tr>`,
    )
    .join("");
}

function renderMetadata(trial: TrialResult): string {
  const rows: Array<[string, string]> = [
    ["Status", humanizeStatus(trial.status)],
    ["Duration", formatDuration(trial.durationMs)],
    ["Started", formatTimestamp(trial.startedAt)],
    ["Finished", formatTimestamp(trial.finishedAt)],
    ["Fixture", trial.fixture],
    ["Command", formatCommand(trial.process.command, trial.process.args)],
  ];

  if (trial.caseDescription) {
    rows.splice(1, 0, ["Description", trial.caseDescription]);
  }

  if (trial.workspacePath) {
    rows.push(["Workspace", trial.workspacePath]);
  }

  return rows
    .map(
      ([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
    )
    .join("");
}

function renderProcessPanel(trial: TrialResult): string {
  const summaryItems = renderProcessSummary(trial)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");

  const logs: string[] = [];
  if (trial.process.stdout) {
    logs.push(
      `<details><summary>Stdout</summary><pre>${escapeHtml(trial.process.stdout)}</pre></details>`,
    );
  }
  if (trial.process.stderr) {
    logs.push(
      `<details><summary>Stderr</summary><pre>${escapeHtml(trial.process.stderr)}</pre></details>`,
    );
  }
  if (!hasProcessOutput(trial)) {
    logs.push('<p class="empty-state">No stdout or stderr captured.</p>');
  }
  if (trial.process.outputTruncated) {
    logs.push('<p class="callout">Captured output was truncated.</p>');
  }
  if (trial.error) {
    logs.push(
      `<details open><summary>Error</summary><pre>${escapeHtml(trial.error)}</pre></details>`,
    );
  }

  return `
    <section class="panel nested-panel" aria-labelledby="process-${escapeHtml(trial.id)}">
      <div class="panel-header">
        <h3 id="process-${escapeHtml(trial.id)}">Process</h3>
      </div>
      <ul class="meta-list">${summaryItems}</ul>
      ${logs.join("")}
    </section>`;
}

function renderTrial(trial: TrialResult): string {
  const statusClass =
    trial.status === "passed" ? "pass" : trial.status === "failed" ? "fail" : "error";
  const headline = trial.status === "passed" ? "All assertions passed." : failureHeadline(trial);

  return `
    <article class="trial-card trial-${statusClass}" id="trial-${escapeHtml(trial.id)}">
      <header class="trial-header">
        <div>
          <p class="eyebrow">${escapeHtml(trial.agentId)}</p>
          <h2>${escapeHtml(describeTrial(trial))}</h2>
          <p>${escapeHtml(headline)}</p>
        </div>
        <span class="badge badge-${statusClass}">${escapeHtml(humanizeStatus(trial.status))}</span>
      </header>

      <dl class="metadata-grid">
        ${renderMetadata(trial)}
      </dl>

      <section class="panel nested-panel" aria-labelledby="assertions-${escapeHtml(trial.id)}">
        <div class="panel-header">
          <h3 id="assertions-${escapeHtml(trial.id)}">Assertions</h3>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Assertion</th>
                <th scope="col">Status</th>
                <th scope="col">Type</th>
                <th scope="col">Message</th>
              </tr>
            </thead>
            <tbody>
              ${renderAssertionRows(trial.assertions)}
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel nested-panel" aria-labelledby="changes-${escapeHtml(trial.id)}">
        <div class="panel-header">
          <h3 id="changes-${escapeHtml(trial.id)}">File changes</h3>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Path</th>
              </tr>
            </thead>
            <tbody>
              ${renderChangeRows(trial)}
            </tbody>
          </table>
        </div>
      </section>

      ${renderProcessPanel(trial)}
    </article>`;
}

function renderQuickLinks(result: RunResult): string {
  const failingTrials = result.trials.filter((trial) => trial.status !== "passed");
  if (failingTrials.length === 0) {
    return `
      <section class="panel" aria-labelledby="attention-title">
        <div class="panel-header">
          <h2 id="attention-title">Attention needed</h2>
        </div>
        <p class="empty-state">No failing or errored trials.</p>
      </section>`;
  }

  const items = failingTrials
    .map(
      (trial) => `
        <li>
          <a href="#trial-${escapeHtml(trial.id)}">${escapeHtml(describeTrial(trial))}</a>
          <span>${escapeHtml(failureHeadline(trial))}</span>
        </li>`,
    )
    .join("");

  return `
    <section class="panel" aria-labelledby="attention-title">
      <div class="panel-header">
        <h2 id="attention-title">Attention needed</h2>
      </div>
      <ul class="attention-list">${items}</ul>
    </section>`;
}

export function renderHtmlReport(result: RunResult): string {
  const title = `HarnessCheck report — ${result.suiteName}`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #0b1020;
        --panel: rgba(15, 23, 42, 0.88);
        --panel-strong: rgba(15, 23, 42, 0.98);
        --text: #e5eefc;
        --muted: #9fb0d1;
        --border: rgba(148, 163, 184, 0.25);
        --pass: #17c964;
        --fail: #f31260;
        --error: #f5a524;
        --neutral: #60a5fa;
        --shadow: 0 24px 48px rgba(15, 23, 42, 0.25);
        --radius: 18px;
      }

      @media (prefers-color-scheme: light) {
        :root {
          --bg: #f3f7ff;
          --panel: rgba(255, 255, 255, 0.92);
          --panel-strong: rgba(255, 255, 255, 0.98);
          --text: #132238;
          --muted: #4a607d;
          --border: rgba(71, 85, 105, 0.18);
          --shadow: 0 18px 40px rgba(71, 85, 105, 0.12);
        }
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top, rgba(96, 165, 250, 0.18), transparent 32%),
          linear-gradient(180deg, rgba(15, 23, 42, 0.06), transparent 35%),
          var(--bg);
        color: var(--text);
        line-height: 1.6;
      }
      a { color: inherit; }
      .container {
        width: min(1200px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 32px 0 64px;
      }
      .hero,
      .panel,
      .trial-card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        backdrop-filter: blur(18px);
      }
      .hero {
        padding: 28px;
        margin-bottom: 24px;
      }
      .hero h1 {
        margin: 0 0 8px;
        font-size: clamp(1.8rem, 2.6vw, 2.8rem);
        line-height: 1.15;
      }
      .hero p { margin: 0; color: var(--muted); }
      .hero-grid,
      .summary-grid {
        display: grid;
        gap: 16px;
      }
      .hero-grid {
        margin-top: 20px;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }
      .summary-grid {
        margin: 24px 0;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      }
      .card {
        background: var(--panel-strong);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 16px 18px;
      }
      .card h2 {
        margin: 0 0 6px;
        font-size: 0.9rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .card p {
        margin: 0;
        font-size: 1.7rem;
        font-weight: 700;
      }
      .card-pass p { color: var(--pass); }
      .card-fail p { color: var(--fail); }
      .card-error p { color: var(--error); }
      .layout {
        display: grid;
        gap: 24px;
      }
      .panel {
        padding: 20px 22px;
      }
      .nested-panel {
        margin-top: 18px;
        padding: 16px 18px;
      }
      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
      }
      .panel-header h2,
      .panel-header h3 {
        margin: 0;
        font-size: 1.1rem;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 76px;
        border-radius: 999px;
        padding: 4px 12px;
        font-size: 0.85rem;
        font-weight: 700;
        border: 1px solid currentColor;
      }
      .badge-pass { color: var(--pass); }
      .badge-fail { color: var(--fail); }
      .badge-error { color: var(--error); }
      .badge-neutral { color: var(--neutral); }
      .muted,
      .empty-state,
      .attention-list span,
      .report-list span,
      .eyebrow {
        color: var(--muted);
      }
      .eyebrow {
        margin: 0 0 4px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 0.78rem;
        font-weight: 700;
      }
      .metadata-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 14px;
        margin: 0;
      }
      .metadata-grid div {
        background: rgba(148, 163, 184, 0.08);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 12px 14px;
      }
      .metadata-grid dt {
        margin: 0 0 4px;
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .metadata-grid dd {
        margin: 0;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .report-list,
      .attention-list,
      .meta-list {
        margin: 0;
        padding-left: 20px;
      }
      .report-list li,
      .attention-list li {
        display: grid;
        gap: 4px;
        margin-bottom: 12px;
      }
      .trial-card {
        padding: 22px;
      }
      .trial-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        margin-bottom: 18px;
      }
      .trial-header h2 {
        margin: 0 0 8px;
        font-size: 1.35rem;
      }
      .trial-header p {
        margin: 0;
        color: var(--muted);
      }
      .trial-pass { border-left: 6px solid var(--pass); }
      .trial-fail { border-left: 6px solid var(--fail); }
      .trial-error { border-left: 6px solid var(--error); }
      .table-wrap { overflow-x: auto; }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        padding: 12px 10px;
        border-bottom: 1px solid var(--border);
        text-align: left;
        vertical-align: top;
      }
      thead th {
        font-size: 0.84rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      tbody tr:last-child th,
      tbody tr:last-child td {
        border-bottom: none;
      }
      pre {
        margin: 12px 0 0;
        padding: 14px;
        overflow: auto;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: rgba(2, 8, 23, 0.48);
        color: inherit;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      details + details,
      .callout + details,
      details + .callout,
      p + details {
        margin-top: 12px;
      }
      summary {
        cursor: pointer;
        font-weight: 700;
      }
      .callout {
        margin: 12px 0 0;
        padding: 12px 14px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: rgba(245, 165, 36, 0.12);
      }
      .footer {
        margin-top: 28px;
        color: var(--muted);
        text-align: center;
        font-size: 0.92rem;
      }
      @media (max-width: 720px) {
        .container { width: min(100vw - 20px, 1200px); padding-top: 20px; }
        .hero, .panel, .trial-card { padding-left: 18px; padding-right: 18px; }
        .trial-header { flex-direction: column; }
      }
    </style>
  </head>
  <body>
    <main class="container">
      <section class="hero" aria-labelledby="page-title">
        <h1 id="page-title">${escapeHtml(result.suiteName)}</h1>
        <p>Run <strong>${escapeHtml(result.runId)}</strong> completed on ${escapeHtml(formatTimestamp(result.finishedAt))}.</p>
        <div class="hero-grid">
          ${renderSummaryCard("Config path", result.configPath)}
          ${renderSummaryCard("Started", formatTimestamp(result.startedAt))}
          ${renderSummaryCard("Finished", formatTimestamp(result.finishedAt))}
          ${renderSummaryCard("Redacted", result.redacted ? "Yes" : "No")}
        </div>
      </section>

      <section class="summary-grid" aria-label="Run summary">
        ${renderSummaryCard("Total trials", String(result.summary.total))}
        ${renderSummaryCard("Passed", String(result.summary.passed), "pass")}
        ${renderSummaryCard("Failed", String(result.summary.failed), "fail")}
        ${renderSummaryCard("Errors", String(result.summary.errors), "error")}
        ${renderSummaryCard("Pass rate", formatPercentage(result.summary.passRate))}
        ${renderSummaryCard("Duration", formatDuration(result.summary.durationMs))}
      </section>

      <div class="layout">
        ${renderQuickLinks(result)}
        ${renderReports(result)}
        <section class="panel" aria-labelledby="trials-title">
          <div class="panel-header">
            <h2 id="trials-title">Trials</h2>
            <span class="badge badge-neutral">${escapeHtml(String(result.trials.length))} recorded</span>
          </div>
          ${result.trials.map((trial) => renderTrial(trial)).join("")}
        </section>
      </div>

      <p class="footer">Generated by HarnessCheck on ${escapeHtml(formatTimestamp(result.finishedAt))}.</p>
    </main>
  </body>
</html>
`;
}
