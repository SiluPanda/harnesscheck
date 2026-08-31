export type BuiltinAdapter = "codex" | "claude" | "gemini" | "opencode" | "custom";

export type KeepPolicy = "never" | "failures" | "always";

export interface AgentConfig {
  adapter?: BuiltinAdapter;
  command?: string;
  args?: string[];
  stdin?: boolean;
  env?: Record<string, string>;
  passEnv?: string[];
  description?: string;
}

export interface FileExistsAssertion {
  type: "file_exists";
  path: string;
}

export interface FileNotExistsAssertion {
  type: "file_not_exists";
  path: string;
}

export interface FileContainsAssertion {
  type: "file_contains";
  path: string;
  value: string;
}

export interface FileNotContainsAssertion {
  type: "file_not_contains";
  path: string;
  value: string;
}

export interface FileMatchesAssertion {
  type: "file_matches";
  path: string;
  pattern: string;
  flags?: string;
}

export interface CommandExitAssertion {
  type: "command_exit";
  command: string;
  args?: string[];
  exitCode?: number;
  timeoutMs?: number;
}

export interface ChangedFilesAssertion {
  type: "changed_files";
  include?: string[];
  exclude?: string[];
  min?: number;
  max?: number;
}

export interface OutputContainsAssertion {
  type: "stdout_contains" | "stdout_not_contains" | "stderr_contains" | "stderr_not_contains";
  value: string;
}

export type AssertionConfig =
  | FileExistsAssertion
  | FileNotExistsAssertion
  | FileContainsAssertion
  | FileNotContainsAssertion
  | FileMatchesAssertion
  | CommandExitAssertion
  | ChangedFilesAssertion
  | OutputContainsAssertion;

export interface CaseConfig {
  id: string;
  description?: string;
  fixture: string;
  prompt: string;
  agents?: string[];
  trials?: number;
  timeoutMs?: number;
  assertions: AssertionConfig[];
}

export interface DefaultsConfig {
  trials: number;
  timeoutMs: number;
  assertionTimeoutMs: number;
  concurrency: number;
  keep: KeepPolicy;
  redact: boolean;
  outputDir: string;
  copyExclude: string[];
  maxOutputBytes: number;
}

export interface HarnessConfig {
  version: 1;
  name?: string;
  defaults: DefaultsConfig;
  agents: Record<string, AgentConfig>;
  cases: CaseConfig[];
}

export interface LoadedConfig {
  config: HarnessConfig;
  configPath: string;
  configDir: string;
}

export interface FileFingerprint {
  path: string;
  kind: "file" | "symlink";
  hash: string;
  size: number;
  mode: number;
}

export interface FileChange {
  path: string;
  status: "created" | "modified" | "deleted";
}

export interface ProcessResult {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  spawnError?: string;
}

export interface AssertionResult {
  type: AssertionConfig["type"];
  passed: boolean;
  message: string;
  durationMs: number;
  details?: Record<string, unknown>;
}

export interface TrialPlan {
  index: number;
  caseConfig: CaseConfig;
  agentId: string;
  agentConfig: AgentConfig;
  trial: number;
}

export type TrialStatus = "passed" | "failed" | "error";

export interface TrialResult {
  index: number;
  id: string;
  caseId: string;
  caseDescription?: string;
  agentId: string;
  trial: number;
  status: TrialStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  fixture: string;
  workspacePath?: string;
  process: ProcessResult;
  changes: FileChange[];
  assertions: AssertionResult[];
  error?: string;
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  passRate: number;
  durationMs: number;
}

export interface RunResult {
  schemaVersion: 1;
  runId: string;
  suiteName: string;
  configPath: string;
  startedAt: string;
  finishedAt: string;
  redacted: boolean;
  summary: RunSummary;
  trials: TrialResult[];
  reports: {
    json: string;
    html: string;
    junit: string;
    markdown: string;
  };
}

export interface RunEvent {
  type: "trial_started" | "trial_finished";
  plan: TrialPlan;
  result?: TrialResult;
}

export interface RunOptions {
  configPath?: string;
  agents?: string[];
  cases?: string[];
  trials?: number;
  concurrency?: number;
  keep?: KeepPolicy;
  outputDir?: string;
  runId?: string;
  dryRun?: boolean;
  onEvent?: (event: RunEvent) => void;
}

export interface RunPlan {
  suiteName: string;
  configPath: string;
  trials: TrialPlan[];
}

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}
