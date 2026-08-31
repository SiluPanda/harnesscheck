import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ADAPTER_PROFILES, resolveAgentCommand } from "../src/adapters.js";
import { evaluateAssertion, evaluateAssertions } from "../src/assertions.js";
import { findConfig, loadConfig } from "../src/config.js";
import { ConfigError, HarnessCheckError } from "../src/errors.js";
import {
  childEnvironment,
  redactSecrets,
  runProcess,
  sanitizeOutput,
  stripAnsi,
} from "../src/process.js";
import { createRunPlan, runHarness } from "../src/runner.js";
import type { ProcessResult } from "../src/types.js";
import {
  assertNoSymlinkTraversal,
  copyFixture,
  diffSnapshots,
  readWorkspaceFile,
  resolveInside,
  snapshotWorkspace,
} from "../src/workspace.js";
import { rm } from "node:fs/promises";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix = "harnesscheck-test-"): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

function successfulProcess(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    command: "fixture-agent",
    args: [],
    exitCode: 0,
    signal: null,
    timedOut: false,
    durationMs: 10,
    stdout: "done\n",
    stderr: "",
    outputTruncated: false,
    ...overrides,
  };
}

describe("configuration", () => {
  test("loads defaults and discovers a config from a child directory", async () => {
    const root = await temporaryDirectory();
    const child = path.join(root, "a", "b");
    await mkdir(path.join(root, "fixture"), { recursive: true });
    await mkdir(child, { recursive: true });
    await writeFile(
      path.join(root, "harnesscheck.yaml"),
      [
        "version: 1",
        "agents:",
        "  fake:",
        "    command: node",
        "    args: ['-e', 'process.exit(0)']",
        "cases:",
        "  - id: smoke",
        "    fixture: fixture",
        "    prompt: run",
        "    assertions:",
        "      - type: changed_files",
        "        max: 0",
      ].join("\n"),
    );

    expect(await findConfig(child)).toBe(path.join(root, "harnesscheck.yaml"));
    const loaded = await loadConfig(path.join(root, "harnesscheck.yaml"));
    expect(loaded.config.defaults.timeoutMs).toBe(300_000);
    expect(loaded.config.defaults.redact).toBe(true);
    expect(loaded.config.agents.fake?.command).toBe("node");
  });

  test("reports precise schema and YAML errors", async () => {
    const root = await temporaryDirectory();
    const invalidSchema = path.join(root, "invalid.yaml");
    await writeFile(
      invalidSchema,
      "version: 1\nagents:\n  fake:\n    command: node\ncases:\n  - id: duplicate\n    fixture: .\n    prompt: x\n    agents: [missing]\n    assertions: []\n",
    );
    await expect(loadConfig(invalidSchema)).rejects.toThrow(/assertions|Unknown agent/);

    const invalidYaml = path.join(root, "broken.yaml");
    await writeFile(invalidYaml, "version: [\n");
    await expect(loadConfig(invalidYaml)).rejects.toThrow(/Invalid YAML/);
    await expect(findConfig(path.join(root, "nowhere"))).rejects.toBeInstanceOf(ConfigError);
  });
});

describe("agent adapters", () => {
  const context = {
    prompt: "add a test",
    workspace: "/tmp/work tree",
    configDir: "/tmp/config",
    caseId: "case-one",
    agentId: "custom",
    trial: 2,
    runId: "run-one",
  };

  test("interpolates custom command arguments and environment", () => {
    const resolved = resolveAgentCommand(
      {
        command: "node",
        args: ["{configDir}/agent.mjs", "{prompt}", "{caseId}:{trial}"],
        env: { RUN: "{runId}", WORKSPACE: "{workspace}" },
      },
      context,
    );
    expect(resolved).toMatchObject({
      adapter: "custom",
      command: "node",
      args: ["/tmp/config/agent.mjs", "add a test", "case-one:2"],
      env: { RUN: "run-one", WORKSPACE: "/tmp/work tree" },
    });
  });

  test("supports stdin and conservative built-in profiles", () => {
    const custom = resolveAgentCommand(
      { command: "agent", args: ["--case", "{caseId}"], stdin: true },
      context,
    );
    expect(custom.stdin).toBe("add a test");
    for (const adapter of ["codex", "claude", "gemini", "opencode"] as const) {
      const resolved = resolveAgentCommand({ adapter }, { ...context, agentId: adapter });
      expect(resolved.command).toBe(ADAPTER_PROFILES[adapter].command);
      expect(resolved.args.join(" ")).not.toContain("dangerously");
      expect(resolved.args.join(" ")).toContain("add a test");
    }
  });

  test("rejects a commandless custom agent", () => {
    expect(() => resolveAgentCommand({}, context)).toThrow(/no command/);
  });
});

describe("process execution and sanitization", () => {
  test("captures output and exit status without a shell", async () => {
    const cwd = await temporaryDirectory();
    const result = await runProcess({
      command: process.execPath,
      args: ["-e", "process.stdout.write('hello'); process.stderr.write('warn'); process.exit(3)"],
      cwd,
      timeoutMs: 5_000,
      maxOutputBytes: 1_000,
    });
    expect(result).toMatchObject({ exitCode: 3, stdout: "hello", stderr: "warn", timedOut: false });
  });

  test("times out a process group and bounds output", async () => {
    const cwd = await temporaryDirectory();
    const result = await runProcess({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(100)); setTimeout(() => {}, 5000)"],
      cwd,
      timeoutMs: 40,
      maxOutputBytes: 16,
    });
    expect(result.timedOut).toBe(true);
    expect(result.outputTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBe(16);
  });

  test("shares the output cap across stdout and stderr", async () => {
    const cwd = await temporaryDirectory();
    const result = await runProcess({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(100)); process.stderr.write('y'.repeat(100))"],
      cwd,
      timeoutMs: 5_000,
      maxOutputBytes: 16,
    });
    expect(result.outputTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBe(16);
  });

  test("strips ANSI and redacts common credential shapes", () => {
    const token = `ghp_${"a".repeat(24)}`;
    expect(stripAnsi("\u001B[31mred\u001B[0m")).toBe("red");
    expect(redactSecrets(`token=${token}`)).not.toContain(token);
    expect(sanitizeOutput(`\u001B[32m${token}\r\n`, true)).toBe("[REDACTED]\n");
    expect(sanitizeOutput(token, false)).toBe(token);
  });

  test("uses a minimal environment with explicit opt-in pass-through", () => {
    process.env.HARNESSCHECK_TEST_SECRET = "canary";
    try {
      expect(childEnvironment().HARNESSCHECK_TEST_SECRET).toBeUndefined();
      expect(childEnvironment(["HARNESSCHECK_TEST_SECRET"]).HARNESSCHECK_TEST_SECRET).toBe(
        "canary",
      );
      expect(childEnvironment([], { EXPLICIT: "yes" }).EXPLICIT).toBe("yes");
    } finally {
      delete process.env.HARNESSCHECK_TEST_SECRET;
    }
  });
});

describe("workspace isolation", () => {
  test("copies fixtures, honors exclusions, and computes changes", async () => {
    const root = await temporaryDirectory();
    const fixture = path.join(root, "fixture");
    const workspace = path.join(root, "workspace");
    await mkdir(path.join(fixture, "ignored"), { recursive: true });
    await writeFile(path.join(fixture, "keep.txt"), "before");
    await writeFile(path.join(fixture, "delete.txt"), "delete");
    await writeFile(path.join(fixture, "ignored", "skip.txt"), "skip");
    await copyFixture(fixture, workspace, ["ignored/**"]);
    expect(await readFile(path.join(workspace, "keep.txt"), "utf8")).toBe("before");
    await expect(readFile(path.join(workspace, "ignored", "skip.txt"), "utf8")).rejects.toThrow();

    const before = await snapshotWorkspace(workspace, []);
    await writeFile(path.join(workspace, "keep.txt"), "after");
    await writeFile(path.join(workspace, "created.txt"), "new");
    await rm(path.join(workspace, "delete.txt"));
    const after = await snapshotWorkspace(workspace, []);
    expect(diffSnapshots(before, after)).toEqual([
      { path: "created.txt", status: "created" },
      { path: "delete.txt", status: "deleted" },
      { path: "keep.txt", status: "modified" },
    ]);
  });

  test("blocks traversal and symlink reads", async () => {
    const root = await temporaryDirectory();
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    await writeFile(path.join(root, "secret.txt"), "secret");
    await symlink(path.join(root, "secret.txt"), path.join(workspace, "link.txt"));
    expect(() => resolveInside(workspace, "../secret.txt")).toThrow(HarnessCheckError);
    await expect(assertNoSymlinkTraversal(workspace, "link.txt")).rejects.toThrow(/symlink/);
    await expect(readWorkspaceFile(workspace, "link.txt")).rejects.toThrow(/symlink/);
    await expect(copyFixture(workspace, path.join(root, "copy"), [])).rejects.toThrow(
      /symbolic link/,
    );
  });
});

describe("assertions", () => {
  test("evaluates file, output, change, regex, and command assertions", async () => {
    const workspace = await temporaryDirectory();
    await writeFile(path.join(workspace, "result.txt"), "status=ok\n");
    const context = {
      workspace,
      process: successfulProcess({ stdout: "implemented\n", stderr: "quiet\n" }),
      changes: [{ path: "result.txt", status: "created" as const }],
      defaultTimeoutMs: 5_000,
      maxOutputBytes: 10_000,
      redact: true,
    };
    const results = await evaluateAssertions(
      [
        { type: "file_exists", path: "result.txt" },
        { type: "file_not_exists", path: "missing.txt" },
        { type: "file_contains", path: "result.txt", value: "ok" },
        { type: "file_not_contains", path: "result.txt", value: "bad" },
        { type: "file_matches", path: "result.txt", pattern: "status=o.", flags: "i" },
        { type: "stdout_contains", value: "implemented" },
        { type: "stderr_not_contains", value: "fatal" },
        { type: "changed_files", include: ["*.txt"], exclude: ["src/**"], min: 1, max: 1 },
        { type: "command_exit", command: process.execPath, args: ["-e", "process.exit(0)"] },
      ],
      context,
    );
    expect(results).toHaveLength(9);
    expect(results.every((assertion) => assertion.passed)).toBe(true);
  });

  test("returns useful failures instead of throwing", async () => {
    const workspace = await temporaryDirectory();
    await mkdir(path.join(workspace, "directory.txt"));
    const context = {
      workspace,
      process: successfulProcess({ stdout: "bad", stderr: "fatal" }),
      changes: [{ path: "secret.env", status: "created" as const }],
      defaultTimeoutMs: 100,
      maxOutputBytes: 10_000,
      redact: true,
    };
    const results = await evaluateAssertions(
      [
        { type: "file_exists", path: "missing" },
        { type: "file_exists", path: "directory.txt" },
        { type: "file_contains", path: "missing", value: "x" },
        { type: "stdout_not_contains", value: "bad" },
        { type: "stderr_contains", value: "other" },
        { type: "changed_files", include: ["src/**"], exclude: ["*.env"], min: 2, max: 0 },
        {
          type: "command_exit",
          command: process.execPath,
          args: ["-e", "process.exit(2)"],
          exitCode: 0,
        },
      ],
      context,
    );
    expect(results.every((assertion) => !assertion.passed)).toBe(true);
    const traversal = await evaluateAssertion({ type: "file_exists", path: "../nope" }, context);
    expect(traversal.passed).toBe(false);
  });

  test("treats changed_files include patterns as an allowlist and redacts command args", async () => {
    const workspace = await temporaryDirectory();
    const token = `sk-${"x".repeat(28)}`;
    const context = {
      workspace,
      process: successfulProcess(),
      changes: [
        { path: "src/index.ts", status: "modified" as const },
        { path: "docs/private.md", status: "created" as const },
      ],
      defaultTimeoutMs: 5_000,
      maxOutputBytes: 10_000,
      redact: true,
    };
    const changed = await evaluateAssertion(
      { type: "changed_files", include: ["src/**"] },
      context,
    );
    expect(changed).toMatchObject({ passed: false });
    expect(changed.message).toContain("docs/private.md");

    const command = await evaluateAssertion(
      {
        type: "command_exit",
        command: process.execPath,
        args: ["-e", "process.exit(0)", token],
      },
      context,
    );
    expect(JSON.stringify(command.details)).not.toContain(token);
    expect(JSON.stringify(command.details)).toContain("[REDACTED]");
  });
});

describe("runner", () => {
  test("runs the bundled demo end to end and writes every report", async () => {
    const output = await temporaryDirectory("harnesscheck-output-");
    const configPath = path.resolve("examples/todo-api/harnesscheck.yaml");
    const fixtureHealth = path.resolve("examples/todo-api/fixture/src/health.js");
    await expect(readFile(fixtureHealth, "utf8")).rejects.toThrow();

    const result = await runHarness({
      configPath,
      outputDir: output,
      runId: "demo-test",
      keep: "never",
    });
    expect(result.summary).toMatchObject({
      total: 2,
      passed: 2,
      failed: 0,
      errors: 0,
      passRate: 100,
    });
    expect(result.trials.every((trial) => trial.changes.length === 1)).toBe(true);
    for (const reportPath of Object.values(result.reports)) {
      expect((await readFile(reportPath, "utf8")).length).toBeGreaterThan(50);
    }
    expect(result.trials.every((trial) => trial.workspacePath === undefined)).toBe(true);
    await expect(readFile(fixtureHealth, "utf8")).rejects.toThrow();
  });

  test("plans filtered trials and rejects unsafe selection inputs", async () => {
    const loaded = await loadConfig(path.resolve("examples/todo-api/harnesscheck.yaml"));
    const plan = createRunPlan(loaded, {
      agents: ["fixture-agent"],
      cases: ["add-health-endpoint"],
      trials: 3,
    });
    expect(plan.trials).toHaveLength(3);
    expect(() => createRunPlan(loaded, { agents: ["missing"] })).toThrow(/Unknown agent/);
    expect(() => createRunPlan(loaded, { trials: 101 })).toThrow(/between 1 and 100/);
  });

  test("keeps a failed workspace and rejects path-like run ids", async () => {
    const root = await temporaryDirectory();
    const fixture = path.join(root, "fixture");
    await mkdir(fixture);
    await writeFile(path.join(fixture, "input.txt"), "unchanged");
    const configPath = path.join(root, "harnesscheck.yaml");
    await writeFile(
      configPath,
      [
        "version: 1",
        "agents:",
        "  failing:",
        "    command: node",
        "    args: ['-e', 'process.exit(3)']",
        "cases:",
        "  - id: failure",
        "    fixture: fixture",
        "    prompt: fail",
        "    assertions:",
        "      - type: file_exists",
        "        path: expected.txt",
      ].join("\n"),
    );
    const result = await runHarness({ configPath, runId: "failed-test", keep: "failures" });
    expect(result.summary).toMatchObject({ passed: 0, failed: 1, errors: 0, passRate: 0 });
    expect(result.trials[0]?.workspacePath).toBeTruthy();
    await expect(runHarness({ configPath, runId: "../../escape" })).rejects.toThrow(/Run ids/);
  });

  test("records setup failures as errored trials", async () => {
    const root = await temporaryDirectory();
    const configPath = path.join(root, "harnesscheck.yaml");
    await writeFile(
      configPath,
      [
        "version: 1",
        "agents:",
        "  fake:",
        "    command: node",
        "    args: ['-e', 'process.exit(0)']",
        "cases:",
        "  - id: missing-fixture",
        "    fixture: nowhere",
        "    prompt: run",
        "    assertions:",
        "      - type: file_exists",
        "        path: output.txt",
      ].join("\n"),
    );
    const result = await runHarness({ configPath, runId: "error-test", keep: "never" });
    expect(result.summary).toMatchObject({ total: 1, errors: 1 });
    expect(result.trials[0]?.error).toMatch(/Fixture directory does not exist/);
  });
});
