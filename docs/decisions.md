# Decisions

- 2026-10-16: Python is pinned to `>=3.12,<3.13` and the build backend is hatchling, the simplest layout for a `src/` package.
- 2026-10-16: `mypy --strict` runs on `node/src` and `node/tests` (the whole of `node/` minus the virtualenv), from `node/`.
- 2026-10-16: ESLint uses the flat config with `@eslint/js` and `typescript-eslint` recommended rules; `tsc` covers `worker/src` and `worker/tests`.
- 2026-10-16: the `contracts` check passes with a message while `scripts/contracts.sh` does not exist.
