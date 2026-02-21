---
name: yadisk
description: >
  Upload, download, and manage files on Yandex.Disk via the `yadisk` CLI or `@vforsh/yadisk` API.
  Use when the user wants to: (1) upload files to Yandex.Disk, (2) download files from Yandex.Disk,
  (3) list/browse Yandex.Disk contents, (4) create/delete/move/copy files or folders on Yandex.Disk,
  (5) publish or unpublish resources, (6) check Yandex.Disk usage, (7) authenticate with Yandex.Disk.
---

# yadisk

Bun-based monorepo at `~/dev/yadisk/` for Yandex.Disk WebDAV API. Two packages: `@vforsh/yadisk` (programmatic API) and `@vforsh/yadisk-cli` (CLI, globally linked as `yadisk`).

## Auth

Uses app passwords with Basic auth. Credentials resolution: `--username`/`--password` flags → `YADISK_USERNAME`/`YADISK_PASSWORD` env → `~/.config/yadisk/config.json` file.

```bash
# First-time setup — prompts for username + app password, validates, saves to config
yadisk auth

# Or set env vars
export YADISK_USERNAME=user
export YADISK_PASSWORD=app-password
```

## Commands

```bash
yadisk info                                  # disk usage/capacity
yadisk ls <path> [--sort name|size|modified]  # list folder
yadisk stat <path>                           # file/folder metadata
yadisk mkdir <path>                          # create folder
yadisk upload <file> [dest] [--publish]       # upload; --publish prints public URL
yadisk download <path> [local-dest]          # download to local file
yadisk cp <from> <to> [--overwrite]          # copy
yadisk mv <from> <to> [--overwrite]          # move/rename
yadisk rm <path>                             # delete
yadisk publish <path>                        # make public, print URL
yadisk unpublish <path>                      # remove public access
```

Global flags: `--json` (raw JSON), `--username <u>` / `--password <p>` (override credentials).

## Common Workflows

### Upload and publish

```bash
yadisk upload ./build.zip /uploads/build.zip --publish
# prints public URL on success
```

### Bulk upload (shell loop)

```bash
for f in dist/*.zip; do
  yadisk upload "$f" "/releases/$(basename "$f")" --publish
done
```

### Browse and download

```bash
yadisk ls /uploads --sort -modified
yadisk download /uploads/build.zip ./build.zip
```

## Programmatic API

Import `@vforsh/yadisk` in scripts or other packages:

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
