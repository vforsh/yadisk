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

- **Start with `yadisk status --json`** when unsure about auth: it reports the backend, login, and which credentials work (exit 3 if none do).
- **Always pass `--json`.** stdout carries exactly one JSON value: the result, or `{"error":{"code","message","hint","status"}}`. stderr carries warnings, progress and retries only. Don't merge the two streams (`2>&1`) before parsing. JSON is compact when piped.
- **Trim output with `--fields`** on `ls`, `stat`, `find`, `trash ls`, `public stat|ls`, e.g. `--fields path,type,size,modified`. That is about 3× fewer tokens than full resources.
- **Several inputs → an array.** `stat a b` and multi-file/`-r` uploads print one entry per item (a glob matching one file gives the single-file object); failed items are `{path, error}` (uploads add `local_path`), and the exit code is the first failure's.
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
| 9 | `yadisk job`: the job is still running — ask again | — |

- **Act on the `hint`.** It is usually the exact next command, e.g. `Create it first: yadisk mkdir -p /a`.
- **Check whether something exists:** `yadisk stat <path> --json` exits 4 when it's missing.
- **Paths:** `uploads/x`, `/uploads/x`, and `disk:/uploads/x` all mean the same thing. A trailing `/` on the destination of `upload`/`cp`/`mv`/`upload-url`/`download` means "into this folder". Empty paths and `.`/`..` segments are rejected (exit 2), and `rm`/`cp`/`mv`/`publish` refuse to act on the disk root.
- **`--overwrite` replaces files only.** A destination that is an existing folder fails with `is_a_directory` and a trailing-slash hint; don't force it.
- **Retry-safe variants:** `mkdir -p` (existing folder → `created: false`, exit 0), `upload -p` / `upload-url -p` (create missing parents), `upload --skip-if-same`, `download --skip-if-same`, `rm -f` (missing → `existed: false`, exit 0).
- **Deleting a folder:** `rm` refuses a non-empty folder (exit 5) unless you pass `-r`. Check first with `--dry-run`, which `rm`, `cp`, `mv` and `trash restore` all accept: it runs the same checks, changes nothing, and adds `dry_run: true`.
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
- A typical agent shell tool times out around 2 min. **For files over ~10 MB (REST) or ~1 MB (WebDAV), pass `--detach`.** It prints `{job_id, …}` right away and runs the upload in the background. Then call `yadisk job <id> --wait 100 --json` until the exit code isn't 9. Once done, the job report's `result` or `error` is the command's own output and the exit code is the command's own. `download`, `upload-url`, `find` and `public download` take `--detach` too.
- **Remote source?** `yadisk upload-url <url> <dest>` makes Yandex fetch the file itself, so nothing passes through this machine.
- Uploads are verified afterwards. `verified: true` means the remote size and md5 match; `false` means verification was skipped or the server exposed no md5. A mismatch exits 8.
- **Retrying is safe:** `--skip-if-same` skips the upload only when the remote size **and** md5 match. Always pass it when re-running after a timeout or crash.
- Network errors, 429 and 5xx are retried automatically (`--retries <n>`, default 2), but only for reads, uploads and publish. `mkdir`/`rm`/`cp`/`mv` are never retried, so after exit 6 run `stat` first to see whether they took effect, or re-run the idempotent form (`mkdir -p`, `rm -f`). Timeouts are not retried. A `Retry-After` over 30 s fails immediately and the wait appears in the hint.

## Commands

```bash
yadisk status                                  # {ready, backend, login, token, app_password, fallback}; alias whoami
yadisk info                                    # {used_bytes, available_bytes, total_bytes, trash_bytes?, max_file_size?, login?}
yadisk ls [path] [--sort [-]name|size|created|modified] [--limit n] [--offset n] [--fields …]
                                               # array of resources; sorted before limit/offset; default path /
yadisk stat <path...> [--fields …]             # {name, path, type, size, created, modified, md5, sha256?, content_type, media_type?, public_url?}
yadisk find [path] [--name glob] [--type file|dir] [--max-depth n] [--limit n] [--media-type t] [--fields …]
yadisk mkdir <path> [-p]                       # {path, created}; without -p exit 5 if it exists or parent is missing
yadisk upload <file> [dest] [--publish] [--skip-if-same] [--no-verify] [-p]
                                               # {local_path, path, size, md5, method, skipped, verified, public_url?, duration_ms}
yadisk upload <files/folders...> <dest-folder> [-r] [-p] [--concurrency n]   # array, one entry per file (one plain file → object)
yadisk upload - <dest>                         # stdin → file
yadisk upload-url <url> <dest> [-p]            # {url, ...resource}; REST
yadisk download <path> [local-dest] [--skip-if-same]   # {path, local_path, size, archive, skipped}; folders → .zip (REST)
yadisk cat <path> [--max-bytes n]              # raw bytes; --json: {path, size, encoding: utf8|base64, content}; default cap 1 MiB
yadisk cp <from> <to> [--overwrite] [--dry-run]   # {from, to, copied}; `to` = resolved destination
yadisk mv <from> <to> [--overwrite] [--dry-run]   # {from, to, moved}
yadisk rm <path> [-r] [-f] [--dry-run]         # {path, existed, deleted, type, trashed}; refuses / and non-empty folders without -r
yadisk trash ls [--origin path] [--limit n] [--fields …]   # newest first: [{name, path: "trash:/…", type, size, origin_path, deleted}]
yadisk trash restore <trash-path> [--name n] [--overwrite] [--dry-run]   # {trash_path, path, restored}
yadisk publish <path>                          # {path, public_url}
yadisk unpublish <path>                        # {path, published: false}
yadisk public stat|ls|download <url> [--path p]   # anyone's public link, no credentials
yadisk job <id> [--wait sec]                   # {job_id, status: running|done|failed|lost, result?, error?, progress?, log}
yadisk jobs                                    # background jobs, newest first (kept 7 days)
yadisk config get|set|list|unset               # keys: username, password, token, upload_dir
```

`upload` arguments work like `cp`. With one file, `dest` is the exact remote path, or a folder if it ends in `/`. With several sources, the last argument is the destination folder. `upload -r ./site /www/site` puts `./site/**` at `/www/site/**`; `upload -r ./site /www/` puts it at `/www/site/**`.

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

# Idempotent upload into a folder that may not exist yet (safe to re-run)
yadisk upload ./build.zip /releases/2026/ -p --skip-if-same --json

# Several files / a whole folder
yadisk upload dist/*.zip /releases/2026/ -p --skip-if-same --json | jq -c 'if type == "array" then .[] else . end | select(.error)'
yadisk upload -r ./site /www/site --skip-if-same --json

# Big upload without hitting the tool timeout
yadisk upload ./big.iso /isos/ --skip-if-same --detach --json   # → {"job_id":"1f2e3d4c",…}
yadisk job 1f2e3d4c --wait 100 --json                             # exit 9 = still running, repeat

# The 5 newest files in a folder
yadisk ls /releases --sort -modified --limit 5 --fields path,size,modified --json

# Read / write a small text file
yadisk cat /notes/todo.md
echo "- ship it" | yadisk upload - /notes/todo.md --json

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
const result = await client.upload("/uploads/build.zip", "./build.zip", { skipIfSame: true, parents: true })
const url = await client.publish(result.path)
const newest = await client.list("/uploads", { sort: "-modified", limit: 5 })
const zips = await client.find("/uploads", { name: "*.zip" })
await client.mkdir("/uploads/2026/09", { parents: true }) // false when it already existed
await client.move("/uploads/a.zip", "/archive/", { dryRun: true }) // checks only
const { trashed } = await client.delete("/uploads/old.zip") // { recursive: true } for a non-empty folder
const { resource, body } = await client.open("/notes/todo.md", { maxBytes: 1 << 20 })
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
