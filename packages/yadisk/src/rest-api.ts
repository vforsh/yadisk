import { YaDiskError, codeForStatus, parseRetryAfter, type ErrorCode } from "./errors"
import { fetchWithTimeout, transportError, withRetry, type RetryOptions } from "./http"
import { parentPath } from "./path"

const API_URL = "https://cloud-api.yandex.net/v1/disk"
const OPERATION_POLL_MS = 1000

export interface Link {
  href: string
  method: string
  templated?: boolean
  operation_id?: string
}

interface ApiErrorBody {
  error?: string
  message?: string
  description?: string
}

type Params = Record<string, string | number | boolean | undefined>

// Yandex REST error names → shared codes. Unknown names fall back to the HTTP status.
const API_ERROR_CODES: Record<string, ErrorCode> = {
  DiskNotFoundError: "not_found",
  DiskPathDoesntExistsError: "conflict",
  DiskPathPointsToExistentDirectoryError: "already_exists",
  DiskResourceAlreadyExistsError: "already_exists",
  FieldValidationError: "usage",
  UnauthorizedError: "auth",
  // App-level refusal (token lacks the scope) — treated as auth so the client can fall back to WebDAV.
  ForbiddenError: "auth",
  DiskInsufficientStorageError: "quota",
  PayloadTooLargeError: "quota",
  TooManyRequestsError: "rate_limited",
}

export class RestApi {
  constructor(
    private token: string | undefined,
    private timeoutMs: number | undefined,
    private retry: RetryOptions
  ) {}

  /** GET and explicitly idempotent calls are retried; everything else is sent once. */
  async call<T>(method: string, endpoint: string, params: Params = {}, options?: { idempotent?: boolean }): Promise<T> {
    const send = () => this.send<T>(method, endpoint, params)
    return method === "GET" || options?.idempotent ? withRetry(send, this.retry) : send()
  }

  /**
   * Follows a 202 operation link until it finishes. Once Yandex has accepted the operation, a polling failure must
   * not look like "nothing happened" (callers would retry or fall back and apply it twice), so it becomes `unknown`.
   */
  async settle(link: Link | undefined, what: string): Promise<void> {
    const id = link?.operation_id ?? operationIdFromHref(link?.href)
    if (!id) return
    while (true) {
      let status: string | undefined
      try {
        status = (await this.call<{ status?: string }>("GET", `/operations/${id}`)).status
      } catch (err) {
        throw new YaDiskError("unknown", `${what}: accepted, but its status could not be read (${(err as Error).message})`, {
          cause: err,
          hint: "It may have completed — check the result with: yadisk stat",
        })
      }
      if (status === "success") return
      if (status === "failed") throw new YaDiskError("server", `${what} failed (operation ${id})`)
      if (status !== "in-progress") {
        throw new YaDiskError("unknown", `${what}: unexpected operation status ${JSON.stringify(status)}`, {
          hint: "Check the result with: yadisk stat",
        })
      }
      await Bun.sleep(OPERATION_POLL_MS)
    }
  }

  /** Fetches a pre-signed downloader/uploader link (no auth header). */
  async follow(link: Link, init?: RequestInit): Promise<Response> {
    const response = await fetchWithTimeout(link.href, { method: link.method, ...init }, this.timeoutMs)
    if (response.ok) return response
    throw new YaDiskError(codeForStatus(response.status), `${link.method} ${new URL(link.href).host}: ${response.status} ${response.statusText}`, {
      status: response.status,
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
    })
  }

  private async send<T>(method: string, endpoint: string, params: Params): Promise<T> {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value))
    const url = `${API_URL}${endpoint}${query.size ? `?${query}` : ""}`
    const headers: Record<string, string> = { Accept: "application/json" }
    if (this.token) headers.Authorization = `OAuth ${this.token}`

    const response = await fetchWithTimeout(url, { method, headers }, this.timeoutMs)
    if (!response.ok) throw await apiError(response, method, endpoint, params)
    if (response.status === 204) return undefined as T
    try {
      const text = await response.text()
      return (text ? JSON.parse(text) : undefined) as T
    } catch (err) {
      if (err instanceof SyntaxError) throw new YaDiskError("server", `Invalid REST response: ${err.message}`)
      throw transportError(err, this.timeoutMs)
    }
  }
}

async function apiError(response: Response, method: string, endpoint: string, params: Params): Promise<YaDiskError> {
  let body: ApiErrorBody = {}
  try {
    body = (await response.json()) as ApiErrorBody
  } catch {}
  const code = (body.error && API_ERROR_CODES[body.error]) || codeForStatus(response.status)
  // copy/move: a 404 is about the source (`from`), not the destination (`path`).
  const target = response.status === 404 && params.from ? params.from : (params.path ?? params.public_key ?? "")
  const reason = body.description || body.message || response.statusText
  const name = body.error ? ` ${body.error}` : ""
  return new YaDiskError(code, `${reason} (REST ${response.status}${name}: ${method} ${endpoint} ${target})`.replace(/ \)$/, ")"), {
    status: response.status,
    hint: hintFor(code, params, target),
    retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
  })
}

function hintFor(code: ErrorCode, params: Params, target: Params[string]): string | undefined {
  if (code === "auth") return "OAuth token invalid, expired, or missing a scope — run: yadisk auth --oauth"
  if (code !== "not_found") return undefined
  if (params.public_key) return "Check the link and --path; the owner may have unpublished it"
  // Disk paths only: trash paths ("trash:/…") and operation ids get their hints from the caller.
  if (typeof target === "string" && target.startsWith("/")) return `Check the path: yadisk ls ${parentPath(target)}`
  return undefined
}

function operationIdFromHref(href?: string): string | undefined {
  const match = href?.match(/\/operations\/([^/?]+)/)
  return match?.[1]
}

/** Extracts the `path` query param Yandex embeds in resource links (e.g. after a trash restore). */
export function pathFromLink(link: Link | undefined): string | undefined {
  if (!link?.href) return undefined
  const path = new URL(link.href).searchParams.get("path")
  return path ?? undefined
}
