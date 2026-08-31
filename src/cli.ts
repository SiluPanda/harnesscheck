#!/usr/bin/env node

import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command, CommanderError, Option } from "commander";
import { minimatch } from "minimatch";
import { findConfig, loadConfig } from "./config.js";
import { runDoctor } from "./doctor.js";
import { ConfigError, HarnessCheckError } from "./errors.js";
import { initHarness } from "./init.js";
import { HARNESSCHECK_JSON_SCHEMA } from "./schema.js";
import {
  ConsoleTerminal,
  formatDuration,
  formatErrorMessage,
  renderDefaultRunSummary,
  renderDoctorSummary,
  renderPlanSummary,
  type Terminal,
} from "./terminal.js";
import type {
  AgentConfig,
  CaseConfig,
  KeepPolicy,
  LoadedConfig,
  RunOptions,
  RunPlan,
  RunResult,
} from "./types.js";

interface GlobalOptions {
  config?: string;
  json?: boolean;
}

interface InitCommandOptions {
  force?: boolean;
}

interface FilterCommandOptions {
  agent?: string[];
  case?: string[];
}

interface RunCommandOptions extends FilterCommandOptions {
  trials?: number;
  concurrency?: number;
  keep?: KeepPolicy;
  outputDir?: string;
  runId?: string;
  dryRun?: boolean;
}

interface CliRuntimeOptions {
  cwd?: string;
  terminal?: Terminal;
  onExitCode?: (exitCode: number) => void;
}

interface ListJsonResult {
  suiteName: string;
  configPath: string;
  agents: Array<{
    id: string;
    adapter: AgentConfig["adapter"];
    command?: string;
    description?: string;
  }>;
  cases: Array<{
    id: string;
    description?: string;
    fixture: string;
    agents?: string[];
    trials?: number;
    assertions: number;
  }>;
}

type RunnerModule = Partial<{
  runHarness: (options: RunOptions) => Promise<RunResult>;
  createRunPlan: (loaded: LoadedConfig, options?: RunOptions) => RunPlan;
}>;

type ReporterModule = Partial<{
  renderTerminalSummary: (result: RunResult) => string;
}>;

function splitPatterns(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function collectPatterns(value: string, previous: string[]): string[] {
  return [...previous, ...splitPatterns(value)];
}

export function filterIdentifiers(ids: string[], patterns: string[], label: string): string[] {
  if (patterns.length === 0) return [...ids];

  const matched = ids.filter((id) => patterns.some((pattern) => minimatch(id, pattern)));
  if (matched.length === 0) {
    throw new ConfigError(
      `No ${label} matched filter${patterns.length === 1 ? "" : "s"}: ${patterns.join(", ")}`,
    );
  }
  return matched;
}

async function resolveConfigPath(input: string | undefined, cwd: string): Promise<string> {
  return input ? path.resolve(cwd, input) : findConfig(cwd);
}

async function loadCommandConfig(command: Command, cwd: string): Promise<LoadedConfig> {
  const globals = command.optsWithGlobals<GlobalOptions>();
  const configPath = await resolveConfigPath(globals.config, cwd);
  return loadConfig(configPath);
}

function getSuiteName(config: LoadedConfig): string {
  return config.config.name ?? path.basename(config.configDir);
}

function selectCases(config: LoadedConfig, patterns: string[]): CaseConfig[] {
  if (patterns.length === 0) return [...config.config.cases];
  const selectedIds = new Set(
    filterIdentifiers(
      config.config.cases.map((testCase) => testCase.id),
      patterns,
      "cases",
    ),
  );
  return config.config.cases.filter((testCase) => selectedIds.has(testCase.id));
}

function selectAgents(config: LoadedConfig, patterns: string[]): string[] {
  const agentIds = Object.keys(config.config.agents);
  return filterIdentifiers(agentIds, patterns, "agents");
}

function renderAgentSummary(agentId: string, agent: AgentConfig): string {
  const commandParts = agent.command ? [agent.command, ...(agent.args ?? [])].join(" ") : undefined;
  if (commandParts) return `${agentId} — ${commandParts}`;
  if (agent.adapter) return `${agentId} — adapter=${agent.adapter}`;
  return agentId;
}

function getAgentConfig(loadedConfig: LoadedConfig, agentId: string): AgentConfig {
  const agent = loadedConfig.config.agents[agentId];
  if (!agent) throw new ConfigError(`Unknown agent in configuration: ${agentId}`);
  return agent;
}

function renderListSummary(
  loadedConfig: LoadedConfig,
  agentIds: string[],
  cases: CaseConfig[],
): string {
  const lines = [`Suite: ${getSuiteName(loadedConfig)}`, `Config: ${loadedConfig.configPath}`, ""];

  lines.push(`Agents (${agentIds.length}):`);
  for (const agentId of agentIds) {
    lines.push(`  - ${renderAgentSummary(agentId, getAgentConfig(loadedConfig, agentId))}`);
  }

  lines.push("", `Cases (${cases.length}):`);
  for (const testCase of cases) {
    const targetAgents = testCase.agents?.join(", ") ?? "all agents";
    const details = [
      `fixture=${testCase.fixture}`,
      `agents=${targetAgents}`,
      `assertions=${testCase.assertions.length}`,
    ];
    lines.push(`  - ${testCase.id} — ${details.join(" ")}`);
  }

  return lines.join("\n");
}

function buildListJson(
  loadedConfig: LoadedConfig,
  agentIds: string[],
  cases: CaseConfig[],
): ListJsonResult {
  return {
    suiteName: getSuiteName(loadedConfig),
    configPath: loadedConfig.configPath,
    agents: agentIds.map((id) => {
      const agent = getAgentConfig(loadedConfig, id);
      return {
        id,
        adapter: agent.adapter,
        ...(agent.command ? { command: agent.command } : {}),
        ...(agent.description ? { description: agent.description } : {}),
      };
    }),
    cases: cases.map((testCase) => ({
      id: testCase.id,
      ...(testCase.description ? { description: testCase.description } : {}),
      fixture: testCase.fixture,
      ...(testCase.agents ? { agents: [...testCase.agents] } : {}),
      ...(testCase.trials ? { trials: testCase.trials } : {}),
      assertions: testCase.assertions.length,
    })),
  };
}

function buildRunOptions(
  loadedConfig: LoadedConfig,
  options: RunCommandOptions,
  selectedAgentIds: string[],
  selectedCases: CaseConfig[],
): RunOptions {
  return {
    configPath: loadedConfig.configPath,
    ...(options.agent && options.agent.length > 0 ? { agents: selectedAgentIds } : {}),
    ...(options.case && options.case.length > 0
      ? { cases: selectedCases.map((testCase) => testCase.id) }
      : {}),
    ...(options.trials !== undefined ? { trials: options.trials } : {}),
    ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
    ...(options.keep !== undefined ? { keep: options.keep } : {}),
    ...(options.outputDir !== undefined ? { outputDir: options.outputDir } : {}),
    ...(options.runId !== undefined ? { runId: options.runId } : {}),
    ...(options.dryRun ? { dryRun: true } : {}),
  };
}

function isDirectExecution(moduleUrl: string): boolean {
  const entrypoint = process.argv[1];
  if (!entrypoint) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(path.resolve(entrypoint));
  } catch {
    return false;
  }
}

function isMissingModuleError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("Cannot find module") || error.message.includes("ERR_MODULE_NOT_FOUND"))
  );
}

async function importFirstAvailable<T>(moduleUrls: URL[]): Promise<T | undefined> {
  for (const moduleUrl of moduleUrls) {
    try {
      return (await import(moduleUrl.href)) as T;
    } catch (error) {
      if (isMissingModuleError(error)) continue;
      throw error;
    }
  }
  return undefined;
}

async function loadRunnerModule(): Promise<
  Required<Pick<RunnerModule, "runHarness" | "createRunPlan">>
> {
  const module = await importFirstAvailable<RunnerModule>([
    new URL("./runner.js", import.meta.url),
    new URL("./index.js", import.meta.url),
  ]);

  if (!module?.runHarness || !module.createRunPlan) {
    throw new HarnessCheckError(
      "Run support is not available yet. Expected runHarness() and createRunPlan() from src/runner.ts (or re-exported by src/index.ts).",
    );
  }

  return {
    runHarness: module.runHarness,
    createRunPlan: module.createRunPlan,
  };
}

async function loadReporterModule(): Promise<ReporterModule | undefined> {
  return importFirstAvailable<ReporterModule>([
    new URL("./reporters/index.js", import.meta.url),
    new URL("./index.js", import.meta.url),
  ]);
}

function getRunExitCode(result: RunResult): number {
  return result.summary.failed === 0 && result.summary.errors === 0 ? 0 : 1;
}

async function renderRunSummary(result: RunResult, terminal: Terminal): Promise<string> {
  const reporters = await loadReporterModule();
  if (reporters?.renderTerminalSummary) return reporters.renderTerminalSummary(result);
  return renderDefaultRunSummary(result, terminal.color);
}

export function createProgram(runtime: CliRuntimeOptions = {}): Command {
  const terminal = runtime.terminal ?? new ConsoleTerminal();
  const cwd = path.resolve(runtime.cwd ?? process.cwd());
  const setExitCode = runtime.onExitCode ?? (() => undefined);

  const program = new Command();
  program.name("harnesscheck");
  program.description("Deterministic regression tests for AI coding-agent behavior.");
  program.option("-c, --config <path>", "Path to harnesscheck.yaml");
  program.option("--json", "Emit JSON output where supported");
  program.showHelpAfterError();
  program.showSuggestionAfterError();
  program.configureOutput({
    writeOut: (message) => terminal.write(message),
    writeErr: (message) => terminal.error(message),
    outputError: (message, write) => write(message),
  });
  program.hook("preAction", (_command, actionCommand) => {
    terminal.setJsonMode(Boolean(actionCommand.optsWithGlobals<GlobalOptions>().json));
  });

  program
    .command("init")
    .description("Create a starter harnesscheck.yaml and example fixture")
    .option("-f, --force", "Overwrite starter files if they already exist")
    .action(async (options: InitCommandOptions) => {
      const result = await initHarness({ cwd, force: options.force ?? false });
      if (terminal.json) {
        terminal.printJson(result);
        return;
      }

      const lines = [`Initialized HarnessCheck in ${result.rootDir}`];
      if (result.created.length > 0) {
        lines.push("Created:");
        for (const filePath of result.created) lines.push(`  - ${filePath}`);
      }
      if (result.skipped.length > 0) {
        lines.push("Skipped existing files:");
        for (const filePath of result.skipped) lines.push(`  - ${filePath}`);
        lines.push("Re-run with --force to overwrite starter files.");
      }
      terminal.write(lines.join("\n"));
    });

  program
    .command("list")
    .description("List configured agents and cases")
    .option("-a, --agent <pattern>", "Filter agents by id or glob", collectPatterns, [])
    .option("--case <pattern>", "Filter cases by id or glob", collectPatterns, [])
    .action(async (options: FilterCommandOptions) => {
      const loadedConfig = await loadCommandConfig(program, cwd);
      const selectedAgentIds = selectAgents(loadedConfig, options.agent ?? []);
      const selectedCases = selectCases(loadedConfig, options.case ?? []);

      if (terminal.json) {
        terminal.printJson(buildListJson(loadedConfig, selectedAgentIds, selectedCases));
        return;
      }

      terminal.write(renderListSummary(loadedConfig, selectedAgentIds, selectedCases));
    });

  program
    .command("doctor")
    .description("Check local setup, configuration, fixtures, and agent commands")
    .action(async () => {
      const configPath = await resolveConfigPath(program.opts<GlobalOptions>().config, cwd).catch(
        (): undefined => undefined,
      );
      const result = await runDoctor({ cwd, ...(configPath ? { configPath } : {}) });
      if (terminal.json) {
        terminal.printJson(result);
      } else {
        terminal.write(renderDoctorSummary(result, terminal.color));
      }

      if (!result.ok) setExitCode(1);
    });

  program
    .command("schema")
    .description("Print the JSON schema for harnesscheck.yaml")
    .action(() => {
      terminal.printJson(HARNESSCHECK_JSON_SCHEMA);
    });

  program
    .command("run")
    .description("Run the configured harness suite")
    .option("-a, --agent <pattern>", "Filter agents by id or glob", collectPatterns, [])
    .option("--case <pattern>", "Filter cases by id or glob", collectPatterns, [])
    .option(
      "-n, --trials <count>",
      "Override the number of trials per case",
      parseIntegerOption("trials"),
    )
    .option("--concurrency <count>", "Override concurrency", parseIntegerOption("concurrency"))
    .addOption(
      new Option("--keep <policy>", "Workspace retention policy: never, failures, always").choices([
        "never",
        "failures",
        "always",
      ]),
    )
    .option("--output-dir <path>", "Override the output directory")
    .option("--run-id <id>", "Use a custom run id")
    .option("--dry-run", "Show the resolved trial plan without executing it")
    .action(async (options: RunCommandOptions) => {
      const loadedConfig = await loadCommandConfig(program, cwd);
      const selectedAgentIds = selectAgents(loadedConfig, options.agent ?? []);
      const selectedCases = selectCases(loadedConfig, options.case ?? []);
      const runOptions = buildRunOptions(loadedConfig, options, selectedAgentIds, selectedCases);
      const runner = await loadRunnerModule();

      if (options.dryRun) {
        const plan = runner.createRunPlan(loadedConfig, runOptions);
        if (terminal.json) {
          terminal.printJson(plan);
        } else {
          terminal.write(renderPlanSummary(plan));
        }
        return;
      }

      const result = await runner.runHarness(runOptions);
      if (terminal.json) {
        terminal.printJson(result);
      } else {
        terminal.write(await renderRunSummary(result, terminal));
      }
      setExitCode(getRunExitCode(result));
    });

  return program;
}

function parseIntegerOption(label: string): (value: string) => number {
  return (value: string): number => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new CommanderError(
        2,
        "harnesscheck.invalidArgument",
        `${label} must be a positive integer.`,
      );
    }
    return parsed;
  };
}

export async function runCli(
  argv = process.argv,
  runtime: CliRuntimeOptions = {},
): Promise<number> {
  const terminal = runtime.terminal ?? new ConsoleTerminal();
  terminal.setJsonMode(argv.includes("--json"));

  let exitCode = 0;
  const program = createProgram({
    ...runtime,
    terminal,
    onExitCode: (value) => {
      exitCode = value;
      runtime.onExitCode?.(value);
    },
  });
  program.exitOverride();

  try {
    await program.parseAsync(argv);
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }

    const exitCode = error instanceof HarnessCheckError ? error.exitCode : 1;
    const message = formatErrorMessage(error);
    if (terminal.json) {
      terminal.printJson({ error: message, exitCode }, "stderr");
    } else {
      terminal.error(message);
    }
    return exitCode;
  }
}

if (isDirectExecution(import.meta.url)) {
  const terminal = new ConsoleTerminal();
  void runCli(process.argv, { terminal }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}

export { formatDuration };
