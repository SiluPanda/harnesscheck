# Configuration reference

HarnessCheck discovers `harnesscheck.yaml` or `harnesscheck.yml` by walking upward from the current working directory. Once loaded, all relative paths resolve from the directory that contains that config file.

## Top-level shape

```yaml
version: 1
name: optional suite name
defaults:
  # optional run defaults
agents:
  # one or more agent definitions
cases:
  # one or more test cases
```

## Required fields

| Field      | Type        | Required | Notes                           |
| ---------- | ----------- | -------- | ------------------------------- |
| `version`  | literal `1` | yes      | Current schema version          |
| `agents`   | object      | yes      | Must contain at least one agent |
| `cases`    | array       | yes      | Must contain at least one case  |
| `name`     | string      | no       | Human-friendly suite name       |
| `defaults` | object      | no       | Run-wide defaults               |

## Defaults

When `defaults` is omitted, HarnessCheck loads these values:

| Key                  | Type                              | Default                                                                                       | Notes                                           |
| -------------------- | --------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `trials`             | integer                           | `1`                                                                                           | `1..100`                                        |
| `timeoutMs`          | integer                           | `300000`                                                                                      | per-agent execution timeout                     |
| `assertionTimeoutMs` | integer                           | `60000`                                                                                       | default timeout for `command_exit` assertions   |
| `concurrency`        | integer                           | `2`                                                                                           | `1..32`                                         |
| `keep`               | `never` \| `failures` \| `always` | `failures`                                                                                    | workspace retention policy                      |
| `redact`             | boolean                           | `true`                                                                                        | redacts common secret shapes in captured output |
| `outputDir`          | string                            | `.harnesscheck`                                                                               | resolved relative to the config file directory  |
| `copyExclude`        | string array                      | `['.git', '.git/**', '.harnesscheck', '.harnesscheck/**', 'node_modules', 'node_modules/**']` | excluded from copied fixtures                   |
| `maxOutputBytes`     | integer                           | `2000000`                                                                                     | shared cap for captured stdout/stderr           |

## Agents

Agents are keyed by identifier:

```yaml
agents:
  codex:
    adapter: codex
    passEnv: ["OPENAI_API_KEY"]

  local-wrapper:
    adapter: custom
    command: ./scripts/run-agent.sh
    args: ["--prompt", "{prompt}"]
    env:
      HARNESS_MODE: ci
```

### Agent id rules

Agent ids must:

- be non-empty,
- be at most 80 characters,
- start with a letter or number,
- use only letters, numbers, dots, underscores, or dashes.

### Agent fields

| Field         | Type                                                      | Required    | Notes                                                       |
| ------------- | --------------------------------------------------------- | ----------- | ----------------------------------------------------------- |
| `adapter`     | `codex` \| `claude` \| `gemini` \| `opencode` \| `custom` | no          | Omitting it behaves like `custom`                           |
| `command`     | string                                                    | conditional | Required when `adapter` is `custom` or omitted              |
| `args`        | string array                                              | no          | Argument list after template interpolation                  |
| `stdin`       | boolean                                                   | no          | Sends the prompt on stdin instead of embedding `{prompt}`   |
| `passEnv`     | string array                                              | no          | Parent env vars to forward explicitly, for example API keys |
| `env`         | object of string pairs                                    | no          | Explicit environment values after template interpolation    |
| `description` | string                                                    | no          | Human-readable label                                        |

### Child environment

HarnessCheck does **not** forward the full parent environment to agent processes.

Each agent starts with a minimal baseline environment that preserves normal CLI operation, including essentials such as:

- `PATH`, `HOME`, `USER`, and other basic user/shell variables,
- temp and locale variables such as `TMPDIR`, `LANG`, and `LC_ALL`,
- terminal/CI hints such as `TERM`, `COLORTERM`, `NO_COLOR`, and `CI`,
- tool config roots such as `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `GEMINI_CLI_HOME` when present.

Use these controls for anything beyond that baseline:

- `passEnv` forwards selected parent variables by name,
- `env` sets explicit values after template interpolation.

Example:

```yaml
agents:
  codex:
    adapter: codex
    passEnv: ["OPENAI_API_KEY"]
    env:
      OPENAI_BASE_URL: https://example-proxy.internal
```

### Custom adapter templates

HarnessCheck interpolates these placeholders inside `command`, every `args` entry, and every `env` value:

| Token         | Value                                       |
| ------------- | ------------------------------------------- |
| `{prompt}`    | case prompt                                 |
| `{workspace}` | absolute path to the copied trial workspace |
| `{configDir}` | directory containing `harnesscheck.yaml`    |
| `{caseId}`    | case identifier                             |
| `{agentId}`   | agent identifier                            |
| `{trial}`     | 1-based trial number                        |
| `{runId}`     | run id used for the current execution       |

Example:

```yaml
agents:
  fixture-agent:
    adapter: custom
    command: node
    args:
      - "{configDir}/fake-agent.mjs"
      - "{prompt}"
    env:
      HARNESSCHECK_AGENT_LABEL: "{agentId}-t{trial}"
```

### Prompt transport rule

Choose exactly one prompt transport:

- embed `{prompt}` in `args`, or
- set `stdin: true`

The schema rejects configurations that do both.

## Cases

A case defines one task against one fixture.

```yaml
cases:
  - id: add-health-endpoint
    fixture: ./fixture
    prompt: Add a health endpoint module.
    agents: [codex, claude]
    trials: 2
    timeoutMs: 180000
    assertions:
      - type: file_exists
        path: src/health.js
```

| Field         | Type         | Required | Notes                                    |
| ------------- | ------------ | -------- | ---------------------------------------- |
| `id`          | string       | yes      | Unique case identifier                   |
| `description` | string       | no       | Human-friendly description               |
| `fixture`     | string       | yes      | Path to a source fixture directory       |
| `prompt`      | string       | yes      | Prompt sent to the agent                 |
| `agents`      | string array | no       | Restricts the case to specific agent ids |
| `trials`      | integer      | no       | Overrides default trials                 |
| `timeoutMs`   | integer      | no       | Overrides default agent timeout          |
| `assertions`  | array        | yes      | One or more assertions                   |

Validation rules:

- case ids are unique,
- case ids follow the same identifier rules as agent ids,
- every referenced agent id must exist in the top-level `agents` map,
- `fixture` must point to an existing directory,
- fixture directories that contain symlinks are rejected before the trial runs.

## Assertions

HarnessCheck supports these assertion types.

### Filesystem assertions

| Type                | Required fields   | Meaning                           |
| ------------------- | ----------------- | --------------------------------- |
| `file_exists`       | `path`            | path must exist as a regular file |
| `file_not_exists`   | `path`            | path must be absent               |
| `file_contains`     | `path`, `value`   | file contains exact text          |
| `file_not_contains` | `path`, `value`   | file omits exact text             |
| `file_matches`      | `path`, `pattern` | file matches a JavaScript regex   |

`file_matches.flags` accepts JavaScript regex flags from `d`, `g`, `i`, `m`, `s`, `u`, `v`, and `y`.

For file-reading assertions, HarnessCheck keeps paths inside the copied workspace, rejects symlink traversal, and reads regular files only.

### Process assertions

| Type                  | Required fields | Optional fields                 | Meaning                                                             |
| --------------------- | --------------- | ------------------------------- | ------------------------------------------------------------------- |
| `command_exit`        | `command`       | `args`, `exitCode`, `timeoutMs` | runs a command in the copied workspace and checks its exit behavior |
| `stdout_contains`     | `value`         | —                               | agent stdout contains text                                          |
| `stdout_not_contains` | `value`         | —                               | agent stdout omits text                                             |
| `stderr_contains`     | `value`         | —                               | agent stderr contains text                                          |
| `stderr_not_contains` | `value`         | —                               | agent stderr omits text                                             |

### Change-set assertions

| Type            | Fields                             | Meaning                            |
| --------------- | ---------------------------------- | ---------------------------------- |
| `changed_files` | `include`, `exclude`, `min`, `max` | constrains the observed change set |

`include` is an allowlist: when you set it, **every** changed path must match at least one listed glob. `exclude` means no changed path may match any listed glob. If both `min` and `max` are present, `min` must be less than or equal to `max`.

## Output layout

By default, HarnessCheck writes output under `.harnesscheck` relative to the config file directory:

- `reports/<run-id>/report.json`
- `reports/<run-id>/report.html`
- `reports/<run-id>/report.junit.xml`
- `reports/<run-id>/report.md`
- `runs/<run-id>/<case-id>--<agent-id>--tNN/trial.json`
- `runs/<run-id>/<case-id>--<agent-id>--tNN/stdout.log`
- `runs/<run-id>/<case-id>--<agent-id>--tNN/stderr.log`

If the keep policy retains the workspace, the copied workspace lives under the same per-trial run directory.

## Full example

```yaml
version: 1
name: todo-api-agent-contract

defaults:
  trials: 2
  timeoutMs: 30000
  assertionTimeoutMs: 10000
  concurrency: 2
  keep: failures
  redact: true
  outputDir: .harnesscheck

agents:
  fixture-agent:
    adapter: custom
    description: Deterministic local agent used by the quick-start demo
    command: node
    args:
      - "{configDir}/fake-agent.mjs"
      - "{prompt}"

  codex:
    adapter: codex
    passEnv: ["OPENAI_API_KEY"]

cases:
  - id: add-health-endpoint
    description: Adds a health response without disturbing the todo route
    fixture: ./fixture
    prompt: >-
      Add a health endpoint module. It must export a health() function that
      returns an object with status set to ok. Keep the existing todo behavior.
    assertions:
      - type: file_exists
        path: src/health.js
      - type: file_contains
        path: src/health.js
        value: 'status: "ok"'
      - type: changed_files
        include: ["src/health.js"]
        exclude: ["package.json", "test/**"]
        max: 1
      - type: command_exit
        command: npm
        args: ["test"]
        exitCode: 0
      - type: stdout_contains
        value: Implemented health endpoint
```
