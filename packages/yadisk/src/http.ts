import { YaDiskError } from "./errors"

// Bun's fetch accepts `timeout: false` to disable its implicit 5-min idle timeout, but bun-types doesn't declare it.
type BunFetchInit = RequestInit & { timeout?: boolean }

const MAX_BACKOFF_MS = 8000
const LOCAL_IO_CODES = new Set(["EACCES", "EPERM", "ENOENT", "EISDIR", "EMFILE", "ENOSPC", "EROFS"])
// Longer server-requested waits would silently outlast a caller's tool timeout; fail fast instead.
const MAX_RETRY_AFTER_MS = 30_000

export interface RetryOptions {
  retries: number
  onRetry?: (err: YaDiskError, attempt: number, delayMs: number) => void
}

export const DEFAULT_RETRIES = 2

export function withRetryDefaults(options?: { retries?: number; onRetry?: RetryOptions["onRetry"] }): RetryOptions {
  return { retries: options?.retries ?? DEFAULT_RETRIES, onRetry: options?.onRetry }
}

// Yandex holds the upload response for ~60s/MB (WebDAV throttling), so any idle timeout would kill large uploads.
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
  const fetchInit: BunFetchInit = { ...init, timeout: false }
  if (timeoutMs) fetchInit.signal = AbortSignal.timeout(timeoutMs)
  try {
    return await fetch(url, fetchInit)
  } catch (err) {
    throw transportError(err, timeoutMs)
  }
}

export function transportError(err: unknown, timeoutMs?: number): YaDiskError {
  if (err instanceof YaDiskError) return err
  const name = err instanceof Error ? err.name : ""
  if (name === "TimeoutError" || name === "AbortError") {
    return new YaDiskError("timeout", `Request timed out after ${(timeoutMs ?? 0) / 1000}s`, {
      cause: err,
      hint: "Raise --timeout (0 = no timeout)",
    })
  }
  const message = err instanceof Error ? err.message : String(err)
  // Local I/O failures surface through fetch (e.g. reading the upload body); they are not transient.
  if (LOCAL_IO_CODES.has(String((err as { code?: unknown } | null)?.code))) {
    return new YaDiskError("usage", `Local I/O error: ${message}`, { cause: err })
  }
  return new YaDiskError("network", `Network error: ${message}`, { cause: err })
}

// Retries only errors marked retryable (network, 429, 5xx). Timeouts are the caller's explicit budget — not retried.
export async function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const retries = options?.retries ?? 0
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!(err instanceof YaDiskError) || !err.retryable || attempt >= retries) throw err
      if (err.retryAfterMs !== undefined && err.retryAfterMs > MAX_RETRY_AFTER_MS) {
        err.hint ??= `Server asked to retry after ${Math.ceil(err.retryAfterMs / 1000)}s`
        throw err
      }
      const backoff = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS) + Math.random() * 250
      const delayMs = err.retryAfterMs ?? backoff
      options?.onRetry?.(err, attempt + 1, delayMs)
      await Bun.sleep(delayMs)
    }
  }
}
