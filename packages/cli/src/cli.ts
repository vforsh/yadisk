#!/usr/bin/env bun

import { registerAuth } from "./commands/auth"
import { registerConfig } from "./commands/config"
import { registerFileCommands } from "./commands/files"
import { registerRestCommands } from "./commands/rest-only"
import { registerTransferCommands } from "./commands/transfer"
import { program } from "./context"
import { handleError, isJson } from "./output"

const { version } = await Bun.file(new URL("../package.json", import.meta.url)).json()

const EXIT_CODES_HELP = `
Output:
  stdout carries the result (JSON with --json); stderr carries warnings, progress and retries.
  With --json, failures print {"error":{"code","message","hint","status"}} to stdout.

Exit codes:
  0 ok · 1 unknown · 2 usage · 3 auth · 4 not found · 5 exists/conflict/refused
  6 network/timeout/rate-limit/server · 7 quota · 8 upload verification failed

Backends:
  With an OAuth token (yadisk auth --oauth / YADISK_TOKEN) everything runs on the REST API:
  fast uploads, md5+sha256+public_url in stat, trash, find, upload-url, folder zip downloads.
  With only an app password (yadisk auth) it runs on WebDAV. Token rejected → falls back to WebDAV.

Examples:
  yadisk ls /uploads --sort -modified --json
  yadisk upload ./build.zip /uploads/ --publish --json
  yadisk upload ./build.zip /uploads/build.zip --skip-if-same --json
  yadisk stat /uploads/build.zip --json   # exit 4 when missing
  yadisk find / --name "*.zip" --limit 20 --json
  yadisk <command> --help                  # per-command examples
`

// Settings below are inherited by subcommands, so they must precede command registration.
program
  .name("yadisk")
  .description("Yandex.Disk file management CLI")
  .version(version)
  .option("--username <username>", "Yandex username (overrides env)")
  .option("--password <password>", "App password (overrides env)")
  .option("--token <token>", "OAuth token for REST uploads (overrides env)")
  .option("--timeout <seconds>", "Per-request timeout in seconds (default: none)")
  .option("--retries <n>", "Retries on network errors, 429 and 5xx", "2")
  .option("--json", "Output as JSON (results and errors)")
  .addHelpText("after", EXIT_CODES_HELP)
  .exitOverride()
  .configureOutput({ outputError: (str, write) => !isJson() && write(str) })

registerAuth(program)
registerConfig(program)
registerFileCommands(program)
registerTransferCommands(program)
registerRestCommands(program)

program.parseAsync().catch(handleError)
