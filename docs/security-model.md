# Security model

HarnessCheck runs code-editing agents against real project fixtures, so its security story is about clear boundaries, evidence retention, and explicit responsibility between the harness and the underlying agent runtime.

> [!IMPORTANT]
> HarnessCheck provides **mutation isolation** by copying each fixture into a fresh per-trial workspace. It does **not** provide a general-purpose operating-system sandbox or network sandbox by itself.

## What HarnessCheck enforces directly

### Fresh copied workspaces

Every trial starts from a new copied fixture. Trials never edit the source fixture in place.

### Fixture validation

Fixtures must be directories. HarnessCheck refuses to copy fixture trees that contain symbolic links.

### Assertion path containment

Assertion paths must stay relative to the trial workspace. HarnessCheck rejects path escape attempts and refuses assertion reads that traverse symlinks.

### Regular-file checks for file assertions

`file_exists` passes only when the target exists as a regular file. File-content assertions also read regular files only.

### Minimal child environment

HarnessCheck does not pass the full parent environment to the agent process.

Instead, it starts from a minimal allowlist that keeps common CLIs functional, including:

- basic user and shell variables such as `PATH`, `HOME`, `USER`, and `SHELL`,
- temp, locale, and terminal variables such as `TMPDIR`, `LANG`, `LC_ALL`, `TERM`, and `NO_COLOR`,
- CI hints such as `CI`,
- supported tool config roots such as `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `GEMINI_CLI_HOME` when present.

Anything more must be intentional:

- `passEnv` forwards selected parent variables by name,
- `env` injects explicit values for the child process.

### No shell wrapper

Agent and assertion commands run through `spawn(..., { shell: false })`, which avoids shell interpolation as part of the harness itself.

### Bounded captured output

Captured stdout and stderr are truncated at `maxOutputBytes`, which keeps artifact size bounded and limits accidental output sprawl.

### Default redaction

`redact: true` is the default. HarnessCheck strips ANSI control codes and redacts common credential shapes before writing process output into reports.

## What the agent runtime enforces

The selected agent still owns the actual command-execution boundary:

- **Codex:** the built-in profile uses `codex exec` with non-interactive approvals and ephemeral execution, but sandbox and network policy come from Codex's active configuration/runtime.
- **Claude Code:** Claude enforces its own permission rules and permission mode.
- **Gemini CLI:** Gemini enforces its own sandboxing and any expansion flow.
- **OpenCode:** OpenCode enforces whatever `permission` policy is active in its config.

This separation is deliberate. HarnessCheck makes the run reproducible and reviewable; the adapter runtime determines what the agent can access.

## Trust boundaries

1. **Source fixture** — the checked-in baseline.
2. **Copied trial workspace** — the writable directory where the agent runs.
3. **Harness process** — the orchestrator that copies fixtures, launches commands, evaluates assertions, and writes reports.
4. **Agent runtime** — Codex, Claude Code, Gemini CLI, OpenCode, or a custom wrapper.
5. **External systems** — networks, package registries, cloud APIs, and credential stores.

## Retained evidence

Each trial emits evidence under `.harnesscheck/runs/<run-id>/<case-id>--<agent-id>--tNN/`:

- `trial.json`
- `stdout.log`
- `stderr.log`
- `workspace/` when the keep policy retains it

Run-level summaries live under `.harnesscheck/reports/<run-id>/`:

- `report.json`
- `report.html`
- `report.junit.xml`
- `report.md`

## Threat model

| Threat                    | Why it matters                                 | Current mitigation                                                                          |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Cross-trial contamination | one run can affect the next                    | fresh workspace copy per trial                                                              |
| Malicious fixture links   | a fixture can smuggle paths outside the tree   | fixture symlink rejection before copy                                                       |
| Assertion path escape     | a check reads outside the copied workspace     | relative-path enforcement plus symlink refusal and regular-file checks                      |
| Secret leakage in logs    | reports can be uploaded to CI artifacts        | default redaction plus output bounds                                                        |
| Over-broad repo churn     | a narrow prompt rewrites too much              | `changed_files` assertions, including `include` allowlists, plus retained evidence          |
| Hidden global state       | user-level config changes agent behavior       | fixture-first design, repo-local config support, and a minimal default child environment    |
| Weak runtime permissions  | the underlying agent can still run too broadly | enforce permissions in the adapter runtime, CI job environment, container, or runner policy |

## Practical operating guidance

- keep fixtures free of real secrets,
- use `passEnv` only for secrets the agent truly needs,
- prefer repo-local config over ambient personal config,
- use `changed_files.include` when you want every mutation to stay inside a narrow allowlist,
- treat retained artifacts as sensitive,
- document permission posture in CI logs when comparing agents,
- use custom adapters when your organization requires stricter wrappers or audited entrypoints.

## Non-goals

HarnessCheck does not claim to provide:

- container isolation,
- VM isolation,
- network egress control,
- provider credential management,
- supply-chain verification of external agent installers.

## References

- Codex sandboxing: <https://learn.chatgpt.com/docs/sandboxing>
- Codex agent approvals & security: <https://learn.chatgpt.com/docs/agent-approvals-security>
- Claude Code permissions: <https://code.claude.com/docs/en/permissions>
- Gemini sandbox docs: <https://google-gemini.github.io/gemini-cli/docs/cli/sandbox.html>
- OpenCode permissions: <https://opencode.ai/docs/permissions/>
