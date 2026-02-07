# yadisk

![yadisk cover](cover.png)

CLI tool for Yandex.Disk file management. Upload, download, list, copy, move, delete, publish files — all from the terminal.

## Install

Requires [Bun](https://bun.sh/).

```bash
git clone https://github.com/vforsh/yadisk.git
cd yadisk
bun install
bun link
```

## Auth

Get an OAuth token from [Yandex OAuth](https://oauth.yandex.ru/) and provide it via:

1. `--token` flag
2. `YADISK_TOKEN` environment variable
3. Config file at `~/.config/yadisk/token`
4. Interactive OAuth flow:

```bash
yadisk auth --client-id <your-app-client-id>
```

## Usage

```bash
yadisk info                                  # disk usage/capacity
yadisk ls <path> [--limit N] [--sort X]      # list folder
yadisk stat <path>                           # file/folder metadata
yadisk mkdir <path>                          # create folder
yadisk upload <file> <dest> [--publish]      # upload + optional publish
yadisk download <path> [local-dest]          # download file
yadisk cp <from> <to> [--overwrite]          # copy
yadisk mv <from> <to> [--overwrite]          # move/rename
yadisk rm <path> [--permanently]             # delete
yadisk publish <path>                        # make public, print URL
yadisk unpublish <path>                      # remove public access
```

Global flags: `--json` (raw JSON output), `--token <token>` (override auth).

## Examples

```bash
# Upload and publish a build
yadisk upload ./build.zip /uploads/build.zip --publish

# List recent uploads
yadisk ls /uploads --limit 50 --sort -modified

# Download a file
yadisk download /uploads/build.zip ./build.zip

# Bulk upload
for f in dist/*.zip; do
  yadisk upload "$f" "/releases/$(basename "$f")" --publish
done
```
