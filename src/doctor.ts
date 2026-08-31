import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { ADAPTER_PROFILES } from "./adapters.js";
import { findConfig, loadConfig } from "./config.js";
import type { AgentConfig, CaseConfig, DoctorCheck, DoctorResult, HarnessConfig } from "./types.js";

export interface DoctorOptions {
  cwd?: string;
  configPath?: string;
}

const MINIMUM_NODE_VERSION = { major: 20, minor: 12, patch: 0 } as const;
const INTERPRETER_COMMANDS = new Set([
  "node",
  "bun",
  "deno",
  "tsx",
  "python",
  "python3",
  "bash",
  "sh",
  "zsh",
]);

function parseVersion(
  version: string,
): { major: number; minor: number; patch: number } | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersions(
  left: { major: number; minor: number; patch: number },
  right: { major: number; minor: number; patch: number },
): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

function isPathLike(value: string): boolean {
  return (
    value.startsWith(".") || value.startsWith("/") || value.includes("/") || value.includes("\\")
  );
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

function displayPath(baseDir: string, filePath: string): string {
  const relative = path.relative(baseDir, filePath);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return toPosixPath(relative || ".");
  return toPosixPath(filePath);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function canExecute(filePath: string): Promise<boolean> {
  try {
    await access(filePath, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolvePathOnPath(command: string): Promise<string | undefined> {
  const pathValue = process.env.PATH;
  if (!pathValue) return undefined;

  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];

  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, extension ? `${command}${extension}` : command);
      if (await canExecute(candidate)) return candidate;
    }
  }

  return undefined;
}

async function resolveCommandPath(
  command: string,
  configDir: string,
  fixtureDirs: string[],
): Promise<string | undefined> {
  if (path.isAbsolute(command)) {
    return (await canExecute(command)) ? command : undefined;
  }

  if (isPathLike(command)) {
    const candidates = [
      path.resolve(configDir, command),
      ...fixtureDirs.map((fixtureDir) => path.resolve(fixtureDir, command)),
    ];
    for (const candidate of candidates) {
      if (await canExecute(candidate)) return candidate;
    }
    return undefined;
  }

  return resolvePathOnPath(command);
}

async function resolveSupportPath(
  entrypoint: string,
  configDir: string,
  fixtureDirs: string[],
): Promise<string | undefined> {
  if (path.isAbsolute(entrypoint)) {
    return (await fileExists(entrypoint)) ? entrypoint : undefined;
  }

  const candidates = [
    path.resolve(configDir, entrypoint),
    ...fixtureDirs.map((fixtureDir) => path.resolve(fixtureDir, entrypoint)),
  ];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return undefined;
}

function casesForAgent(config: HarnessConfig, agentId: string): CaseConfig[] {
  return config.cases.filter(
    (testCase) => testCase.agents === undefined || testCase.agents.includes(agentId),
  );
}

function getFixtureDirectories(configDir: string, cases: CaseConfig[]): string[] {
  return cases.map((testCase) => path.resolve(configDir, testCase.fixture));
}

function formatCommand(agent: AgentConfig): string {
  const command = agent.command ?? agent.adapter ?? "unknown";
  return [command, ...(agent.args ?? [])].join(" ").trim();
}

async function checkFixture(configDir: string, testCase: CaseConfig): Promise<DoctorCheck> {
  const fixturePath = path.resolve(configDir, testCase.fixture);
  try {
    const fixtureStat = await stat(fixturePath);
    if (!fixtureStat.isDirectory()) {
      return {
        name: `fixture:${testCase.id}`,
        status: "fail",
        message: `${toPosixPath(testCase.fixture)} exists but is not a directory`,
      };
    }

    return {
      name: `fixture:${testCase.id}`,
      status: "pass",
      message: `${toPosixPath(testCase.fixture)} is available`,
    };
  } catch {
    return {
      name: `fixture:${testCase.id}`,
      status: "fail",
      message: `${toPosixPath(testCase.fixture)} is missing`,
    };
  }
}

async function checkAgent(
  agentId: string,
  agent: AgentConfig,
  configDir: string,
  config: HarnessConfig,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const relatedCases = casesForAgent(config, agentId);
  const fixtureDirs = getFixtureDirectories(configDir, relatedCases);

  const profile =
    agent.adapter && agent.adapter !== "custom" ? ADAPTER_PROFILES[agent.adapter] : undefined;
  const effectiveAgent: AgentConfig = {
    ...agent,
    ...(agent.command === undefined && profile ? { command: profile.command } : {}),
    ...(agent.args === undefined && profile ? { args: profile.args } : {}),
  };
  if (effectiveAgent.command === undefined) {
    checks.push({
      name: `agent:${agentId}`,
      status: "fail",
      message: "Custom agent is missing a command",
    });
    return checks;
  }

  const resolvedCommand = await resolveCommandPath(effectiveAgent.command, configDir, fixtureDirs);
  if (resolvedCommand) {
    checks.push({
      name: `agent:${agentId}`,
      status: "pass",
      message: `${formatCommand(effectiveAgent)} resolves via ${displayPath(configDir, resolvedCommand)}`,
    });
  } else {
    checks.push({
      name: `agent:${agentId}`,
      status: "fail",
      message: `Cannot resolve executable for ${formatCommand(effectiveAgent)}`,
    });
  }

  const firstArg = effectiveAgent.args?.[0];
  const commandBase = path.basename(effectiveAgent.command).toLowerCase();
  if (firstArg && isPathLike(firstArg) && INTERPRETER_COMMANDS.has(commandBase)) {
    const resolvedEntrypoint = await resolveSupportPath(firstArg, configDir, fixtureDirs);
    checks.push({
      name: `agent:${agentId}:entrypoint`,
      status: resolvedEntrypoint ? "pass" : "fail",
      message: resolvedEntrypoint
        ? `${firstArg} resolves via ${displayPath(configDir, resolvedEntrypoint)}`
        : `Cannot find script or entrypoint ${firstArg}`,
    });
  }

  for (const variable of effectiveAgent.passEnv ?? []) {
    checks.push({
      name: `agent:${agentId}:env:${variable}`,
      status: process.env[variable] === undefined ? "warn" : "pass",
      message:
        process.env[variable] === undefined
          ? `${variable} is requested by passEnv but is not set`
          : `${variable} is available for explicit pass-through`,
    });
  }

  return checks;
}

async function findExistingAncestor(targetPath: string): Promise<string | undefined> {
  let currentPath = targetPath;
  while (true) {
    try {
      const currentStat = await stat(currentPath);
      return currentStat.isDirectory() ? currentPath : undefined;
    } catch {
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) return undefined;
      currentPath = parentPath;
    }
  }
}

async function checkOutputDirectory(configDir: string, outputDir: string): Promise<DoctorCheck> {
  const resolvedOutputDir = path.resolve(configDir, outputDir);

  try {
    const outputStat = await stat(resolvedOutputDir);
    if (!outputStat.isDirectory()) {
      return {
        name: "output",
        status: "fail",
        message: `${displayPath(configDir, resolvedOutputDir)} exists but is not a directory`,
      };
    }

    try {
      await access(resolvedOutputDir, constants.W_OK);
      return {
        name: "output",
        status: "pass",
        message: `${displayPath(configDir, resolvedOutputDir)} is writable`,
      };
    } catch {
      return {
        name: "output",
        status: "fail",
        message: `${displayPath(configDir, resolvedOutputDir)} exists but is not writable`,
      };
    }
  } catch {
    const ancestor = await findExistingAncestor(path.dirname(resolvedOutputDir));
    if (!ancestor) {
      return {
        name: "output",
        status: "fail",
        message: `Cannot determine a writable parent for ${displayPath(configDir, resolvedOutputDir)}`,
      };
    }

    try {
      await access(ancestor, constants.W_OK);
      return {
        name: "output",
        status: "pass",
        message: `${displayPath(configDir, resolvedOutputDir)} will be created on demand`,
      };
    } catch {
      return {
        name: "output",
        status: "fail",
        message: `Cannot write ${displayPath(configDir, resolvedOutputDir)}`,
      };
    }
  }
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const currentVersion = parseVersion(process.versions.node);
  const minimumVersion = `${MINIMUM_NODE_VERSION.major}.${MINIMUM_NODE_VERSION.minor}.${MINIMUM_NODE_VERSION.patch}`;

  if (!currentVersion) {
    checks.push({
      name: "node",
      status: "warn",
      message: `Could not parse running Node version ${process.versions.node}`,
    });
  } else {
    const versionStatus =
      compareVersions(currentVersion, MINIMUM_NODE_VERSION) >= 0 ? "pass" : "fail";
    checks.push({
      name: "node",
      status: versionStatus,
      message: `Running Node ${process.versions.node}; expected >= ${minimumVersion}`,
    });
  }

  let resolvedConfigPath: string;
  try {
    resolvedConfigPath = options.configPath
      ? path.resolve(cwd, options.configPath)
      : await findConfig(cwd);
  } catch (error) {
    checks.push({
      name: "config",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, checks };
  }

  let loadedConfig;
  try {
    loadedConfig = await loadConfig(resolvedConfigPath);
  } catch (error) {
    checks.push({
      name: "config",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, checks };
  }

  checks.push({
    name: "config",
    status: "pass",
    message: `${displayPath(cwd, loadedConfig.configPath)} loaded successfully`,
  });

  for (const testCase of loadedConfig.config.cases) {
    checks.push(await checkFixture(loadedConfig.configDir, testCase));
  }

  for (const [agentId, agent] of Object.entries(loadedConfig.config.agents)) {
    checks.push(...(await checkAgent(agentId, agent, loadedConfig.configDir, loadedConfig.config)));
  }

  checks.push(
    await checkOutputDirectory(loadedConfig.configDir, loadedConfig.config.defaults.outputDir),
  );

  return {
    ok: checks.every((check) => check.status !== "fail"),
    checks,
  };
}
