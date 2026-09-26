import { Command, Option } from "commander"
import { YaDiskClient, YaDiskError, getCredentials } from "@vforsh/yadisk"
import type { ClientOptions, Resource, SortField, TrashItem } from "@vforsh/yadisk"
import { note, warn } from "./output"

export const program = new Command()

export const RESOURCE_FIELDS = [
  "name", "path", "type", "size", "created", "modified", "md5", "sha256", "content_type", "media_type", "public_url", "etag",
] as const satisfies readonly (keyof Resource)[]
export const TRASH_FIELDS = ["name", "path", "type", "size", "origin_path", "deleted"] as const satisfies readonly (keyof TrashItem)[]

export function getClient(): YaDiskClient {
  // Options first: a malformed flag is a usage error even when credentials are missing.
  const options = getClientOptions()
  const opts = program.opts()
  const credentials = getCredentials({ username: opts.username, password: opts.password, token: opts.token })
  return new YaDiskClient(credentials, options)
}

export function getClientOptions(): ClientOptions {
  const retries = getRetries()
  return {
    timeoutMs: getTimeoutMs(),
    retries,
    onRetry: (err, attempt, delayMs) =>
      note(`Retry ${attempt}/${retries} in ${(delayMs / 1000).toFixed(1)}s after: ${err.message}`),
    onWarning: (message) => warn(`Warning: ${message}`),
  }
}

function getTimeoutMs(): number | undefined {
  const raw = program.opts().timeout
  if (raw === undefined) return undefined
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new YaDiskError("usage", `Invalid --timeout: ${raw}`, { hint: "Expected seconds, 0 = no timeout" })
  }
  return seconds === 0 ? undefined : seconds * 1000
}

/** Integer option parser; `min` 1 for --limit/--max-depth (0 would silently return nothing), 0 for --offset. */
export function parseCount(flag: string, min = 1): (raw: string) => number {
  return (raw) => {
    const value = Number(raw)
    if (!Number.isInteger(value) || value < min) {
      throw new YaDiskError("usage", `Invalid ${flag}: ${raw}`, { hint: `Expected an integer >= ${min}` })
    }
    return value
  }
}

/** `--fields a,b`: trims JSON output to those keys (unknown keys are a usage error). */
export function fieldsOption(allowed: readonly string[]): Option {
  return new Option("--fields <list>", `JSON keys to keep, comma-separated: ${allowed.join(",")}`).argParser((raw) => {
    const fields = raw.split(",").map((f) => f.trim()).filter(Boolean)
    const unknown = fields.filter((f) => !allowed.includes(f))
    if (!fields.length || unknown.length) {
      throw new YaDiskError("usage", `Invalid --fields: ${raw}`, { hint: `Valid fields: ${allowed.join(",")}` })
    }
    return fields
  })
}

const SORT_FIELDS: SortField[] = ["name", "size", "created", "modified"]

export function sortOption(): Option {
  return new Option("--sort <field>", "Sort field, applied before --limit/--offset; prefix - for descending")
    .choices(SORT_FIELDS.flatMap((f) => [f, `-${f}`]))
    .default("name")
}

export function dryRunOption(): Option {
  return new Option("--dry-run", "Run the checks a real run would fail on, change nothing (dry_run: true)")
}

export function dryRunFlag(options: { dryRun?: boolean }): { dry_run?: true } {
  return options.dryRun ? { dry_run: true } : {}
}

/** Appends an "Examples:" block to a command's --help. */
export function examples(lines: readonly string[]): string {
  return `\nExamples:\n${lines.map((l) => `  ${l}`).join("\n")}\n`
}

function getRetries(): number {
  const raw = program.opts().retries
  const retries = Number(raw)
  if (!Number.isInteger(retries) || retries < 0) {
    throw new YaDiskError("usage", `Invalid --retries: ${raw}`, { hint: "Expected a non-negative integer" })
  }
  return retries
}
