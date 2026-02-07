## General Rules

- **Keep files small**: Under ~500 LOC. Split before adding more logic.
- **Runtime**: Bun. No Node-specific APIs unless Bun equivalent unavailable.
- **Style**: TypeScript strict mode, ESNext target, ES modules only.
- **No filler**: No docstrings/comments on obvious code. Comment only non-obvious decisions.
- **Deps**: Commander for CLI, chalk for color, ora for spinners. Minimize new deps.

---

## Build / Test

- **Typecheck**: `tsc --build` (or `bun run typecheck`).
- **Run locally**: `bun run packages/cli/src/cli.ts <command>`.
- **Smoke test**: `yadisk --help` should list all commands. `yadisk info` requires valid token.

---

## Git

- **Commits**: Conventional Commits (`feat|fix|refactor|chore|docs|style|perf|test`).
- **Branch**: `main` only for now. Feature branches for non-trivial changes.

---

## Repo Tour

Monorepo with two workspace packages under `packages/`.

### `packages/yadisk/` — `@vforsh/yadisk` (programmatic API)
- **Entry**: `src/index.ts` — public API re-exports.
- **Client**: `src/client.ts` — `YaDiskClient` class, typed wrapper over Yandex.Disk REST API.
- **Auth**: `src/auth.ts` — token resolution chain (`--token` → env → config file → OAuth prompt).
- **Types**: `src/types.ts` — `DiskInfo`, `Resource`, `ResourceList`, `Link`, `Operation`, `ApiError`.

### `packages/cli/` — `@vforsh/yadisk-cli`
- **Entrypoint**: `src/cli.ts` — Commander setup, all subcommands, `#!/usr/bin/env bun`.
- **Formatters**: `src/format.ts` — table renderer, human-readable output for `ls`, `info`, `stat`.
- Imports `YaDiskClient`, auth helpers, and types from `@vforsh/yadisk`.

### Root
- **Skill**: `skill/yadisk/yadisk/SKILL.md` — user-facing skill for AI agents.

---

## Contracts

- **Auth header**: `Authorization: OAuth <token>` on all API calls.
- **Base URL**: `https://cloud-api.yandex.net` — never hardcode elsewhere; lives in `packages/yadisk/src/client.ts`.
- **Upload flow**: `getUploadUrl()` → `upload(href, file)` — two-step; upload URL is a separate host.
- **Global flags**: `--json` and `--token` are on the root program, accessed via `program.opts()`.
- **Programmatic API**: `import { YaDiskClient, getToken } from "@vforsh/yadisk"` — use in scripts/other packages.
