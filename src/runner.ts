import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveAgentCommand } from "./adapters.js";
import { evaluateAssertions } from "./assertions.js";
import { loadConfig } from "./config.js";
import { ConfigError } from "./errors.js";
import { childEnvironment, runProcess, sanitizeOutput } from "./process.js";
import { writeReports } from "./reporters/index.js";
import {
  copyFixture,
  diffSnapshots,
  initializeGitWorkspace,
  snapshotWorkspace,
} from "./workspace.js";
import type {
  LoadedConfig,
  ProcessResult,
  RunEvent,
  RunOptions,
  RunPlan,
  RunResult,
  TrialPlan,
  TrialResult,
} from "./types.js";

const REQUIRED_EXCLUDES = [
  ".git",
  ".git/**",
  ".harnesscheck",
  ".harnesscheck/**",
  "node_modules",
  "node_modules/**",
];

function makeRunId(date = new Date()): string {
  const timestamp = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${timestamp}-${randomBytes(3).toString("hex")}`;
}

function assertKnownFilters(
  requested: string[] | undefined,
  available: Iterable<string>,
  kind: string,
): void {
  if (requested === undefined) return;
  const known = new Set(available);
  const unknown = requested.filter((value) => !known.has(value));
  if (unknown.length > 0) {
    throw new ConfigError(
      `Unknown ${kind}${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`,
    );
  }
}

export function createRunPlan(loaded: LoadedConfig, options: RunOptions = {}): RunPlan {
  const { config } = loaded;
  assertKnownFilters(options.agents, Object.keys(config.agents), "agent");
  assertKnownFilters(
    options.cases,
    config.cases.map((testCase) => testCase.id),
    "case",
  );
  if (
    options.trials !== undefined &&
    (!Number.isInteger(options.trials) || options.trials < 1 || options.trials > 100)
  ) {
    throw new ConfigError("--trials must be an integer between 1 and 100");
  }

  const agentFilter = options.agents === undefined ? undefined : new Set(options.agents);
  const caseFilter = options.cases === undefined ? undefined : new Set(options.cases);
  const trials: TrialPlan[] = [];
  let index = 0;
  for (const testCase of config.cases) {
    if (caseFilter !== undefined && !caseFilter.has(testCase.id)) continue;
    const caseAgents = testCase.agents ?? Object.keys(config.agents);
    for (const agentId of caseAgents) {
      if (agentFilter !== undefined && !agentFilter.has(agentId)) continue;
      const agentConfig = config.agents[agentId];
      if (agentConfig === undefined) continue;
      const count = options.trials ?? testCase.trials ?? config.defaults.trials;
      for (let trial = 1; trial <= count; trial += 1) {
        trials.push({ index, caseConfig: testCase, agentId, agentConfig, trial });
        index += 1;
      }
    }
  }
  if (trials.length === 0) throw new ConfigError("The selected filters produce no trials");
  return {
    suiteName: config.name ?? path.basename(loaded.configDir),
    configPath: loaded.configPath,
    trials,
  };
}

function emptyProcess(error?: string): ProcessResult {
  return {
    command: "(not started)",
    args: [],
    exitCode: null,
    signal: null,
    timedOut: false,
    durationMs: 0,
    stdout: "",
    stderr: "",
    outputTruncated: false,
    ...(error === undefined ? {} : { spawnError: error }),
  };
}

function emit(options: RunOptions, event: RunEvent): void {
  try {
    options.onEvent?.(event);
  } catch {
    // Progress callbacks must not corrupt an evaluation run.
  }
}

function outputExcludes(fixturePath: string, outputDir: string): string[] {
  const relation = path.relative(fixturePath, outputDir);
  if (
    relation === "" ||
    relation === ".." ||
    relation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relation)
  ) {
    return [];
  }
  const posix = relation.split(path.sep).join("/");
  return [posix, `${posix}/**`];
}

async function runTrial(
  plan: TrialPlan,
  loaded: LoadedConfig,
  options: RunOptions,
  runId: string,
  outputDir: string,
): Promise<TrialResult> {
  emit(options, { type: "trial_started", plan });
  const startedAt = new Date();
  const trialId = `${plan.caseConfig.id}--${plan.agentId}--t${String(plan.trial).padStart(2, "0")}`;
  const artifactDir = path.join(outputDir, "runs", runId, trialId);
  const workspace = path.join(artifactDir, "workspace");
  const fixture = path.resolve(loaded.configDir, plan.caseConfig.fixture);
  const exclusions = [
    ...new Set([
      ...REQUIRED_EXCLUDES,
      ...loaded.config.defaults.copyExclude,
      ...outputExcludes(fixture, outputDir),
    ]),
  ];
  await mkdir(artifactDir, { recursive: true });

  let rawProcess = emptyProcess();
  let changes: TrialResult["changes"] = [];
  let assertions: TrialResult["assertions"] = [];
  let unexpectedError: string | undefined;

  try {
    await copyFixture(fixture, workspace, exclusions);
    await initializeGitWorkspace(workspace);
    const before = await snapshotWorkspace(workspace, exclusions);
    const context = {
      prompt: plan.caseConfig.prompt,
      workspace,
      configDir: loaded.configDir,
      caseId: plan.caseConfig.id,
      agentId: plan.agentId,
      trial: plan.trial,
      runId,
    };
    const resolved = resolveAgentCommand(plan.agentConfig, context);
    rawProcess = await runProcess({
      command: resolved.command,
      args: resolved.args,
      cwd: workspace,
      env: childEnvironment(resolved.passEnv, {
        ...resolved.env,
        HARNESSCHECK: "1",
        HARNESSCHECK_RUN_ID: runId,
        HARNESSCHECK_CASE_ID: plan.caseConfig.id,
        HARNESSCHECK_AGENT_ID: plan.agentId,
        HARNESSCHECK_TRIAL: String(plan.trial),
      }),
      ...(resolved.stdin === undefined ? {} : { stdin: resolved.stdin }),
      timeoutMs: plan.caseConfig.timeoutMs ?? loaded.config.defaults.timeoutMs,
      maxOutputBytes: loaded.config.defaults.maxOutputBytes,
    });
    const after = await snapshotWorkspace(workspace, exclusions);
    changes = diffSnapshots(before, after);
    assertions = await evaluateAssertions(plan.caseConfig.assertions, {
      workspace,
      process: rawProcess,
      changes,
      defaultTimeoutMs: loaded.config.defaults.assertionTimeoutMs,
      maxOutputBytes: loaded.config.defaults.maxOutputBytes,
      redact: loaded.config.defaults.redact,
    });
  } catch (error) {
    unexpectedError = error instanceof Error ? error.message : String(error);
  }

  const redact = loaded.config.defaults.redact;
  const processResult: ProcessResult = {
    ...rawProcess,
    command: sanitizeOutput(rawProcess.command, redact),
    args: rawProcess.args.map((argument) => sanitizeOutput(argument, redact)),
    stdout: sanitizeOutput(rawProcess.stdout, redact),
    stderr: sanitizeOutput(rawProcess.stderr, redact),
    ...(rawProcess.spawnError === undefined
      ? {}
      : { spawnError: sanitizeOutput(rawProcess.spawnError, redact) }),
  };
  const processFailed =
    rawProcess.spawnError !== undefined || rawProcess.timedOut || rawProcess.exitCode !== 0;
  const status: TrialResult["status"] =
    unexpectedError === undefined
      ? processFailed || assertions.some((assertion) => !assertion.passed)
        ? "failed"
        : "passed"
      : "error";

  const keep = options.keep ?? loaded.config.defaults.keep;
  const keepWorkspace = keep === "always" || (keep === "failures" && status !== "passed");
  if (!keepWorkspace) await rm(workspace, { recursive: true, force: true });
  const finishedAt = new Date();
  const result: TrialResult = {
    index: plan.index,
    id: trialId,
    caseId: plan.caseConfig.id,
    ...(plan.caseConfig.description === undefined
      ? {}
      : { caseDescription: plan.caseConfig.description }),
    agentId: plan.agentId,
    trial: plan.trial,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    fixture: plan.caseConfig.fixture,
    ...(keepWorkspace ? { workspacePath: workspace } : {}),
    process: processResult,
    changes,
    assertions,
    ...(unexpectedError === undefined ? {} : { error: sanitizeOutput(unexpectedError, redact) }),
  };

  await Promise.all([
    writeFile(path.join(artifactDir, "stdout.log"), processResult.stdout, "utf8"),
    writeFile(path.join(artifactDir, "stderr.log"), processResult.stderr, "utf8"),
    writeFile(path.join(artifactDir, "trial.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8"),
  ]);
  emit(options, { type: "trial_finished", plan, result });
  return result;
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      const value = values[index];
      if (value !== undefined) results[index] = await mapper(value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

export async function runHarness(options: RunOptions = {}): Promise<RunResult> {
  const loaded = await loadConfig(options.configPath);
  const plan = createRunPlan(loaded, options);
  const runId = options.runId ?? makeRunId();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(runId)) {
    throw new ConfigError(
      "Run ids must be 1-80 characters using only letters, numbers, dots, dashes, or underscores",
    );
  }
  const outputSetting = options.outputDir ?? loaded.config.defaults.outputDir;
  const outputDir = path.isAbsolute(outputSetting)
    ? outputSetting
    : path.resolve(loaded.configDir, outputSetting);
  for (const testCase of loaded.config.cases) {
    const fixturePath = path.resolve(loaded.configDir, testCase.fixture);
    if (fixturePath === outputDir) {
      throw new ConfigError(`Output directory cannot be the same as fixture ${testCase.fixture}`);
    }
  }
  const concurrency = options.concurrency ?? loaded.config.defaults.concurrency;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new ConfigError("--concurrency must be an integer between 1 and 32");
  }
  const startedAt = new Date();
  await mkdir(path.join(outputDir, "runs", runId), { recursive: true });

  const trials = await mapConcurrent(plan.trials, concurrency, async (trial) => {
    return await runTrial(trial, loaded, options, runId, outputDir);
  });
  trials.sort((left, right) => left.index - right.index);
  const finishedAt = new Date();
  const passed = trials.filter((trial) => trial.status === "passed").length;
  const failed = trials.filter((trial) => trial.status === "failed").length;
  const errors = trials.filter((trial) => trial.status === "error").length;
  const result: RunResult = {
    schemaVersion: 1,
    runId,
    suiteName: plan.suiteName,
    configPath: loaded.configPath,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    redacted: loaded.config.defaults.redact,
    summary: {
      total: trials.length,
      passed,
      failed,
      errors,
      passRate: trials.length === 0 ? 0 : (passed / trials.length) * 100,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    },
    trials,
    reports: { json: "", html: "", junit: "", markdown: "" },
  };
  result.reports = await writeReports(result, path.join(outputDir, "reports", runId));
  return result;
}
