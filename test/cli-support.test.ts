import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { runDoctor } from "../src/doctor.js";
import { initHarness } from "../src/init.js";
import { MemoryTerminal } from "../src/terminal.js";

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harnesscheck-cli-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("initHarness", () => {
  it("creates the starter scaffold and only overwrites with --force", async () => {
    const cwd = await createTempDirectory();

    const first = await initHarness({ cwd });
    expect(first.created).toEqual([
      "harnesscheck.yaml",
      "fixtures/hello-world/TASK.md",
      "fixtures/hello-world/fake-agent.mjs",
      "fixtures/hello-world/README.md",
    ]);
    expect(first.skipped).toEqual([]);

    const taskFile = path.join(cwd, "fixtures", "hello-world", "TASK.md");
    await writeFile(taskFile, "custom task\n", "utf8");

    const second = await initHarness({ cwd });
    expect(second.created).toEqual([]);
    expect(second.skipped).toContain("fixtures/hello-world/TASK.md");
    expect(await readFile(taskFile, "utf8")).toBe("custom task\n");

    const third = await initHarness({ cwd, force: true });
    expect(third.created).toContain("fixtures/hello-world/TASK.md");
    expect(await readFile(taskFile, "utf8")).toContain("Create a file named `result.txt`");
  });
});

describe("runDoctor", () => {
  it("passes against the generated starter scaffold", async () => {
    const cwd = await createTempDirectory();
    await initHarness({ cwd });

    const result = await runDoctor({ cwd });
    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "node",
        "config",
        "fixture:hello-world",
        "agent:fake",
        "agent:fake:entrypoint",
        "output",
      ]),
    );
    expect(result.checks.find((check) => check.name === "agent:fake")?.status).toBe("pass");
    expect(result.checks.find((check) => check.name === "agent:fake:entrypoint")?.status).toBe(
      "pass",
    );
  });
});

describe("runCli", () => {
  it("lists filtered cases and agents in JSON mode", async () => {
    const cwd = await createTempDirectory();
    await initHarness({ cwd });

    const terminal = new MemoryTerminal();
    const exitCode = await runCli(
      ["node", "harnesscheck", "--json", "list", "--agent", "fake", "--case", "hello*"],
      {
        cwd,
        terminal,
      },
    );

    expect(exitCode).toBe(0);
    expect(terminal.stderrText).toBe("");

    const payload = JSON.parse(terminal.stdoutText) as {
      suiteName: string;
      agents: Array<{ id: string }>;
      cases: Array<{ id: string }>;
    };

    expect(payload.suiteName).toBe("starter-suite");
    expect(payload.agents).toEqual([expect.objectContaining({ id: "fake" })]);
    expect(payload.cases).toEqual([expect.objectContaining({ id: "hello-world" })]);
  });

  it("returns a failing exit code for doctor when configuration is missing", async () => {
    const cwd = await createTempDirectory();
    const terminal = new MemoryTerminal();

    const exitCode = await runCli(["node", "harnesscheck", "--json", "doctor"], { cwd, terminal });
    expect(exitCode).toBe(1);

    const payload = JSON.parse(terminal.stdoutText) as {
      ok: boolean;
      checks: Array<{ name: string; status: string }>;
    };

    expect(payload.ok).toBe(false);
    expect(payload.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "config", status: "fail" })]),
    );
  });
});
