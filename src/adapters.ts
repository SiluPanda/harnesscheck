import type { AgentConfig, BuiltinAdapter } from "./types.js";

export interface AdapterProfile {
  id: Exclude<BuiltinAdapter, "custom">;
  command: string;
  args: string[];
  description: string;
}

export interface TemplateContext {
  prompt: string;
  workspace: string;
  configDir: string;
  caseId: string;
  agentId: string;
  trial: number;
  runId: string;
}

export interface ResolvedAgentCommand {
  adapter: BuiltinAdapter;
  command: string;
  args: string[];
  stdin?: string;
  env: Record<string, string>;
  passEnv: string[];
}

export const ADAPTER_PROFILES: Record<Exclude<BuiltinAdapter, "custom">, AdapterProfile> = {
  codex: {
    id: "codex",
    command: "codex",
    description:
      "OpenAI Codex CLI (automatic approval review in workspace-write, ephemeral session)",
    args: [
      "exec",
      "--approve-for-me",
      "--ephemeral",
      "--skip-git-repo-check",
      "--color",
      "never",
      "{prompt}",
    ],
  },
  claude: {
    id: "claude",
    command: "claude",
    description: "Claude Code (non-interactive, edit approval mode, no session persistence)",
    args: [
      "--print",
      "--permission-mode",
      "acceptEdits",
      "--no-session-persistence",
      "--output-format",
      "stream-json",
      "--verbose",
      "{prompt}",
    ],
  },
  gemini: {
    id: "gemini",
    command: "gemini",
    description: "Gemini CLI (headless, auto-edit approval mode)",
    args: [
      "--approval-mode",
      "auto_edit",
      "--output-format",
      "stream-json",
      "--prompt",
      "{prompt}",
    ],
  },
  opencode: {
    id: "opencode",
    command: "opencode",
    description: "OpenCode (non-interactive JSON run)",
    args: ["run", "--format", "json", "--dir", "{workspace}", "{prompt}"],
  },
};

function interpolate(value: string, context: TemplateContext): string {
  const replacements: Record<string, string> = {
    prompt: context.prompt,
    workspace: context.workspace,
    configDir: context.configDir,
    caseId: context.caseId,
    agentId: context.agentId,
    trial: String(context.trial),
    runId: context.runId,
  };
  return value.replace(
    /\{(prompt|workspace|configDir|caseId|agentId|trial|runId)\}/g,
    (_, key: string) => {
      return replacements[key] ?? "";
    },
  );
}

export function resolveAgentCommand(
  agentConfig: AgentConfig,
  context: TemplateContext,
): ResolvedAgentCommand {
  const adapter = agentConfig.adapter ?? "custom";
  const profile = adapter === "custom" ? undefined : ADAPTER_PROFILES[adapter];
  const commandTemplate = agentConfig.command ?? profile?.command;
  if (commandTemplate === undefined) throw new Error(`Agent ${context.agentId} has no command`);
  let argumentTemplates = agentConfig.args ?? profile?.args ?? [];
  if (agentConfig.stdin === true) {
    argumentTemplates = argumentTemplates.filter((argument) => argument !== "{prompt}");
  }
  const env = Object.fromEntries(
    Object.entries(agentConfig.env ?? {}).map(([key, value]) => [key, interpolate(value, context)]),
  );
  return {
    adapter,
    command: interpolate(commandTemplate, context),
    args: argumentTemplates.map((argument) => interpolate(argument, context)),
    ...(agentConfig.stdin === true ? { stdin: context.prompt } : {}),
    env,
    passEnv: agentConfig.passEnv ?? [],
  };
}
