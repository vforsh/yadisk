---
name: yadisk
description: >
  Upload, download, search and manage files on Yandex.Disk via the `yadisk` CLI or `@vforsh/yadisk` API.
  Use when the user wants to: (1) upload files (or have Yandex fetch a URL) to Yandex.Disk, (2) download files or
  folders (as zip), (3) list/browse/find Yandex.Disk contents, (4) create/delete/move/copy files or folders,
  (5) restore deleted files from the trash, (6) publish/unpublish or read public links (disk.yandex.ru/d/…),
  (7) check Yandex.Disk usage, (8) authenticate with Yandex.Disk.
---

# yadisk

CLI (`yadisk`) and TypeScript API (`@vforsh/yadisk`) for Yandex.Disk.

## Agent contract

- **Always pass `--json`.** stdout carries exactly one JSON value: the result, or `{"error":{"code","message","hint","status"}}`. stderr carries warnings, progress and retries only. Don't merge the two streams (`2>&1`) before parsing.
- **Branch on exit codes, not text:**

| Exit | Meaning | Error codes |
|---|---|---|
| 0 | ok | — |
| 1 | unexpected | `unknown` |
| 2 | bad usage / input | `usage` |
| 3 | auth failed, no credentials, or feature needs a token | `auth` |
| 4 | not found (remote or local) | `not_found`, `local_not_found` |
| 5 | exists / conflict / wrong type / refused | `already_exists`, `conflict`, `not_a_directory`, `is_a_directory`, `forbidden` |
| 6 | transient: retry later | `network`, `timeout`, `rate_limited`, `server` |
| 7 | disk full / file too large | `quota` |
| 8 | upload landed but content mismatched | `verify_failed` |

- **Act on the `hint`.** It is usually the exact next command, e.g. `Create it first: yadisk mkdir /a`.
- **Check whether something exists:** `yadisk stat <path> --json` exits 4 when it's missing.
- **Paths:** `uploads/x`, `/uploads/x`, and `disk:/uploads/x` all mean the same thing. A trailing `/` on the destination of `upload`/`cp`/`mv`/`upload-url`/`download` means "into this folder". Empty paths and `.`/`..` segments are rejected (exit 2), and `rm`/`cp`/`mv`/`publish` refuse to act on the disk root.
- **`--overwrite` replaces files only.** A destination that is an existing folder fails with `is_a_directory` and a trailing-slash hint; don't force it.
- `yadisk <command> --help` shows examples for that command.

## Backends

- **With an OAuth token** (`YADISK_TOKEN` or `yadisk auth --oauth`), everything runs on the **REST API**. You get:
  - fast uploads
  - `md5` + `sha256` + `public_url` in `stat`
  - `rm` that goes to the trash, with `trash restore`
  - `find` using the whole-disk file index
  - `upload-url`, folder downloads as zip, and early rejection of oversized uploads
- **With only an app password**, everything runs on **WebDAV**. The REST-only commands exit 3, with a hint to run `yadisk auth --oauth`.
- **If REST rejects the token** and an app password is also configured, the CLI prints a warning on stderr and falls back to WebDAV.

## Uploads take time

Yandex holds each upload response open server-side for a while. The CLI prints an estimate on stderr before it starts, e.g. `Uploading x.zip (50.0 MB) via rest — est ~6m42s`.

- With a token (REST) uploads take about **8 s/MB**. Without one (WebDAV) they take about **60 s/MB**, and a warning is printed.
- A typical agent shell tool times out around 2 min. **For files over ~10 MB (REST) or ~1 MB (WebDAV), run the upload in the background.** A heartbeat line goes to stderr every 15 s.
- **Remote source?** `yadisk upload-url <url> <dest>` makes Yandex fetch the file itself, so nothing passes through this machine.
- Uploads are verified afterwards. `verified: true` means the remote size and md5 match; `false` means verification was skipped or the server exposed no md5. A mismatch exits 8.
- **Retrying is safe:** `--skip-if-same` skips the upload only when the remote size **and** md5 match. Always pass it when re-running after a timeout or crash.
- Network errors, 429 and 5xx are retried automatically (`--retries <n>`, default 2), but only for reads, uploads and publish. `mkdir`/`rm`/`cp`/`mv` are never retried, so after exit 6 run `stat` first to see whether they took effect. Timeouts are not retried. A `Retry-After` over 30 s fails immediately and the wait appears in the hint.

## Commands

```bash
yadisk info                                    # {used_bytes, available_bytes, total_bytes, trash_bytes?, max_file_size?}
yadisk ls [path] [--sort name|size|modified] [--limit n] [--offset n]
                                               # array of resources; prefix sort with - for desc; default path /
yadisk stat <path>                             # {name, path, type, size, created, modified, md5, sha256?, content_type, media_type?, public_url?}
yadisk find [path] [--name glob] [--type file|dir] [--max-depth n] [--limit n] [--media-type t]
yadisk mkdir <path>                            # {path, created}; exit 5 if it exists or parent is missing
yadisk upload <file> [dest] [--publish] [--skip-if-same] [--no-verify]
                                               # {path, size, md5, method, skipped, verified, public_url?, duration_ms}
yadisk upload-url <url> <dest>                 # {url, ...resource}; REST
yadisk download <path> [local-dest]            # {path, local_path, size, archive}; folders → .zip (REST)
yadisk cp <from> <to> [--overwrite]            # {from, to, copied}; `to` = resolved destination
yadisk mv <from> <to> [--overwrite]            # {from, to, moved}
yadisk rm <path>                               # {path, deleted, trashed}; refuses /
yadisk trash ls [--origin path] [--limit n]    # newest first: [{name, path: "trash:/…", type, size, origin_path, deleted}]
yadisk trash restore <trash-path> [--name n] [--overwrite]   # {trash_path, path, restored}
yadisk publish <path>                          # {path, public_url}
yadisk unpublish <path>                        # {path, published: false}
yadisk public stat|ls|download <url> [--path p]   # anyone's public link, no credentials
yadisk config get|set|list|unset               # keys: username, password, token, upload_dir
```

Global flags: `--json`, `--timeout <sec>` (per request; default none), `--retries <n>`, `--username`/`--password`/`--token`. Prefer env vars over the credential flags so secrets stay out of argv.

Dates are ISO 8601; names and etags are always strings. Folders have no `size`. Error objects always carry the `hint` and `status` keys, with `null` when there is no value.

## Finding things

- **Search the smallest folder you can.** `find /releases --name "*.zip"` walks just that folder, and the results include folders.
- For a whole-disk file search use `find / --type file` (or `--media-type`). That uses the REST file index, at about 25 s per 10k files; narrow it with `--media-type` (filtered server-side) and `--limit`. A plain `find /` walks every folder on the disk, which is slower still.
- Progress (`N scanned`) is printed on stderr.
- `--media-type` accepts: `audio`, `backup`, `book`, `compressed`, `data`, `development`, `diskimage`, `document`, `encoded`, `executable`, `flash`, `font`, `image`, `settings`, `spreadsheet`, `text`, `unknown`, `video`, `web`.

## Undo a delete

```bash
yadisk rm /releases/old.zip --json                       # trashed: true
yadisk trash ls --origin /releases/old.zip --limit 1 --json | jq -r '.[0].path'
yadisk trash restore "trash:/old.zip_1f2e…" --json      # → {path: "/releases/old.zip"}
```

`trash ls` reads the whole trash (several seconds on big trashes), because the API can't sort by deletion time. Always use `--origin` to find a specific item. `trash restore` refuses `trash:/` itself, which would mean the whole trash. `--overwrite` never replaces a folder; restore that under another `--name` instead.

## Auth

- **Token** (`cloud_api:disk.read` + `cloud_api:disk.write`): `--token` → `YADISK_TOKEN` → config `token`. It's enough on its own.
- **App password**: `--username`/`--password` → `YADISK_USERNAME`/`YADISK_PASSWORD` → config. Used for WebDAV, or as the fallback.
- `yadisk auth` / `yadisk auth --oauth` are interactive. When stdin is closed they fail with exit 2 instead of hanging, and they accept piped input one value per line. `auth --oauth` reports which scopes the token has.

## Workflows

```bash
# Upload + publish, then read the URL
yadisk upload ./build.zip /releases/ --publish --json | jq -r .public_url

# Idempotent upload (safe to re-run)
yadisk upload ./build.zip /releases/build.zip --skip-if-same --json

# Parent folder missing → exit 5 with hint; create it and retry
yadisk mkdir /releases/2026 --json; yadisk upload ./build.zip /releases/2026/ --json

# Grab a whole folder
yadisk download /releases/2026 ./out/ --json             # → ./out/2026.zip

# Someone shared a link
yadisk public ls https://disk.yandex.ru/d/AbCd --json
yadisk public download https://disk.yandex.ru/d/AbCd --path /docs/spec.pdf ./ --json
```

## Programmatic API

```typescript
import { PublicClient, YaDiskClient, getCredentials, isYaDiskError } from "@vforsh/yadisk"

const client = new YaDiskClient(getCredentials(), { timeoutMs: 600_000, retries: 2 })
client.backend // "rest" | "webdav"
const result = await client.upload("/uploads/build.zip", "./build.zip", { skipIfSame: true })
const url = await client.publish(result.path)
const zips = await client.find("/uploads", { name: "*.zip" })
const { trashed } = await client.delete("/uploads/old.zip")
const [item] = await client.trashList({ origin: "/uploads/old.zip", limit: 1 })
await client.trashRestore(item.path)

await new PublicClient().download("https://disk.yandex.ru/d/AbCd", "./out/")

try {
  await client.stat("/missing")
} catch (err) {
  if (isYaDiskError(err, "not_found")) { /* … */ }
}
```

Every failure is thrown as a `YaDiskError` carrying `code`, `status` and `hint`. `getCredentials()` throws `code: "auth"` when neither a token nor an app password is found; it never exits the process.
