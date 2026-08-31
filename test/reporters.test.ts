import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunResult } from "../src/types.js";
import {
  renderHtmlReport,
  renderJsonReport,
  renderJunitReport,
  renderMarkdownReport,
  renderTerminalSummary,
  writeReports,
} from "../src/reporters/index.js";

function buildSampleResult(overrides?: Partial<RunResult>): RunResult {
  const result: RunResult = {
    schemaVersion: 1,
    runId: "run-<42>",
    suiteName: 'Suite <smoke> & "quotes"',
    configPath: "/tmp/config <suite>.yaml",
    startedAt: "2026-08-31T17:00:00.000Z",
    finishedAt: "2026-08-31T17:02:30.000Z",
    redacted: false,
    summary: {
      total: 3,
      passed: 1,
      failed: 1,
      errors: 1,
      passRate: 33.3,
      durationMs: 150_000,
    },
    reports: {
      json: "/tmp/reports/report.json",
      html: "/tmp/reports/report.html",
      junit: "/tmp/reports/report.junit.xml",
      markdown: "/tmp/reports/report.md",
    },
    trials: [
      {
        index: 0,
        id: "trial-pass",
        caseId: "case-pass",
        caseDescription: "Creates README <ok>",
        agentId: "codex",
        trial: 1,
        status: "passed",
        startedAt: "2026-08-31T17:00:00.000Z",
        finishedAt: "2026-08-31T17:00:01.234Z",
        durationMs: 1_234,
        fixture: "fixtures/pass",
        workspacePath: "/tmp/workspaces/pass case",
        process: {
          command: "node",
          args: ["script.js", "--message", "hello <world>"],
          exitCode: 0,
          signal: null,
          timedOut: false,
          durationMs: 1_200,
          stdout: "ok \u0000 <stdout> & line",
          stderr: "",
          outputTruncated: false,
        },
        changes: [{ path: "src/index.ts", status: "modified" }],
        assertions: [
          {
            type: "file_contains",
            passed: true,
            message: "Found <README> & docs",
            durationMs: 12,
            details: { z: "last", a: "first" },
          },
        ],
      },
      {
        index: 1,
        id: "trial-fail",
        caseId: "case-fail",
        caseDescription: "Checks app shell",
        agentId: "claude",
        trial: 1,
        status: "failed",
        startedAt: "2026-08-31T17:00:02.000Z",
        finishedAt: "2026-08-31T17:00:14.500Z",
        durationMs: 12_500,
        fixture: "fixtures/fail",
        workspacePath: "/tmp/workspaces/fail",
        process: {
          command: "npm",
          args: ["test", "--", "component shell"],
          exitCode: 1,
          signal: null,
          timedOut: false,
          durationMs: 12_480,
          stdout: "rendered <div> output",
          stderr: "Missing <stderr> & detail",
          outputTruncated: true,
        },
        changes: [
          { path: "src/app.tsx", status: "created" },
          { path: "src/old.tsx", status: "deleted" },
        ],
        assertions: [
          {
            type: "stdout_contains",
            passed: false,
            message: "Missing <main> | role & nav",
            durationMs: 45,
          },
          {
            type: "changed_files",
            passed: true,
            message: "Touched expected files",
            durationMs: 8,
          },
        ],
      },
      {
        index: 2,
        id: "trial-error",
        caseId: "case-error",
        caseDescription: "Bootstraps workspace",
        agentId: "gemini",
        trial: 1,
        status: "error",
        startedAt: "2026-08-31T17:00:15.000Z",
        finishedAt: "2026-08-31T17:00:15.100Z",
        durationMs: 100,
        fixture: "fixtures/error",
        process: {
          command: "bash",
          args: ["-lc", "run setup"],
          exitCode: null,
          signal: "SIGTERM",
          timedOut: true,
          durationMs: 100,
          stdout: "",
          stderr: "",
          outputTruncated: false,
          spawnError: "spawn EACCES <bad>",
        },
        changes: [],
        assertions: [],
        error: "Workspace setup <boom> \u0000 & failed",
      },
    ],
  };

  return {
    ...result,
    ...overrides,
    summary: overrides?.summary ?? result.summary,
    reports: overrides?.reports ?? result.reports,
    trials: overrides?.trials ?? result.trials,
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("report renderers", () => {
  it("renders a deterministic JSON report with sorted nested keys", () => {
    const result = buildSampleResult();

    const json = renderJsonReport(result);
    const parsed = JSON.parse(json) as RunResult;

    expect(parsed).toEqual(result);
    expect(json.indexOf('"html"')).toBeLessThan(json.indexOf('"json"'));
    expect(json.indexOf('"json"')).toBeLessThan(json.indexOf('"junit"'));
    expect(json.indexOf('"a": "first"')).toBeLessThan(json.indexOf('"z": "last"'));
    expect(json.endsWith("\n")).toBe(true);
  });

  it("renders a concise terminal summary with failure and error headlines", () => {
    const result = buildSampleResult();

    const summary = renderTerminalSummary(result);

    expect(summary).toContain('HarnessCheck: Suite <smoke> & "quotes"');
    expect(summary).toContain(
      "Summary: 3 total | 1 passed | 1 failed | 1 errors | 33.3% pass rate",
    );
    expect(summary).toContain("Failed trials:");
    expect(summary).toContain("case-fail [claude] trial 1: Missing <main> | role & nav");
    expect(summary).toContain("Errored trials:");
    expect(summary).toContain("case-error [gemini] trial 1: Workspace setup <boom>");
  });

  it("renders accessible self-contained HTML with escaped trial content", () => {
    const result = buildSampleResult();

    const html = renderHtmlReport(result);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('aria-labelledby="trials-title"');
    expect(html).toContain("Suite &lt;smoke&gt; &amp; &quot;quotes&quot;");
    expect(html).toContain("Missing &lt;main&gt; | role &amp; nav");
    expect(html).not.toContain("Missing <main> | role & nav");
    expect(html).toContain("No stdout or stderr captured.");
    expect(html).toContain("Captured output was truncated.");
    expect(html).toContain('href="file:///tmp/reports/report.json"');
    expect(html).toContain("&quot;a&quot;: &quot;first&quot;");
    expect(html.indexOf("&quot;a&quot;: &quot;first&quot;")).toBeLessThan(
      html.indexOf("&quot;z&quot;: &quot;last&quot;"),
    );
    expect(html).not.toContain("\u0000");
  });

  it("renders valid escaped JUnit XML for failed and errored trials", () => {
    const result = buildSampleResult();

    const junit = renderJunitReport(result);

    expect(junit).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(junit).toContain(
      '<testsuite name="Suite &lt;smoke&gt; &amp; &quot;quotes&quot;" tests="3" failures="1" errors="1" skipped="0" time="150.000"',
    );
    expect(junit).toContain(
      '<failure message="Missing &lt;main&gt; | role &amp; nav" type="assertion_failure">FAIL stdout contains (45ms): Missing &lt;main&gt; | role &amp; nav</failure>',
    );
    expect(junit).toContain(
      '<error message="Workspace setup &lt;boom&gt;  &amp; failed" type="runtime_error">Workspace setup &lt;boom&gt;  &amp; failed</error>',
    );
    expect(junit).toContain("&lt;stderr&gt; &amp; detail");
    expect(junit).not.toContain("\u0000");
  });

  it("renders Markdown with readable sections, links, and escaped tables", () => {
    const result = buildSampleResult();

    const markdown = renderMarkdownReport(result);

    expect(markdown).toContain('# HarnessCheck report: Suite <smoke> & "quotes"');
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## Trials");
    expect(markdown).toContain("[/tmp/reports/report.json](file:///tmp/reports/report.json)");
    expect(markdown).toContain("| FAIL | stdout contains | 45ms | Missing <main> \\| role & nav |");
    expect(markdown).toContain("#### Assertion details 1");
    expect(markdown).toContain('"a": "first"');
    expect(markdown).toContain("> Output was truncated.");
    expect(markdown).toContain("No file changes recorded.");
  });

  it("writes reports with absolute paths and serializes finalized report locations", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "harnesscheck-reporters-"));
    tempDirs.push(directory);

    const result = buildSampleResult({
      reports: { json: "", html: "", junit: "", markdown: "" },
    });

    const reports = await writeReports(result, path.join(directory, "nested/reports"));

    expect(path.isAbsolute(reports.json)).toBe(true);
    expect(path.isAbsolute(reports.html)).toBe(true);
    expect(path.isAbsolute(reports.junit)).toBe(true);
    expect(path.isAbsolute(reports.markdown)).toBe(true);

    const [jsonText, htmlText, junitText, markdownText] = await Promise.all([
      readFile(reports.json, "utf8"),
      readFile(reports.html, "utf8"),
      readFile(reports.junit, "utf8"),
      readFile(reports.markdown, "utf8"),
    ]);

    const parsed = JSON.parse(jsonText) as RunResult;
    expect(parsed.reports).toEqual(reports);
    expect(htmlText).toContain(reports.json);
    expect(junitText).toContain("<testsuite");
    expect(markdownText).toContain(reports.markdown);
  });

  it("shows the all-passed outcome when every trial succeeds", () => {
    const baseTrial = buildSampleResult().trials[0];
    expect(baseTrial).toBeDefined();

    const result = buildSampleResult({
      summary: {
        total: 1,
        passed: 1,
        failed: 0,
        errors: 0,
        passRate: 100,
        durationMs: 1_234,
      },
      trials: [
        {
          ...baseTrial!,
          process: {
            ...baseTrial!.process,
            stdout: "",
          },
        },
      ],
    });

    const summary = renderTerminalSummary(result);
    const html = renderHtmlReport(result);

    expect(summary).toContain("Outcome: all trials passed.");
    expect(html).toContain("No failing or errored trials.");
  });
});
