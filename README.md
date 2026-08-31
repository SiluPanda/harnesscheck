<p align="center">
  <img src="./assets/harnesscheck-wordmark.svg" alt="HarnessCheck" width="860" />
</p>

<p align="center">
  <a href="https://github.com/SiluPanda/harnesscheck/releases/latest"><img src="https://img.shields.io/github/v/release/SiluPanda/harnesscheck?display_name=tag&sort=semver" alt="Latest GitHub release" /></a>
  <a href="https://github.com/SiluPanda/harnesscheck/actions/workflows/ci.yml"><img src="https://github.com/SiluPanda/harnesscheck/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://github.com/SiluPanda/harnesscheck"><img src="https://img.shields.io/badge/github-SiluPanda%2Fharnesscheck-181717?logo=github&logoColor=white" alt="GitHub repository" /></a>
  <a href="https://github.com/SiluPanda/harnesscheck/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-0b1020" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520.12-339933?logo=node.js&logoColor=white" alt="Node.js 20.12 or newer" />
</p>

<p align="center">
  Deterministic, fixture-first regression tests for AI coding agents.
</p>

HarnessCheck is a Node.js CLI for testing terminal coding agents against the same repo task, from the same starting fixture, with the same assertions. Each trial runs in a fresh copied workspace, captures process output and file changes, and emits reviewable reports for local use or CI.

## Why this product shape works

- Current coding-agent docs across Codex, Claude Code, Gemini CLI, and OpenCode all emphasize repo-local context, config, and permission layers.
- OpenAI's evaluation guidance continues to favor task-specific, criteria-driven checks over open-ended grading.
- GitHub Actions matrix workflows make side-by-side agent regressions easy to automate.

Fresh source links and rationale live in [`docs/research.md`](./docs/research.md).

## 60-second quick start

Install the versioned release artifact directly from GitHub:

```bash
mkdir harnesscheck-demo && cd harnesscheck-demo
npm init -y
npm install --save-dev https://github.com/SiluPanda/harnesscheck/releases/download/v0.1.0/harnesscheck-0.1.0.tgz
npx harnesscheck init
npx harnesscheck doctor
npx harnesscheck run --run-id first-run
```

`init` creates:

- `harnesscheck.yaml`
- `fixtures/hello-world/TASK.md`
- `fixtures/hello-world/fake-agent.mjs`
- `fixtures/hello-world/README.md`

`run` writes:

- `.harnesscheck/reports/first-run/report.json`
- `.harnesscheck/reports/first-run/report.html`
- `.harnesscheck/reports/first-run/report.junit.xml`
- `.harnesscheck/reports/first-run/report.md`
- `.harnesscheck/runs/first-run/hello-world--fake--t01/trial.json`
- `.harnesscheck/runs/first-run/hello-world--fake--t01/stdout.log`
- `.harnesscheck/runs/first-run/hello-world--fake--t01/stderr.log`

The starter suite uses a bundled deterministic fake agent, so it runs without model credentials, network calls, or external services.

## Verified local demo

Verified locally on **August 31, 2026** from this repository:

```bash
npm install
npm run build
node dist/cli.js -c examples/todo-api/harnesscheck.yaml run --run-id local-demo
```

That command runs the `examples/todo-api` demo twice and writes reports to:

- `examples/todo-api/.harnesscheck/reports/local-demo/report.json`
- `examples/todo-api/.harnesscheck/reports/local-demo/report.html`
- `examples/todo-api/.harnesscheck/reports/local-demo/report.junit.xml`
- `examples/todo-api/.harnesscheck/reports/local-demo/report.md`

See [`examples/todo-api/README.md`](./examples/todo-api/README.md) for the demo fixture.

## What a suite looks like

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

agents:
  fixture-agent:
    adapter: custom
    description: Deterministic local agent used by the quick-start demo
    command: node
    args:
      - "{configDir}/fake-agent.mjs"
      - "{prompt}"

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
```

When an agent needs an API key or other parent-process secret, opt it in explicitly:

```yaml
agents:
  codex:
    adapter: codex
    passEnv: ["OPENAI_API_KEY"]
```

HarnessCheck supports these assertion types:

- `file_exists`
- `file_not_exists`
- `file_contains`
- `file_not_contains`
- `file_matches`
- `command_exit`
- `changed_files`
- `stdout_contains`
- `stdout_not_contains`
- `stderr_contains`
- `stderr_not_contains`

Key semantics:

- `file_exists` passes only when the path exists as a **regular file**.
- `changed_files.include` is an **allowlist**: if you set it, every changed path must match at least one listed glob.
- Agent child processes start with a **minimal ambient environment**; use `passEnv` to forward selected parent variables and `env` for explicit overrides.

## Built-in adapter profiles

Built-in adapters ship with non-interactive defaults tuned for unattended runs:

| Adapter    | Default profile                                                                                                        | Safety note                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex`    | `codex exec --approve-for-me --ephemeral --skip-git-repo-check --color never {prompt}`                                 | Non-interactive approvals and ephemeral execution are set here; Codex sandbox and network policy come from Codex's active config/runtime.   |
| `claude`   | `claude --print --permission-mode acceptEdits --no-session-persistence --output-format stream-json --verbose {prompt}` | Claude Code still uses its own permission model; the HarnessCheck profile keeps the run non-interactive and stateless.                      |
| `gemini`   | `gemini --approval-mode auto_edit --output-format stream-json --prompt {prompt}`                                       | Gemini CLI remains responsible for any sandbox or expansion behavior configured in its runtime.                                             |
| `opencode` | `opencode run --format json --dir {workspace} {prompt}`                                                                | This profile is non-interactive, but OpenCode permissions stay runtime-configured; tighten them in `opencode.json` or use a custom wrapper. |

For adapter details and custom command templating, see [`docs/adapters.md`](./docs/adapters.md).

## Reports and artifacts

Every run emits four run-level reports plus per-trial evidence:

- `.harnesscheck/reports/<run-id>/report.json`
- `.harnesscheck/reports/<run-id>/report.html`
- `.harnesscheck/reports/<run-id>/report.junit.xml`
- `.harnesscheck/reports/<run-id>/report.md`
- `.harnesscheck/runs/<run-id>/<case-id>--<agent-id>--tNN/trial.json`
- `.harnesscheck/runs/<run-id>/<case-id>--<agent-id>--tNN/stdout.log`
- `.harnesscheck/runs/<run-id>/<case-id>--<agent-id>--tNN/stderr.log`

With `keep: failures` or `keep: always`, retained trial workspaces live under the same per-trial run directory.

## Security boundary

> [!IMPORTANT]
> HarnessCheck gives you **mutation isolation**, not a general-purpose OS or network sandbox. It copies a fixture into a fresh workspace, runs the selected agent there, and keeps assertions inside that workspace boundary. Filesystem and network restrictions come from the underlying agent runtime and its configured permission mode.

Additional safety defaults in v0.1.0:

- `redact: true` by default
- bounded captured output via `maxOutputBytes`
- minimal child-process environment by default, with `passEnv` and explicit `env` for intentional additions
- fixture directories that contain symlinks are rejected before execution
- no shell wrapper around agent or assertion commands
- assertion path checks that block path escape and symlink traversal

## Documentation

- [`docs/configuration.md`](./docs/configuration.md) — full config reference
- [`docs/adapters.md`](./docs/adapters.md) — built-in profiles and custom adapter templating
- [`docs/ci.md`](./docs/ci.md) — GitHub Actions and CI patterns
- [`docs/security-model.md`](./docs/security-model.md) — trust boundaries and safety details
- [`docs/research.md`](./docs/research.md) — fresh upstream rationale and source links
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — contributor workflow

## License

[MIT](./LICENSE)
