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
- **Smoke test**: `yadisk --help` should list all commands. `yadisk info` requires valid credentials.

---

## Git

- **Commits**: Conventional Commits (`feat|fix|refactor|chore|docs|style|perf|test`).
- **Branch**: `main` only for now. Feature branches for non-trivial changes.

---

## Repo Tour

Monorepo with two workspace packages under `packages/`.

### `packages/yadisk/` — `@vforsh/yadisk` (programmatic API)
- **Entry**: `src/index.ts` — public API re-exports.
- **Client**: `src/client.ts` — `YaDiskClient` class, typed wrapper over [Yandex.Disk WebDAV API](https://yandex.ru/dev/disk/doc/en/).
- **Auth**: `src/auth.ts` — credential resolution chain (`--username`/`--password` → env → config file).
- **WebDAV**: `src/webdav.ts` — PROPFIND XML bodies, XML response parsers (fast-xml-parser).
- **HTTP**: `src/http.ts` — `fetchWithTimeout`: disables Bun's implicit 5-min idle timeout, optional `AbortSignal.timeout`.
- **Types**: `src/types.ts` — `DiskInfo`, `Resource`, `Credentials`, `WebDAVError`.

### `packages/cli/` — `@vforsh/yadisk-cli`
- **Entrypoint**: `src/cli.ts` — Commander setup, all subcommands, `#!/usr/bin/env bun`.
- **Formatters**: `src/format.ts` — table renderer, human-readable output for `ls`, `info`, `stat`.
- Imports `YaDiskClient`, auth helpers, and types from `@vforsh/yadisk`.

### Root
- **Skill**: `skill/yadisk/SKILL.md` — user-facing skill for AI agents.

---

## Publish

- **Script**: `bun run publish` (or `./scripts/publish.sh`).
- Publishes `@vforsh/yadisk` first, then `@vforsh/yadisk-cli`.
- Automatically resolves `workspace:*` → `^<api-version>` in CLI's `package.json` before publish, restores after.
- Bump versions in both `packages/yadisk/package.json` and `packages/cli/package.json` before running.
- npm token: resolved via `NPM_TOKEN` env or fetched from Bitwarden (`bwx`).

---

## Contracts

- **Auth header**: `Authorization: Basic base64(user:pass)` on all WebDAV calls.
- **Base URL**: `https://webdav.yandex.ru` — lives in `packages/yadisk/src/client.ts`.
- **Upload flow**: Single-step PUT to remote path. Yandex throttles WebDAV uploads: the body is sent at full speed, then the response is held ~60 s/MB.
- **Timeouts**: All requests go through `fetchWithTimeout` (`timeout: false`). Never call `fetch` directly — Bun's default 5-min idle timeout kills throttled uploads.
- **Download flow**: Single-step GET from remote path.
- **Global flags**: `--json`, `--username`, `--password`, and `--timeout` are on the root program, accessed via `program.opts()`.
- **Programmatic API**: `import { YaDiskClient, getCredentials } from "@vforsh/yadisk"` — use in scripts/other packages.
