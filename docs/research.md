# Research notes and fresh rationale

**Last verified:** August 31, 2026

HarnessCheck exists because coding agents now mutate real repositories in production-like workflows, while teams still struggle to evaluate them reproducibly across different runtimes, permission systems, and infrastructure setups.

## Idea-selection rubric

This project's rationale prioritizes five filters:

1. **Primary-source evidence:** prefer first-party docs, surveys, and engineering writeups.
2. **Current pain, not abstract hype:** favor problems teams say they are facing now.
3. **Product fit:** the pain should map directly to fixture replay, assertion-based grading, and retained evidence.
4. **Durability:** the need should remain even as models improve.
5. **Distribution realism:** virality is a potential upside for eval/devtools content, not a guaranteed outcome.

By that rubric, HarnessCheck is aimed at a real and durable workflow gap rather than a speculative trend.

## Current demand signals from primary sources

| Source                                                                                                                                                       | What it says now                                                                                                                                                                                                               | Why it matters for HarnessCheck                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Notion 2026 AI Engineering Survey](https://www.notion.com/lp/ai-engineering-survey)                                                                         | Among surveyed builders, **quality / task success (56%)** is the top thing teams monitor in production. In the AI stack, **evaluation (20%)** is the most-cited challenge, with **orchestration / agents (18%)** close behind. | Teams are already measuring agent outcomes and still see eval and orchestration as unresolved. HarnessCheck is designed exactly for repeatable task-success checks on agentic workflows. |
| [Google Cloud: 2026 State of infrastructure in the agentic AI era](https://cloud.google.com/resources/content/state-of-infrastructure-in-the-agentic-ai-era) | **83%** of organizations say they need infrastructure upgrades for production-grade autonomous systems, and **4 out of 5** cite security, governance, or MLOps as major challenges.                                            | Reliable agent evaluation is not just a model problem. It depends on reproducible infrastructure, permission posture, and reviewable evidence.                                           |
| [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)                                        | Anthropic's January 9, 2026 guidance says good evals help teams ship agents more confidently and make behavioral changes visible before production.                                                                            | HarnessCheck follows this framing: explicit grading logic, automated replay, and evidence you can inspect before rollout.                                                                |
| [Anthropic: Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)                 | Anthropic's March 24, 2026 writeup argues that harness design is itself a major performance variable for long-running coding agents.                                                                                           | The harness is part of the experiment. Fresh workspaces, structured artifacts, and consistent command profiles are product features, not implementation details.                         |
| [Anthropic: Quantifying infrastructure noise in agentic coding evals](https://www.anthropic.com/engineering/infrastructure-noise)                            | Anthropic reports that infrastructure configuration alone produced up to a **6-point** swing on Terminal-Bench 2.0, and recommends skepticism for small leaderboard gaps unless configs are matched.                           | HarnessCheck focuses on local, replayable regression testing instead of treating raw benchmark deltas as self-explanatory.                                                               |
| [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)                                                  | OpenAI continues to recommend task-specific, criteria-driven evaluation instead of vague open-ended judging.                                                                                                                   | HarnessCheck uses explicit file, process, output, and change-set assertions rather than subjective transcript scoring.                                                                   |
| [GitHub Actions matrix strategies](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations)                   | Matrix fan-out remains the standard CI pattern for comparing independent dimensions.                                                                                                                                           | HarnessCheck's per-run reports and deterministic CLI exit behavior fit agent-by-agent or case-by-case CI matrices.                                                                       |

## Why the product is fixture-first

Current coding-agent docs across Codex, Claude Code, Gemini CLI, and OpenCode all emphasize local project context: config files, instruction files, permissions, and working-directory state. A reproducible harness therefore has to start from a known fixture and replay the task there.

## Why the product is assertion-driven

For coding agents, the most durable regression surfaces are usually:

- whether a regular file exists,
- what changed,
- whether required text or patterns appear,
- whether verification commands pass,
- what the agent printed to stdout or stderr.

These are stable enough to automate, review, and compare across vendors.

## Why the product is vendor-neutral

The major coding-agent CLIs differ in:

- config layering,
- instruction-file conventions,
- permission models,
- non-interactive execution modes,
- infrastructure assumptions.

HarnessCheck standardizes the test harness while leaving runtime enforcement to the agent layer that actually controls sandboxing and network access.

## Why the docs emphasize security boundaries

The primary sources consistently separate evaluation quality from execution permissions. That is why HarnessCheck documents its role narrowly: copied workspaces, explicit assertions, bounded/redacted evidence, and clear handoff to the underlying runtime for OS and network controls.
