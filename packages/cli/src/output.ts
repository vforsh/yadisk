import chalk from "chalk"
import { CommanderError } from "commander"
import { YaDiskError } from "@vforsh/yadisk"
import type { ErrorCode } from "@vforsh/yadisk"

export const EXIT_CODES: Record<ErrorCode, number> = {
  unknown: 1,
  usage: 2,
  auth: 3,
  not_found: 4,
  local_not_found: 4,
  already_exists: 5,
  conflict: 5,
  not_a_directory: 5,
  is_a_directory: 5,
  forbidden: 5,
  network: 6,
  timeout: 6,
  rate_limited: 6,
  server: 6,
  quota: 7,
  verify_failed: 8,
}

// Checked against argv too: errors can fire before Commander has parsed options (e.g. usage errors).
export function isJson(): boolean {
  return process.argv.includes("--json")
}

/** stdout = the command's result: JSON with --json, human text otherwise. */
export function emit(data: unknown, human: string): void {
  console.log(isJson() ? JSON.stringify(data, null, 2) : human)
}

/** stderr = diagnostics (warnings, progress, retries); never mixed into stdout. */
export function warn(message: string): void {
  console.error(chalk.yellow(message))
}

export function note(message: string): void {
  console.error(chalk.dim(message))
}

export function handleError(err: unknown): never {
  if (err instanceof CommanderError) {
    if (err.exitCode === 0) process.exit(0)
    // Commander already printed the message (or help, for a missing subcommand) to stderr in human mode.
    if (isJson()) {
      const missingCommand = err.code === "commander.help"
      const message = missingCommand ? "Missing command" : err.message.replace(/^error: /, "")
      printJsonError(new YaDiskError("usage", message, { hint: missingCommand ? "Run: yadisk --help" : undefined }))
    }
    process.exit(EXIT_CODES.usage)
  }

  const error = err instanceof YaDiskError ? err : new YaDiskError("unknown", errorMessage(err), { cause: err })
  if (isJson()) {
    printJsonError(error)
  } else {
    console.error(chalk.red(`Error: ${error.message}`))
    if (error.hint) console.error(chalk.dim(`Hint: ${error.hint}`))
  }
  // `?? 1`: a newer library may add codes this CLI doesn't know; process.exit(undefined) would exit 0.
  process.exit(EXIT_CODES[error.code] ?? EXIT_CODES.unknown)
}

function printJsonError(error: YaDiskError): void {
  console.log(JSON.stringify({ error: error.toJSON() }, null, 2))
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
