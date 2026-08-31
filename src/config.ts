import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { ConfigError } from "./errors.js";
import { harnessConfigSchema } from "./schema.js";
import type { HarnessConfig, LoadedConfig } from "./types.js";

const CONFIG_CANDIDATES = ["harnesscheck.yaml", "harnesscheck.yml"];

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function findConfig(startDirectory = process.cwd()): Promise<string> {
  let directory = path.resolve(startDirectory);
  while (true) {
    for (const candidate of CONFIG_CANDIDATES) {
      const filePath = path.join(directory, candidate);
      if (await exists(filePath)) return filePath;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new ConfigError(
    `No harnesscheck.yaml found from ${path.resolve(startDirectory)} upward. Run "harnesscheck init" first.`,
  );
}

function formatZodIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "configuration";
      return `  - ${location}: ${issue.message}`;
    })
    .join("\n");
}

export async function loadConfig(configPath?: string): Promise<LoadedConfig> {
  const resolvedPath = configPath ? path.resolve(configPath) : await findConfig(process.cwd());

  let source: string;
  try {
    source = await readFile(resolvedPath, "utf8");
  } catch (error) {
    throw new ConfigError(`Cannot read configuration at ${resolvedPath}`, { cause: error });
  }

  let raw: unknown;
  try {
    raw = parseYaml(source, { maxAliasCount: 100, prettyErrors: true, strict: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Invalid YAML in ${resolvedPath}: ${detail}`, { cause: error });
  }

  const result = harnessConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(
      `Invalid HarnessCheck configuration at ${resolvedPath}:\n${formatZodIssues(result.error.issues)}`,
    );
  }

  return {
    config: result.data as HarnessConfig,
    configPath: resolvedPath,
    configDir: path.dirname(resolvedPath),
  };
}
