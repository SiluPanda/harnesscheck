# AGENTS.md

Repo-specific instructions for coding agents working on HarnessCheck.

## Scope and truthfulness

- Keep changes tightly scoped to the task.
- Do not claim npm publication, GitHub publication, or supported CLI behavior that you have not verified from the current repository state or current official docs.
- If documentation describes an intended contract rather than a committed implementation detail, say so plainly.

## Source of truth

For user-facing contract questions, treat these as primary:

1. `src/schema.ts`
2. `src/types.ts`
3. `package.json`
4. current official upstream adapter docs

If those diverge, update docs or code so they converge.

## Required sync points

If you change the schema, types, or adapter contract, update all affected docs in the same change:

- `README.md`
- `docs/configuration.md`
- `docs/adapters.md`
- `docs/security-model.md`
- `docs/research.md` when upstream sources or rationale changed
- `CHANGELOG.md`

## Safety defaults

Preserve the project's current safety bias unless a maintainer explicitly changes it:

- prefer isolated fixture copies,
- keep redaction on by default,
- keep report output bounded,
- avoid inheriting personal credentials or global agent config unless the task explicitly requires it.

## Adapter work

When touching an adapter:

- verify current upstream docs on the same day,
- note config, memory, permission, and sandbox implications,
- ensure the prompt is delivered exactly once,
- make environment inheritance explicit,
- document any non-interactive CI assumptions.

## Docs and examples

- Keep examples synthetic and free of real secrets.
- Prefer small fixtures and narrow assertions.
- Use checked-in SVGs for brand or architecture visuals rather than binary screenshots when a code-native asset is sufficient.

## Contact data

Do not add or invent maintainer email addresses or other contact endpoints unless they are currently verified from an official source.
