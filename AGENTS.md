## General Rules

- **Keep files small**: Under ~500 LOC. Split before adding more logic.
- **Runtime**: Bun. No Node-specific APIs unless Bun equivalent unavailable.
- **Style**: TypeScript strict mode, ESNext target, ES modules only.
- **No filler**: No docstrings/comments on obvious code. Comment only non-obvious decisions.
- **Deps**: Commander for CLI, chalk for color, ora for spinners. Minimize new deps.

---

## Build / Test

- **Typecheck**: `tsc --build` (or `bun run typecheck`).
- **Tests**: `bun test` — unit tests live next to sources as `*.test.ts` (excluded from the npm package).
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
- **Client**: `src/client.ts` — `YaDiskClient`: picks a backend (REST with a token, WebDAV otherwise, REST→WebDAV fallback on `auth` errors), path normalization, conflict explanations (missing parent / exists / folder target), upload limits + verification, pagination, trash, download targets.
- **Backend contract**: `src/backend.ts` — `Backend` interface both transports implement; normalized paths in, shared error codes out.
- **WebDAV backend**: `src/dav.ts` (`DavBackend`) + `src/webdav.ts` (PROPFIND/PROPPATCH bodies, XML parsers).
- **REST backend**: `src/rest.ts` (`RestBackend`, REST-only extras: `uploadFromUrl`, `files`, `trashList`, `trashRestore`; `checkToken`) + `src/rest-api.ts` (`RestApi`: JSON calls, Yandex error-name → code mapping, 202 operation polling, pre-signed link follow).
- **Public links**: `src/public.ts` — `PublicClient` (no auth): stat/list/download anyone's public link.
- **Find**: `src/find.ts` — BFS walk (4 concurrent listings), or the REST whole-disk file index for `/` when folders are excluded (`type: "file"` or `mediaType`) — the index holds files only.
- **Errors**: `src/errors.ts` — `YaDiskError { code, status, hint }`, HTTP status → code mapping.
- **Paths**: `src/path.ts` — `normalizePath` (leading `/`, strips `disk:`, collapses `//`, rejects empty and `.`/`..` — URL parsing would collapse them, so WebDAV `/.` hits the root). `refuseRoot` guards delete/copy/move/publish.
- **Local files**: `src/local.ts` — local file checks, streaming md5, download target resolution, safe writes.
- **Auth**: `src/auth.ts` — token (`--token` → `YADISK_TOKEN` → config) and app password (flags → env → config) resolve independently; either is enough.
- **HTTP**: `src/http.ts` — `fetchWithTimeout`: disables Bun's implicit 5-min idle timeout, optional `AbortSignal.timeout`, maps transport failures to `network`/`timeout`. `withRetry` for retryable errors.
- **Types**: `src/types.ts` — `DiskInfo`, `Resource`, `TrashItem`, `Credentials`, `ClientOptions`, `ListOptions`, `FindOptions`, `UploadOptions`, `UploadResult`, `DownloadResult`.

### `packages/cli/` — `@vforsh/yadisk-cli`
- **Entrypoint**: `src/cli.ts` — root program, global flags, help epilogue (exit codes), error handler, `#!/usr/bin/env bun`.
- **Commands**: `src/commands/{auth,config,files,transfer,rest-only}.ts` — each exports a `register*(program)`; `rest-only` holds `find`, `trash`, `public`. Every command with non-trivial usage gets `.addHelpText("after", examples([...]))`.
- **Context**: `src/context.ts` — shared `program`, `getClient()`/`getClientOptions()` (timeout/retries/warnings from global flags), `parseCount`, `examples`.
- **Output**: `src/output.ts` — `emit` (stdout result, JSON or human), `warn`/`note` (stderr), `handleError`, `EXIT_CODES`.
- **Progress**: `src/progress.ts` — spinner on TTY; label + 15 s heartbeat on stderr otherwise.
- **Prompts**: `src/prompts.ts` — single shared stdin line reader (TTY raw mode for secrets, piped input, EOF → usage error).
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

- **Backend choice**: Token → REST for everything; app password only → WebDAV. REST `auth` error (401, 403 `ForbiddenError`) with an app password configured → warn once, switch to WebDAV for the rest of the process. REST-only features (`find` index, trash, `upload-url`, folder zip download, `--media-type`) throw `auth` with an `auth --oauth` hint on WebDAV.
- **WebDAV**: `https://webdav.yandex.ru`, `Authorization: Basic base64(user:pass)` (`src/dav.ts`).
- **REST**: `https://cloud-api.yandex.net/v1/disk`, `Authorization: OAuth <token>` (`src/rest-api.ts`). Always pass `fields` to trim payloads. Trash and `/resources/files` get lean field sets: hashes/URLs make those endpoints several times slower server-side. The trash API can't sort by deletion time (`sort=deleted` is ignored), so `trashList` reads every page (in parallel after the first) and sorts locally.
- **Trash safety**: `trashRestore` refuses `trash:/` itself (the whole trash) and `--overwrite` onto a folder. Never pass an unvalidated/empty trash path to the API.
- **Operations**: Once a REST call returns 202, `settle` failures become `unknown` (never `auth`), so the client neither retries nor falls back to WebDAV and applies the change twice.
- **Downloads**: `writeLocal` streams into `<target>.part` and renames on success — never `Bun.write(path, response)` (buffers the whole body).
- **Upload flow**: REST: `GET /resources/upload?path=…&overwrite=true` → PUT body to returned `href` (no auth header); 202 → poll `/operations/{id}`. WebDAV: single-step PUT (Yandex throttles: ~60 s/MB response hold; REST ~8 s/MB, scales with parallelism). REST pre-checks `max_file_size` and free space.
- **Timeouts**: All requests go through `fetchWithTimeout` (`timeout: false`). Never call `fetch` directly — Bun's default 5-min idle timeout kills throttled uploads.
- **XML parsing**: `parseTagValue: false` — never let fast-xml-parser coerce names/etags into numbers.
- **Upload verification**: After upload, `stat` and compare size + `md5` (REST field; on WebDAV the ETag is the md5). Only an md5 match counts as `verified`/`skip-if-same`; a size-only match is reported as `verified: false`. On timeout, check once whether the file already landed before failing.
- **Retries**: Only `network`, `rate_limited` (429, honors `Retry-After` up to 30 s, beyond that fails fast) and `server` (5xx). WebDAV: GET/PROPFIND/PUT/PROPPATCH. REST: GET, publish/unpublish, and the whole upload. Never MKCOL/DELETE/COPY/MOVE/POST. Timeouts are never retried.
- **Download flow**: `stat` first; files stream to disk, folders download as zip (REST `/resources/download` returns an archive link). WebDAV GET on a folder → 415 → `is_a_directory`.
- **Overwrite**: `cp`/`mv --overwrite` onto an existing folder is refused before the request (it would replace the whole folder).
- **Output contract**: stdout = result (one JSON value with `--json`, including `{"error":{…}}` on failure); stderr = warnings/progress/prompts. Library code never prints or calls `process.exit` — throw `YaDiskError`, report non-fatal notices via `ClientOptions.onWarning`.
- **Exit codes**: `packages/cli/src/output.ts` `EXIT_CODES` — keep in sync with the help epilogue in `cli.ts`, README and `skill/yadisk/SKILL.md`.
- **Global flags**: `--json`, `--username`, `--password`, `--token`, `--timeout`, and `--retries` are on the root program, accessed via `program.opts()`.
- **Programmatic API**: `import { YaDiskClient, PublicClient, getCredentials } from "@vforsh/yadisk"` — use in scripts/other packages.
