# Adapters

HarnessCheck ships four built-in adapter profiles and one explicit `custom` mode. The built-ins are tuned for non-interactive runs; the custom mode lets you bring your own wrapper.

## Built-in profiles in v0.1.0

| Adapter    | Command    | Default args                                                                                                    | Notes                                                                                          |
| ---------- | ---------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `codex`    | `codex`    | `exec --approve-for-me --ephemeral --skip-git-repo-check --color never {prompt}`                                | Non-interactive approvals and ephemeral execution. Sandbox and network policy come from Codex. |
| `claude`   | `claude`   | `--print --permission-mode acceptEdits --no-session-persistence --output-format stream-json --verbose {prompt}` | Prints machine-readable output and disables session persistence.                               |
| `gemini`   | `gemini`   | `--approval-mode auto_edit --output-format stream-json --prompt {prompt}`                                       | Headless prompt execution with auto-edit approval mode.                                        |
| `opencode` | `opencode` | `run --format json --dir {workspace} {prompt}`                                                                  | Non-interactive JSON run rooted in the copied workspace.                                       |

These defaults are the exact built-in profiles resolved by `src/adapters.ts`.

## Safety posture by adapter

HarnessCheck always provides a fresh copied workspace. Runtime security still depends on the selected agent:

- **Codex:** the built-in profile enables non-interactive approvals and ephemeral execution, but Codex sandboxing and network access still come from the active Codex config/runtime.
- **Claude Code:** the built-in profile uses Claude's permission system and disables session persistence, but the actual enforcement boundary is Claude Code's runtime policy.
- **Gemini CLI:** the built-in profile is headless and approval-driven; Gemini's own sandbox configuration controls tool restrictions and expansion requests.
- **OpenCode:** the built-in profile is non-interactive, but OpenCode docs say permissions default to broad access unless tightened in config.

If you need a stricter or organization-specific policy, use a `custom` adapter or check a repo-local config file into the fixture.

## Environment forwarding

HarnessCheck starts agent child processes with a minimal ambient environment rather than the full parent shell environment.

That baseline preserves normal CLI behavior and common tool config discovery, including variables such as:

- `PATH`, `HOME`, `USER`, and basic shell identity,
- temp and locale variables such as `TMPDIR`, `LANG`, and `LC_ALL`,
- terminal/CI variables such as `TERM`, `COLORTERM`, `NO_COLOR`, and `CI`,
- tool config roots such as `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `GEMINI_CLI_HOME` when present.

Use agent config for anything beyond that baseline:

- `passEnv` forwards selected parent variables by name,
- `env` sets explicit values after template interpolation.

Example:

```yaml
agents:
  codex:
    adapter: codex
    passEnv: ["OPENAI_API_KEY"]

  custom-proxy:
    adapter: custom
    command: ./scripts/run-agent.sh
    args: ["{prompt}"]
    passEnv: ["OPENAI_API_KEY"]
    env:
      OPENAI_BASE_URL: https://example-proxy.internal
```

## Custom adapters

A custom adapter is any agent definition with an explicit `command`:

```yaml
agents:
  my-wrapper:
    adapter: custom
    command: ./scripts/run-agent.sh
    args: ["--workspace", "{workspace}", "--prompt", "{prompt}"]
    env:
      HARNESSCHECK_RUN_LABEL: "{caseId}-{agentId}-t{trial}"
```

### Template variables

HarnessCheck interpolates the same tokens in `command`, `args`, and `env` values:

- `{prompt}`
- `{workspace}`
- `{configDir}`
- `{caseId}`
- `{agentId}`
- `{trial}`
- `{runId}`

### Prompt transport

Use exactly one of these patterns:

#### Prompt in args

```yaml
agents:
  wrapped-cli:
    adapter: custom
    command: my-agent
    args: ["run", "{prompt}"]
```

#### Prompt on stdin

```yaml
agents:
  stdin-cli:
    adapter: custom
    command: my-agent
    args: ["run", "--stdin"]
    stdin: true
```

The schema rejects configs that combine `stdin: true` with an `args` entry that already contains `{prompt}`.

## Repo-local context files

HarnessCheck treats agent-specific project context as normal fixture input:

- Codex: `.codex/config.toml`
- Claude Code: `CLAUDE.md`, `.claude/`, and repo-level settings
- Gemini CLI: `GEMINI.md` and `.gemini/settings.json`
- OpenCode: `opencode.json` or `opencode.jsonc`, plus configured references

This is one of the main reasons HarnessCheck is fixture-first rather than transcript-first.

## Practical guidance

- Keep built-in profiles for quick comparisons and CI smoke runs.
- Use repo-local config inside fixtures when tool behavior depends on project policy.
- Use `passEnv` only for variables the agent truly needs.
- Use `custom` adapters for wrappers that pin models, inject org-specific env, or add extra logging.
- Record permission posture in CI job logs when comparing agents across vendors.

## References

- Codex CLI: <https://learn.chatgpt.com/docs/codex/cli>
- Codex non-interactive mode: <https://learn.chatgpt.com/docs/non-interactive-mode>
- Codex config basics: <https://learn.chatgpt.com/docs/config-file/config-basic>
- Codex agent approvals & security: <https://learn.chatgpt.com/docs/agent-approvals-security>
- Claude Code overview: <https://code.claude.com/docs/en/overview>
- Claude Code settings: <https://code.claude.com/docs/en/settings>
- Claude Code permission modes: <https://code.claude.com/docs/en/permission-modes>
- Claude Code memory: <https://code.claude.com/docs/en/memory>
- Gemini CLI docs: <https://google-gemini.github.io/gemini-cli/docs/>
- Gemini CLI configuration: <https://google-gemini.github.io/gemini-cli/docs/get-started/configuration.html>
- Gemini `GEMINI.md` docs: <https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html>
- Gemini sandbox docs: <https://google-gemini.github.io/gemini-cli/docs/cli/sandbox.html>
- OpenCode CLI: <https://opencode.ai/docs/cli/>
- OpenCode config: <https://opencode.ai/docs/config/>
- OpenCode permissions: <https://opencode.ai/docs/permissions/>
- OpenCode providers: <https://opencode.ai/docs/providers/>
- OpenCode references: <https://opencode.ai/docs/references/>
