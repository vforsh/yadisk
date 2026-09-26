#!/usr/bin/env bun

import { registerAuth } from "./commands/auth"
import { registerConfig } from "./commands/config"
import { registerFileCommands } from "./commands/files"
import { registerJobCommands } from "./commands/jobs"
import { registerRestCommands } from "./commands/rest-only"
import { registerTransferCommands } from "./commands/transfer"
import { registerUploadCommand } from "./commands/upload"
import { program } from "./context"
import { recordJobExit } from "./jobs"
import { handleError, isJson } from "./output"

recordJobExit()

const { version } = await Bun.file(new URL("../package.json", import.meta.url)).json()

const EXIT_CODES_HELP = `
Output:
  stdout carries the result (JSON with --json); stderr carries warnings, progress and retries.
  With --json, failures print {"error":{"code","message","hint","status"}} to stdout.
  JSON is compact unless stdout is a terminal; --fields a,b trims ls/stat/find/trash ls/public output.
  Several inputs (stat a b, upload a b dir/, upload -r) → an array with {…, error} for failed items,
  exit code of the first failure.

Exit codes:
  0 ok · 1 unknown · 2 usage · 3 auth · 4 not found · 5 exists/conflict/refused
  6 network/timeout/rate-limit/server · 7 quota · 8 upload verification failed · 9 job still running

Long transfers:
  upload/download/upload-url/find/public download --detach → {job_id} at once;
  yadisk job <id> --wait 100 → the command's result and exit code (9 while running).

Backends:
  With an OAuth token (yadisk auth --oauth / YADISK_TOKEN) everything runs on the REST API:
  fast uploads, md5+sha256+public_url in stat, trash, find, upload-url, folder zip downloads.
  With only an app password (yadisk auth) it runs on WebDAV. Token rejected → falls back to WebDAV.

Examples:
  yadisk status --json                     # backend, login, which credentials work
  yadisk ls /uploads --sort -modified --limit 5 --fields path,size,modified --json
  yadisk upload ./build.zip /uploads/ -p --skip-if-same --publish --json
  yadisk upload -r ./dist /uploads/dist --skip-if-same --json
  yadisk stat /uploads/build.zip --json   # exit 4 when missing
  yadisk cat /notes/todo.md
  yadisk rm /uploads/old -r --dry-run --json
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
registerUploadCommand(program)
registerTransferCommands(program)
registerRestCommands(program)
registerJobCommands(program)

program.parseAsync().catch(handleError)
