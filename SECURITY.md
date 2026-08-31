# Security policy

HarnessCheck is a tool for running code-editing agents against real project fixtures. Please report security issues responsibly.

## Supported versions

Until a stable `1.0.0` release exists, assume that only the latest source state maintained by the project is eligible for security fixes.

## What to report

Please report vulnerabilities involving any of the following:

- workspace escape or path traversal,
- secret leakage through reports or retained artifacts,
- unsafe environment inheritance,
- adapter behaviors that silently bypass documented permission expectations,
- cross-trial contamination that can change another run's outcome,
- report poisoning or artifact tampering,
- command execution paths that violate the documented trust boundary.

## What usually does not belong here

The following are usually not security issues by themselves:

- ordinary model mistakes or hallucinations,
- low-quality edits that stay inside the documented execution boundary,
- missing features that were never claimed,
- provider-side incidents that do not arise from HarnessCheck behavior.

## How to disclose

Please do **not** post exploit details in a public issue.

Preferred process:

1. Use the repository's private vulnerability reporting mechanism if one is available on the hosting platform.
2. If no private mechanism is available, request a verified private contact route from the maintainer before sharing details.
3. Share the minimum information needed to reproduce and assess the issue safely.

Because contact channels can change, this file intentionally does not hard-code an unverified email address.

## What to include

A strong report includes:

- affected commit, version, or branch,
- operating system and runtime details,
- adapter involved,
- exact config or a minimized redacted example,
- clear reproduction steps,
- expected versus actual boundary behavior,
- whether any real data or credentials were exposed.

## Handling expectations

Project maintainers should aim to:

- acknowledge receipt within 5 business days,
- provide a rough severity assessment once reproduced,
- coordinate a fix and disclosure timeline when the issue is confirmed.

These are targets, not guarantees.

## Safe harbor

We support good-faith security research that:

- avoids privacy violations,
- avoids destructive actions,
- does not exfiltrate real secrets or proprietary code,
- gives maintainers a reasonable chance to fix the issue before public disclosure.

## Related documentation

- [`docs/security-model.md`](./docs/security-model.md)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- [`AGENTS.md`](./AGENTS.md)
