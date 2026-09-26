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

/** `yadisk job` on a job that hasn't finished: not a failure, but not a result either. */
export const EXIT_RUNNING = 9

// Checked against argv too: errors can fire before Commander has parsed options (e.g. usage errors).
export function isJson(): boolean {
  return process.argv.includes("--json")
}

/** stdout = the command's result: JSON with --json, human text otherwise. */
export function emit(data: unknown, human: string): void {
  console.log(isJson() ? toJson(data) : human)
}

/** A partial success: every entry is printed, and the exit code is the first failure's. */
export function emitWithFailures(data: unknown, human: string, failures: YaDiskError[]): void {
  emit(data, human)
  if (failures.length) process.exitCode = exitCodeFor(failures[0])
}

/** stderr = diagnostics (warnings, progress, retries); never mixed into stdout. */
export function warn(message: string): void {
  console.error(chalk.yellow(message))
}

export function note(message: string): void {
  console.error(chalk.dim(message))
}

/** Keeps only `fields` of each item (all of them when unset). Absent fields stay absent. */
export function pick<T extends object>(data: T, fields?: string[]): Partial<T>
export function pick<T extends object>(data: T[], fields?: string[]): Partial<T>[]
export function pick<T extends object>(data: T | T[], fields?: string[]): Partial<T> | Partial<T>[] {
  if (!fields) return data
  if (Array.isArray(data)) return data.map((item) => pick(item, fields))
  return Object.fromEntries(Object.entries(data).filter(([key]) => fields.includes(key))) as Partial<T>
}

export function asYaDiskError(err: unknown): YaDiskError {
  return err instanceof YaDiskError ? err : new YaDiskError("unknown", errorMessage(err), { cause: err })
}

export function exitCodeFor(error: YaDiskError): number {
  // `?? unknown`: a newer library may add codes this CLI doesn't know; process.exit(undefined) would exit 0.
  return EXIT_CODES[error.code] ?? EXIT_CODES.unknown
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

  const error = asYaDiskError(err)
  if (isJson()) {
    printJsonError(error)
  } else {
    console.error(chalk.red(`Error: ${error.message}`))
    if (error.hint) console.error(chalk.dim(`Hint: ${error.hint}`))
  }
  process.exit(exitCodeFor(error))
}

// Indented for people at a terminal; compact when piped to an agent or a parser, where whitespace is just tokens.
function toJson(data: unknown): string {
  return JSON.stringify(data, null, process.stdout.isTTY ? 2 : undefined)
}

function printJsonError(error: YaDiskError): void {
  console.log(toJson({ error: error.toJSON() }))
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
