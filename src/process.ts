import { spawn } from "node:child_process";
import process from "node:process";
import type { ProcessResult } from "./types.js";

export interface ProcessOptions {
  command: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-ant-[a-zA-Z0-9_-]{16,}\b/g,
  /\bsk-proj-[a-zA-Z0-9_-]{16,}\b/g,
  /\bsk-[a-zA-Z0-9_-]{24,}\b/g,
  /\bgh[pousr]_[a-zA-Z0-9]{20,}\b/g,
  /\bgithub_pat_[a-zA-Z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:Bearer|token)[ \t]+[a-zA-Z0-9._~+/=-]{20,}\b/gi,
  /\b(?:ANTHROPIC|OPENAI|GEMINI|GOOGLE|GITHUB|AWS)_API_KEY\s*[=:]\s*["']?[^\s"']{12,}/gi,
];

const DEFAULT_ENVIRONMENT_VARIABLES = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "CI",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "GEMINI_CLI_HOME",
] as const;

export function childEnvironment(
  additionalNames: readonly string[] = [],
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const selected: NodeJS.ProcessEnv = {};
  for (const name of new Set([...DEFAULT_ENVIRONMENT_VARIABLES, ...additionalNames])) {
    const value = process.env[name];
    if (value !== undefined) selected[name] = value;
  }
  return { ...selected, ...overrides };
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

export function redactSecrets(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) redacted = redacted.replace(pattern, "[REDACTED]");
  return redacted;
}

export function sanitizeOutput(value: string, redact: boolean): string {
  const plain = stripAnsi(value).replaceAll("\r\n", "\n");
  return redact ? redactSecrets(plain) : plain;
}

function terminateProcess(childPid: number | undefined): void {
  if (childPid === undefined) return;
  try {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(childPid), "/T"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.unref();
    } else process.kill(-childPid, "SIGTERM");
  } catch {
    // The process may have exited between the timeout and this signal.
  }
}

function forceKillProcess(childPid: number | undefined): void {
  if (childPid === undefined) return;
  try {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(childPid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.unref();
    } else process.kill(-childPid, "SIGKILL");
  } catch {
    // The process may already be gone.
  }
}

export async function runProcess(options: ProcessOptions): Promise<ProcessResult> {
  const args = options.args ?? [];
  const started = performance.now();
  let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let outputTruncated = false;
  let timedOut = false;
  let spawnError: string | undefined;

  return await new Promise<ProcessResult>((resolve) => {
    const child = spawn(options.command, args, {
      cwd: options.cwd,
      env: options.env ?? childEnvironment(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    const append = (
      current: Buffer<ArrayBufferLike>,
      chunk: Buffer<ArrayBufferLike>,
    ): Buffer<ArrayBufferLike> => {
      const remaining = options.maxOutputBytes - stdout.length - stderr.length;
      if (remaining <= 0) {
        outputTruncated = true;
        return current;
      }
      if (chunk.length > remaining) {
        outputTruncated = true;
        return Buffer.concat([current, chunk.subarray(0, remaining)]);
      }
      return Buffer.concat([current, chunk]);
    };

    child.stdout.on("data", (chunk: Buffer<ArrayBufferLike>) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer<ArrayBufferLike>) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      spawnError = error.message;
    });

    let forceKillTimer: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcess(child.pid);
      forceKillTimer = setTimeout(() => forceKillProcess(child.pid), 2_000);
      forceKillTimer.unref();
    }, options.timeoutMs);
    timeout.unref();

    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      const result: ProcessResult = {
        command: options.command,
        args,
        exitCode,
        signal,
        timedOut,
        durationMs: Math.round(performance.now() - started),
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        outputTruncated,
        ...(spawnError === undefined ? {} : { spawnError }),
      };
      resolve(result);
    });

    if (options.stdin !== undefined) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}
