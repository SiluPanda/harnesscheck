# CI guide

HarnessCheck fits standard CI pipelines: build the project, validate the target agent runtime, run a deterministic suite, and upload the resulting reports and per-trial evidence.

## CI behavior that matters

- `harnesscheck run` exits with `0` when every trial passes.
- `harnesscheck run` exits with `1` when any trial fails or errors.
- config and argument errors use non-zero CLI error exits before the harness runs.
- reports are written under `.harnesscheck/reports/<run-id>/` by default.

## Recommended job stages

### 1. Repository health

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

### 2. Agent availability

Check the runtimes you plan to exercise before the matrix fans out:

- `codex --version`
- `claude --version`
- `gemini --version`
- `opencode --version`

### 3. Harness execution

Good matrix dimensions include:

- adapter
- case subset
- operating system
- permission mode
- pinned model preset

### 4. Artifact upload

Upload both run-level reports and per-trial evidence.

## GitHub Actions example

GitHub's current Node.js tutorial examples use `actions/checkout@v6` and `actions/setup-node@v7`, so the sample below follows that baseline as of August 31, 2026.

```yaml
name: harnesscheck

on:
  pull_request:
  push:
    branches: [main]

jobs:
  repo-health:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 20.x
          cache: npm
      - run: npm ci
      - run: npm run format:check
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
      - run: npm run build

  harness:
    needs: repo-health
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        agent: [codex, claude, gemini, opencode]
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 20.x
          cache: npm
      - run: npm ci
      - run: npm run build
      - name: Verify agent runtime
        run: |
          case "${{ matrix.agent }}" in
            codex) codex --version ;;
            claude) claude --version ;;
            gemini) gemini --version ;;
            opencode) opencode --version ;;
          esac
      - name: Run HarnessCheck
        run: |
          node dist/cli.js -c harnesscheck.yaml run \
            --agent "${{ matrix.agent }}" \
            --output-dir ".harnesscheck/${{ matrix.agent }}" \
            --run-id "${{ github.run_id }}-${{ matrix.agent }}"
      - name: Upload reports and trial evidence
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: harnesscheck-${{ matrix.agent }}
          path: |
            .harnesscheck/${{ matrix.agent }}/reports/${{ github.run_id }}-${{ matrix.agent }}/
            .harnesscheck/${{ matrix.agent }}/runs/${{ github.run_id }}-${{ matrix.agent }}/
```

The sample uses `node dist/cli.js` because it targets this repository's own source tree. In a consuming repository that depends on the published package, the equivalent command is `npx harnesscheck run ...`.

## Artifact layout

For a run id named `ci-smoke`, the default artifact tree is:

- `.harnesscheck/reports/ci-smoke/report.json`
- `.harnesscheck/reports/ci-smoke/report.html`
- `.harnesscheck/reports/ci-smoke/report.junit.xml`
- `.harnesscheck/reports/ci-smoke/report.md`
- `.harnesscheck/runs/ci-smoke/<case-id>--<agent-id>--tNN/trial.json`
- `.harnesscheck/runs/ci-smoke/<case-id>--<agent-id>--tNN/stdout.log`
- `.harnesscheck/runs/ci-smoke/<case-id>--<agent-id>--tNN/stderr.log`

If `keep` retains the copied workspace, it appears under the same per-trial directory.

## Determinism tips

- pin Node.js and the agent CLI version you are comparing,
- use explicit `--run-id` values so artifact paths are predictable,
- keep fixtures synthetic and small,
- prefer project-local agent config over user-global state,
- keep network access off unless a case intentionally needs it,
- upload failures even when the job fails early.

## Security notes for CI

HarnessCheck provides mutation isolation by copying the fixture into a fresh workspace. It does not add an OS or network sandbox around the underlying agent runtime. Agent child processes also start from a minimal environment rather than inheriting every CI secret automatically; use `passEnv` or explicit agent `env` only for variables the run actually needs. If your CI policy requires stricter filesystem or network boundaries, enforce them with the agent's own permission system, the job environment, containers, or runner policy.

## References

- GitHub Actions matrix strategies: <https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations>
- GitHub Actions workflow syntax: <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax>
- GitHub Actions Node.js tutorial: <https://docs.github.com/actions/automating-builds-and-tests/building-and-testing-nodejs>
