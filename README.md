# yadisk

![yadisk cover](cover.png)

Yandex.Disk file management: a programmatic API plus a CLI built for AI agents. It runs on the [REST API](https://yandex.ru/dev/disk/doc/en/) when an OAuth token is set, and on WebDAV with an app password.

It can upload, download (folders as zip), list, find, copy, move, delete to the trash and restore, publish, read public links, and have Yandex fetch a URL straight into the disk.

## Install

Requires [Bun](https://bun.sh/).

```bash
git clone https://github.com/vforsh/yadisk.git
cd yadisk
bun install
cd packages/cli && bun link
```

## Auth

An **OAuth token** is recommended, and it is all you need. With a token, everything runs on the REST API:
- fast uploads
- md5/sha256/public URL in `stat`
- trash with restore
- `find`, `upload-url`, and zip downloads of folders

An **app password** gives you WebDAV only. That covers the core commands, but uploads are throttled to ~60 s/MB. If you configure both, WebDAV is used as the fallback when REST rejects the token.

### OAuth token (recommended)

1. Create an app at [oauth.yandex.com/client/new](https://oauth.yandex.com/client/new/):
   - platform **Web services**
   - redirect URI `https://oauth.yandex.ru/verification_code`
   - permissions **Yandex.Disk REST API → `cloud_api:disk.read` and `cloud_api:disk.write`**
2. Run:

```bash
yadisk auth --oauth --client-id <client-id>
```

This prints the authorize URL. Grant access and paste the token. The CLI checks the token's read and write access, reports which scopes it has, and saves it to `~/.config/yadisk/config.json` as `token`.

A token with only `disk.write` still works: reads fall back to WebDAV if an app password is configured.

### App password (WebDAV)

1. Open [Yandex ID](https://id.yandex.ru/) → **Безопасность** (Security) → **Пароли приложений** (App passwords) → **Файлы — WebDAV**
2. Run `yadisk auth`. It prompts for your username and app password, validates them via WebDAV, and saves them to `~/.config/yadisk/config.json`.

### Credentials resolution

- Token: `--token` flag → `YADISK_TOKEN` env → `token` in config.
- App password: `--username` + `--password` flags → `YADISK_USERNAME` + `YADISK_PASSWORD` env → config file.
- Either one is enough.

## Usage

```bash
yadisk info                                    # usage, capacity, trash size, max file size
yadisk ls [path] [--sort name|size|modified] [--limit n] [--offset n]
yadisk stat <path>                             # metadata incl. md5/sha256/public_url (exit 4 if missing)
yadisk find [path] [--name glob] [--type file|dir] [--max-depth n] [--limit n] [--media-type t]
yadisk mkdir <path>
yadisk upload <file> [dest] [--publish] [--skip-if-same] [--no-verify]
yadisk upload-url <url> <dest>                 # Yandex fetches the URL itself
yadisk download <path> [local-dest]            # folders download as .zip
yadisk cp <from> <to> [--overwrite]
yadisk mv <from> <to> [--overwrite]
yadisk rm <path>                               # to the trash (REST)
yadisk trash ls [--origin path] [--limit n]    # newest first
yadisk trash restore <trash-path> [--name n] [--overwrite]
yadisk publish <path> / unpublish <path>
yadisk public stat|ls|download <url> [--path p]   # anyone's public link, no credentials
```

`yadisk <command> --help` shows examples for that command.

Global flags:
- `--json`: JSON results and errors.
- `--username`/`--password`/`--token`: override auth.
- `--timeout <sec>`: per-request timeout; default none. Bun's implicit 5-min idle timeout is disabled so slow uploads don't die.
- `--retries <n>`: retries on network errors, 429 and 5xx; default 2.

Paths:
- `uploads/x`, `/uploads/x` and `disk:/uploads/x` are the same path.
- A destination ending in `/` means "into this folder" for `upload`, `upload-url`, `cp`, `mv` and `download`.
- Empty paths and `.`/`..` segments are rejected, and `rm`/`cp`/`mv`/`publish` refuse to act on the disk root.
- `--overwrite` only replaces files; an existing destination folder is an error.

### Uploads

- Before starting, `upload` prints an estimate: about 8 s/MB via REST, about 60 s/MB via WebDAV. Without a TTY it also prints a heartbeat line to stderr every 15 s.
- With a token, a file larger than the account's `max_file_size` or the free space is rejected before the upload starts.
- After upload, the remote size and md5 are compared with the local file (`--no-verify` to skip). `verified: true` means the md5 matched.
- `--skip-if-same` skips the upload when the remote file is already identical, so retries are safe.
- If a request times out, the CLI checks whether the file landed anyway before reporting failure.

### Find

- `find <folder>` walks that folder, 4 listings at a time; results include folders.
- `find / --type file` (or `--media-type`) uses the REST whole-disk file index instead. That is still about 25 s per 10k files, so narrow it with `--media-type` (filtered server-side) and `--limit`.

### Output contract

- stdout carries the result: JSON with `--json`, human text otherwise. stderr carries warnings, progress and retries.
- With `--json`, failures print `{"error":{"code","message","hint","status"}}` to stdout.

| Exit | Meaning |
|---|---|
| 0 | ok |
| 1 | unexpected error |
| 2 | usage / invalid input |
| 3 | auth failed / no credentials / feature needs a token |
| 4 | not found (remote or local) |
| 5 | already exists / conflict (e.g. missing parent) / not a directory / is a directory / forbidden |
| 6 | network / timeout / rate limited / server error (idempotent requests already retried) |
| 7 | quota (disk full, file too large) |
| 8 | upload verification failed |

## Programmatic Usage

```typescript
import { PublicClient, YaDiskClient, getCredentials, isYaDiskError } from "@vforsh/yadisk"

const client = new YaDiskClient(getCredentials(), { retries: 2 }) // getCredentials throws YaDiskError { code: "auth" }
client.backend // "rest" | "webdav"

// Upload (verified by size + md5) and publish
const { path } = await client.upload("/uploads/build.zip", "./build.zip", { skipIfSame: true })
const url = await client.publish(path)

// List, search, download
const items = await client.list("/uploads", { limit: 100 })
const zips = await client.find("/uploads", { name: "*.zip" })
await client.download("/uploads", "./out/") // → ./out/uploads.zip

// Delete and undo
await client.delete("/uploads/old.zip")
const [item] = await client.trashList({ origin: "/uploads/old.zip", limit: 1 })
await client.trashRestore(item.path)

// Anyone's public link
await new PublicClient().download("https://disk.yandex.ru/d/AbCd", "./")
```

Errors are thrown as `YaDiskError` with `code` (`not_found`, `conflict`, `auth`, …), `status` and `hint`; check with `isYaDiskError(err, "not_found")`.

## Examples

```bash
# Upload and publish a build
yadisk upload ./build.zip /uploads/ --publish

# List recent uploads
yadisk ls /uploads --sort -modified

# Find every zip under a folder
yadisk find /releases --name "*.zip"

# Mirror a remote file without downloading it locally
yadisk upload-url https://example.com/big.iso /isos/

# Bulk upload
for f in dist/*.zip; do
  yadisk upload "$f" /releases/ --skip-if-same --publish
done
```
