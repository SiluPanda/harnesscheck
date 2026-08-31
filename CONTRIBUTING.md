# Contributing to HarnessCheck

Thanks for helping improve HarnessCheck.

This project is meant to make coding-agent behavior easier to test, compare, and review. That means contributions should optimize for **clarity, determinism, and evidence**, not just feature count.

## Development setup

HarnessCheck targets Node.js `>=20.12`.

```bash
npm install
```

Recommended local checks:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

## What to keep true

Please preserve these project constraints unless a maintainer explicitly decides to change them:

- fixtures should be treated as canonical inputs, not mutable scratch space,
- per-trial execution should remain isolated,
- redaction should remain the safe default,
- docs must not claim package or repository publication that has not been verified,
- adapter behavior should be documented with current upstream sources.

## Contribution workflow

1. Make the smallest coherent change you can.
2. Keep schema, types, and docs in sync.
3. Add or update tests when behavior changes.
4. Include enough explanation in the PR for a reviewer to understand the user-visible effect.

## If you change the configuration contract

Update all affected materials in the same change:

- `src/schema.ts`
- `src/types.ts`
- `README.md`
- `docs/configuration.md`
- `docs/adapters.md`
- `docs/security-model.md` when defaults or trust boundaries change
- examples and issue templates where relevant

## If you change an adapter

Re-check the current upstream docs for that tool on the same day and update `docs/research.md` or `docs/adapters.md` as needed.

At minimum, reviewers should be able to answer:

- What changed in the invocation contract?
- Does prompt transport still happen exactly once?
- Did permission or sandbox assumptions change?
- Did environment inheritance become broader or narrower?

## Fixtures and examples

Keep fixtures:

- small,
- synthetic,
- reviewable,
- free of real secrets,
- free of unnecessary caches or generated outputs.

If an example requires agent-specific memory or config files, check in only the minimal project-local material needed to reproduce the behavior.

## Documentation standards

Good HarnessCheck docs should:

- distinguish current implementation from intended contract where necessary,
- avoid unsupported marketing claims,
- prefer explicit tables and examples over vague prose,
- note security implications when permissions or credentials are involved.

## Pull request checklist

Before opening a PR, confirm:

- [ ] formatting is clean
- [ ] lint/type/test/build checks were run or intentionally deferred with explanation
- [ ] docs are updated for any contract change
- [ ] changelog is updated when user-visible behavior changed
- [ ] no real secrets or private data were added
- [ ] generated artifacts are excluded unless intentionally committed

## Questions and proposals

If you are unsure about a design direction, open a focused issue or draft PR with:

- the problem statement,
- the smallest plausible API or schema change,
- security implications,
- how a reviewer would validate the change.
