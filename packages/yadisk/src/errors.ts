export type ErrorCode =
  | "usage"
  | "auth"
  | "not_found"
  | "local_not_found"
  | "already_exists"
  | "conflict"
  | "not_a_directory"
  | "is_a_directory"
  | "forbidden"
  | "quota"
  | "rate_limited"
  | "server"
  | "network"
  | "timeout"
  | "verify_failed"
  | "unknown"

const RETRYABLE = new Set<ErrorCode>(["rate_limited", "server", "network"])

export interface YaDiskErrorOptions {
  status?: number
  hint?: string
  retryAfterMs?: number
  cause?: unknown
}

export class YaDiskError extends Error {
  readonly code: ErrorCode
  readonly status?: number
  hint?: string
  readonly retryAfterMs?: number

  constructor(code: ErrorCode, message: string, options?: YaDiskErrorOptions) {
    super(message, { cause: options?.cause })
    this.name = "YaDiskError"
    this.code = code
    this.status = options?.status
    this.hint = options?.hint
    this.retryAfterMs = options?.retryAfterMs
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code)
  }

  toJSON() {
    return { code: this.code, message: this.message, hint: this.hint ?? null, status: this.status ?? null }
  }
}

export function isYaDiskError(err: unknown, code?: ErrorCode): err is YaDiskError {
  return err instanceof YaDiskError && (code === undefined || err.code === code)
}

export function codeForStatus(status: number): ErrorCode {
  if (status === 401) return "auth"
  // WebDAV also uses 403 for refused operations (e.g. COPY onto itself), so it is not an auth failure.
  if (status === 403) return "forbidden"
  if (status === 404) return "not_found"
  if (status === 409 || status === 412 || status === 423) return "conflict"
  if (status === 413 || status === 507) return "quota"
  if (status === 429) return "rate_limited"
  if (status >= 500) return "server"
  return "unknown"
}

export function httpError(
  status: number,
  message: string,
  options?: { hint?: string; retryAfter?: string | null }
): YaDiskError {
  return new YaDiskError(codeForStatus(status), message, {
    status,
    hint: options?.hint,
    retryAfterMs: parseRetryAfter(options?.retryAfter),
  })
}

export function parseRetryAfter(value?: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return seconds * 1000
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

// Error bodies are XML/HTML/JSON of varying shape; keep only a short plain-text snippet.
export function bodySnippet(text: string): string {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)
}
