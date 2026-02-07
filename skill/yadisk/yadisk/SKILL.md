---
name: yadisk
description: >
  Upload, download, and manage files on Yandex.Disk via the `yadisk` CLI.
  Use when the user wants to: (1) upload files to Yandex.Disk, (2) download files from Yandex.Disk,
  (3) list/browse Yandex.Disk contents, (4) create/delete/move/copy files or folders on Yandex.Disk,
  (5) publish or unpublish resources, (6) check Yandex.Disk usage, (7) authenticate with Yandex.Disk OAuth.
---

# yadisk CLI

Bun-based CLI at `~/dev/yadisk/` for Yandex.Disk REST API. Globally linked as `yadisk`.

## Auth

Token resolution: `--token` flag → `YADISK_TOKEN` env → `~/.config/yadisk/token` file.

```bash
# First-time setup — opens OAuth URL, prompts for token, saves to ~/.config/yadisk/token
yadisk auth --client-id <app-client-id>

# Or set env var
export YADISK_TOKEN=<token>
```

## Commands

```bash
yadisk info                                  # disk usage/capacity
yadisk ls <path> [--limit N] [--sort X]      # list folder
yadisk stat <path>                           # file/folder metadata
yadisk mkdir <path>                          # create folder
yadisk upload <file> <dest> [--publish]      # upload; --publish prints public URL
yadisk download <path> [local-dest]          # download to local file
yadisk cp <from> <to> [--overwrite]          # copy
yadisk mv <from> <to> [--overwrite]          # move/rename
yadisk rm <path> [--permanently]             # delete (default: to trash)
yadisk publish <path>                        # make public, print URL
yadisk unpublish <path>                      # remove public access
```

Global flags: `--json` (raw JSON), `--token <t>` (override token).

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
yadisk ls /uploads --limit 50 --sort -modified
yadisk download /uploads/build.zip ./build.zip
```

