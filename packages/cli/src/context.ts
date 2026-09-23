import { Command } from "commander"
import { YaDiskClient, YaDiskError, getCredentials } from "@vforsh/yadisk"
import type { ClientOptions } from "@vforsh/yadisk"
import { note, warn } from "./output"

export const program = new Command()

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

/** Appends an "Examples:" block to a command's --help. */
export function examples(lines: string[]): string {
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
