import { lstat } from "node:fs/promises";
import { minimatch } from "minimatch";
import { redactSecrets, runProcess, sanitizeOutput } from "./process.js";
import { assertNoSymlinkTraversal, pathExists, readWorkspaceFile } from "./workspace.js";
import type { AssertionConfig, AssertionResult, FileChange, ProcessResult } from "./types.js";

export interface AssertionContext {
  workspace: string;
  process: ProcessResult;
  changes: FileChange[];
  defaultTimeoutMs: number;
  maxOutputBytes: number;
  redact: boolean;
}

function result(
  assertion: AssertionConfig,
  passed: boolean,
  message: string,
  started: number,
  details?: Record<string, unknown>,
): AssertionResult {
  return {
    type: assertion.type,
    passed,
    message,
    durationMs: Math.round(performance.now() - started),
    ...(details === undefined ? {} : { details }),
  };
}

async function evaluateFileExistence(
  assertion: Extract<AssertionConfig, { type: "file_exists" | "file_not_exists" }>,
  context: AssertionContext,
  started: number,
): Promise<AssertionResult> {
  let exists: boolean;
  let regularFile = false;
  try {
    const resolved = await assertNoSymlinkTraversal(context.workspace, assertion.path);
    exists = await pathExists(resolved);
    if (exists) regularFile = (await lstat(resolved)).isFile();
  } catch (error) {
    return result(
      assertion,
      false,
      error instanceof Error ? error.message : String(error),
      started,
    );
  }
  const expectsExistence = assertion.type === "file_exists";
  const passed = expectsExistence ? exists && regularFile : !exists;
  return result(
    assertion,
    passed,
    expectsExistence
      ? exists
        ? regularFile
          ? `${assertion.path} exists as a regular file`
          : `${assertion.path} exists but is not a regular file`
        : `${assertion.path} does not exist`
      : exists
        ? `${assertion.path} exists but should not`
        : `${assertion.path} is absent`,
    started,
  );
}

async function evaluateFileContent(
  assertion: Extract<
    AssertionConfig,
    { type: "file_contains" | "file_not_contains" | "file_matches" }
  >,
  context: AssertionContext,
  started: number,
): Promise<AssertionResult> {
  try {
    const content = await readWorkspaceFile(context.workspace, assertion.path);
    if (assertion.type === "file_matches") {
      const matches = new RegExp(assertion.pattern, assertion.flags).test(content);
      return result(
        assertion,
        matches,
        matches
          ? `${assertion.path} matches /${assertion.pattern}/${assertion.flags ?? ""}`
          : `${assertion.path} does not match /${assertion.pattern}/${assertion.flags ?? ""}`,
        started,
      );
    }
    const contains = content.includes(assertion.value);
    const expected = assertion.type === "file_contains";
    return result(
      assertion,
      contains === expected,
      contains === expected
        ? `${assertion.path} ${expected ? "contains" : "does not contain"} the expected text`
        : `${assertion.path} ${expected ? "does not contain" : "contains"} the forbidden text`,
      started,
    );
  } catch (error) {
    return result(
      assertion,
      false,
      error instanceof Error ? error.message : String(error),
      started,
    );
  }
}

function evaluateChangedFiles(
  assertion: Extract<AssertionConfig, { type: "changed_files" }>,
  context: AssertionContext,
  started: number,
): AssertionResult {
  const paths = context.changes.map((change) => change.path);
  const problems: string[] = [];
  const includes = assertion.include ?? [];
  if (includes.length > 0) {
    const outside = paths.filter(
      (filePath) => !includes.some((pattern) => minimatch(filePath, pattern, { dot: true })),
    );
    if (outside.length > 0) {
      problems.push(`files outside allowed patterns changed: ${outside.join(", ")}`);
    }
  }
  for (const pattern of assertion.exclude ?? []) {
    const matches = paths.filter((filePath) => minimatch(filePath, pattern, { dot: true }));
    if (matches.length > 0)
      problems.push(`forbidden pattern ${pattern} matched ${matches.join(", ")}`);
  }
  if (assertion.min !== undefined && paths.length < assertion.min) {
    problems.push(`expected at least ${assertion.min} changed files, got ${paths.length}`);
  }
  if (assertion.max !== undefined && paths.length > assertion.max) {
    problems.push(`expected at most ${assertion.max} changed files, got ${paths.length}`);
  }
  return result(
    assertion,
    problems.length === 0,
    problems.length === 0
      ? `${paths.length} changed files satisfy the policy`
      : problems.join("; "),
    started,
    { paths },
  );
}

function evaluateOutput(
  assertion: Extract<
    AssertionConfig,
    {
      type: "stdout_contains" | "stdout_not_contains" | "stderr_contains" | "stderr_not_contains";
    }
  >,
  context: AssertionContext,
  started: number,
): AssertionResult {
  const source = assertion.type.startsWith("stdout")
    ? context.process.stdout
    : context.process.stderr;
  const contains = source.includes(assertion.value);
  const expected = assertion.type.endsWith("_contains") && !assertion.type.includes("not");
  const passed = contains === expected;
  return result(
    assertion,
    passed,
    passed
      ? `${assertion.type.startsWith("stdout") ? "stdout" : "stderr"} ${expected ? "contains" : "does not contain"} the expected text`
      : `${assertion.type.startsWith("stdout") ? "stdout" : "stderr"} ${expected ? "does not contain" : "contains"} the tested text`,
    started,
  );
}

async function evaluateCommand(
  assertion: Extract<AssertionConfig, { type: "command_exit" }>,
  context: AssertionContext,
  started: number,
): Promise<AssertionResult> {
  const commandResult = await runProcess({
    command: assertion.command,
    ...(assertion.args === undefined ? {} : { args: assertion.args }),
    cwd: context.workspace,
    timeoutMs: assertion.timeoutMs ?? context.defaultTimeoutMs,
    maxOutputBytes: context.maxOutputBytes,
  });
  const expected = assertion.exitCode ?? 0;
  const passed = !commandResult.timedOut && commandResult.exitCode === expected;
  return result(
    assertion,
    passed,
    commandResult.timedOut
      ? `Command timed out after ${assertion.timeoutMs ?? context.defaultTimeoutMs} ms`
      : `Command exited ${String(commandResult.exitCode)}; expected ${expected}`,
    started,
    {
      command: sanitizeOutput(assertion.command, context.redact),
      args: (assertion.args ?? []).map((argument) => sanitizeOutput(argument, context.redact)),
      exitCode: commandResult.exitCode,
      stdout: sanitizeOutput(commandResult.stdout, context.redact),
      stderr: sanitizeOutput(commandResult.stderr, context.redact),
      ...(commandResult.spawnError === undefined
        ? {}
        : { spawnError: redactSecrets(commandResult.spawnError) }),
    },
  );
}

export async function evaluateAssertion(
  assertion: AssertionConfig,
  context: AssertionContext,
): Promise<AssertionResult> {
  const started = performance.now();
  switch (assertion.type) {
    case "file_exists":
    case "file_not_exists":
      return await evaluateFileExistence(assertion, context, started);
    case "file_contains":
    case "file_not_contains":
    case "file_matches":
      return await evaluateFileContent(assertion, context, started);
    case "changed_files":
      return evaluateChangedFiles(assertion, context, started);
    case "stdout_contains":
    case "stdout_not_contains":
    case "stderr_contains":
    case "stderr_not_contains":
      return evaluateOutput(assertion, context, started);
    case "command_exit":
      return await evaluateCommand(assertion, context, started);
  }
}

export async function evaluateAssertions(
  assertions: AssertionConfig[],
  context: AssertionContext,
): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];
  for (const assertion of assertions) results.push(await evaluateAssertion(assertion, context));
  return results;
}

export async function isRegularFile(workspace: string, relativePath: string): Promise<boolean> {
  try {
    const resolved = await assertNoSymlinkTraversal(workspace, relativePath);
    return (await lstat(resolved)).isFile();
  } catch {
    return false;
  }
}
