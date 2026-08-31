import process from "node:process";
import { createColors } from "picocolors";
import type { DoctorResult, RunPlan, RunResult } from "./types.js";

export interface Terminal {
  json: boolean;
  readonly color: boolean;
  setJsonMode(enabled: boolean): void;
  write(message: string): void;
  error(message: string): void;
  printJson(value: unknown, target?: "stdout" | "stderr"): void;
}

export interface TerminalOptions {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  json?: boolean;
  color?: boolean;
}

function ensureTrailingNewline(message: string): string {
  return message.endsWith("\n") ? message : `${message}\n`;
}

export class ConsoleTerminal implements Terminal {
  public json: boolean;

  public readonly color: boolean;

  private readonly stdout: NodeJS.WritableStream;

  private readonly stderr: NodeJS.WritableStream;

  public constructor(options: TerminalOptions = {}) {
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.json = options.json ?? false;
    this.color =
      options.color ?? Boolean((this.stdout as NodeJS.WritableStream & { isTTY?: boolean }).isTTY);
  }

  public setJsonMode(enabled: boolean): void {
    this.json = enabled;
  }

  public write(message: string): void {
    this.stdout.write(ensureTrailingNewline(message));
  }

  public error(message: string): void {
    this.stderr.write(ensureTrailingNewline(message));
  }

  public printJson(value: unknown, target: "stdout" | "stderr" = "stdout"): void {
    const rendered = `${JSON.stringify(value, null, 2)}\n`;
    if (target === "stderr") {
      this.stderr.write(rendered);
      return;
    }
    this.stdout.write(rendered);
  }
}

export class MemoryTerminal implements Terminal {
  public json = false;

  public readonly color = false;

  public readonly stdout: string[] = [];

  public readonly stderr: string[] = [];

  public setJsonMode(enabled: boolean): void {
    this.json = enabled;
  }

  public write(message: string): void {
    this.stdout.push(ensureTrailingNewline(message));
  }

  public error(message: string): void {
    this.stderr.push(ensureTrailingNewline(message));
  }

  public printJson(value: unknown, target: "stdout" | "stderr" = "stdout"): void {
    const rendered = `${JSON.stringify(value, null, 2)}\n`;
    if (target === "stderr") {
      this.stderr.push(rendered);
      return;
    }
    this.stdout.push(rendered);
  }

  public get stdoutText(): string {
    return this.stdout.join("");
  }

  public get stderrText(): string {
    return this.stderr.join("");
  }
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms";
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;

  const totalSeconds = durationMs / 1_000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  if (minutes < 60) return `${minutes}m ${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes - hours * 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const details: string[] = [error.message];
    let cause: unknown = error.cause;
    while (cause instanceof Error) {
      if (cause.message && !details.includes(cause.message)) details.push(cause.message);
      cause = cause.cause;
    }
    return details.filter(Boolean).join("\nCaused by: ");
  }
  return String(error);
}

export function renderDoctorSummary(result: DoctorResult, color = true): string {
  const colors = createColors(color);
  const lines = result.checks.map((check) => {
    const badge =
      check.status === "pass"
        ? colors.green("PASS")
        : check.status === "warn"
          ? colors.yellow("WARN")
          : colors.red("FAIL");
    return `${badge} ${check.name}: ${check.message}`;
  });

  const heading = result.ok
    ? colors.bold("Doctor checks passed")
    : colors.bold("Doctor found issues");
  return [heading, ...lines].join("\n");
}

export function renderPlanSummary(plan: RunPlan): string {
  const lines = [
    `Suite: ${plan.suiteName}`,
    `Config: ${plan.configPath}`,
    `Planned trials: ${plan.trials.length}`,
  ];

  if (plan.trials.length > 0) {
    lines.push("");
    for (const trial of plan.trials) {
      lines.push(
        `${trial.index}. ${trial.caseConfig.id} [${trial.agentId}] trial ${trial.trial} fixture=${trial.caseConfig.fixture}`,
      );
    }
  }

  return lines.join("\n");
}

export function renderDefaultRunSummary(result: RunResult, color = true): string {
  const colors = createColors(color);
  const status =
    result.summary.failed === 0 && result.summary.errors === 0
      ? colors.green("PASS")
      : colors.red("FAIL");

  const lines = [
    `${status} ${result.suiteName} (${result.runId})`,
    `Config: ${result.configPath}`,
    `Trials: ${result.summary.total} total, ${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.errors} errors`,
    `Pass rate: ${result.summary.passRate.toFixed(1)}%`,
    `Duration: ${formatDuration(result.summary.durationMs)}`,
  ];

  const reportEntries = Object.entries(result.reports).filter(([, value]) => value.length > 0);
  if (reportEntries.length > 0) {
    lines.push("Reports:");
    for (const [kind, filePath] of reportEntries) {
      lines.push(`  - ${kind}: ${filePath}`);
    }
  }

  return lines.join("\n");
}
