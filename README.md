# yadisk

![yadisk cover](cover.png)

Yandex.Disk file management — programmatic API + CLI via [WebDAV](https://yandex.ru/dev/disk/doc/en/). Upload, download, list, copy, move, delete, publish files.

## Install

Requires [Bun](https://bun.sh/).

```bash
git clone https://github.com/vforsh/yadisk.git
cd yadisk
bun install
cd packages/cli && bun link
```

## Auth

Uses [app passwords](https://id.yandex.ru/security/app-passwords) — no OAuth app registration needed.

### 1. Create an app password

1. Open [Yandex ID](https://id.yandex.ru/) → **Безопасность** (Security) in the left sidebar
2. Scroll to **Пароли приложений** (App passwords) → click **Файлы — WebDAV**
3. Enter any name (e.g. `yadisk-cli`) → copy the generated password

### 2. Authenticate

```bash
yadisk auth
```

Prompts for username and app password → validates via WebDAV → saves to `~/.config/yadisk/config.json`.

### Credentials resolution

First match wins:

1. `--username` + `--password` flags
2. `YADISK_USERNAME` + `YADISK_PASSWORD` env vars
3. `~/.config/yadisk/config.json` file

## Usage

```bash
yadisk info                                  # disk usage/capacity
yadisk ls <path> [--sort name|size|modified]  # list folder
yadisk stat <path>                           # file/folder metadata
yadisk mkdir <path>                          # create folder
yadisk upload <file> [dest] [--publish]       # upload + optional publish
yadisk download <path> [local-dest]          # download file
yadisk cp <from> <to> [--overwrite]          # copy
yadisk mv <from> <to> [--overwrite]          # move/rename
yadisk rm <path>                             # delete
yadisk publish <path>                        # make public, print URL
yadisk unpublish <path>                      # remove public access
```

Global flags: `--json` (raw JSON output), `--username`/`--password` (override auth).

## Programmatic Usage

Import `@vforsh/yadisk` in your own scripts or packages:

```typescript
import { YaDiskClient, getCredentials } from "@vforsh/yadisk"

const credentials = getCredentials()
const client = new YaDiskClient(credentials)

// Upload and publish
await client.upload("/uploads/build.zip", "./build.zip")
const url = await client.publish("/uploads/build.zip")

// List folder
const items = await client.list("/uploads")

// Delete
await client.delete("/uploads/old-build.zip")
```

## Examples

```bash
# Upload and publish a build
yadisk upload ./build.zip /uploads/build.zip --publish

# List recent uploads
yadisk ls /uploads --sort -modified

# Download a file
yadisk download /uploads/build.zip ./build.zip

# Bulk upload
for f in dist/*.zip; do
  yadisk upload "$f" "/releases/$(basename "$f")" --publish
done
```
