import type { Backend, ListPage } from "./backend"
import { YaDiskError, bodySnippet, httpError, isYaDiskError } from "./errors"
import { fetchWithTimeout, transportError, withRetry, type RetryOptions } from "./http"
import { parentPath } from "./path"
import type { DiskInfo, Resource } from "./types"
import {
  QUOTA_PROPFIND,
  RESOURCE_PROPFIND,
  PUBLIC_URL_PROPFIND,
  PUBLISH_PROPPATCH,
  UNPUBLISH_PROPPATCH,
  parseQuota,
  parseMultiStatus,
  parsePublicUrl,
} from "./webdav"

const BASE_URL = "https://webdav.yandex.ru"
// Methods safe to resend after a lost response. MKCOL/DELETE/COPY/MOVE would surface misleading 404/409s on retry.
const IDEMPOTENT_METHODS = new Set(["GET", "PROPFIND", "PUT", "PROPPATCH"])
const XML_HEADERS = { "Content-Type": "application/xml; charset=utf-8" }

type RequestOptions = { body?: BodyInit | null; headers?: Record<string, string> }

export class DavBackend implements Backend {
  readonly kind = "webdav"

  constructor(
    private authHeader: string,
    private timeoutMs: number | undefined,
    private retry: RetryOptions
  ) {}

  async info(): Promise<DiskInfo> {
    const response = await this.request("PROPFIND", "/", { body: QUOTA_PROPFIND, headers: { ...XML_HEADERS, Depth: "0" } })
    return parseQuota(await this.readText(response))
  }

  async stat(path: string): Promise<Resource> {
    const response = await this.request("PROPFIND", path, {
      body: RESOURCE_PROPFIND,
      headers: { ...XML_HEADERS, Depth: "0" },
    })
    return parseMultiStatus(await this.readText(response), path)[0]
  }

  // PROPFIND has no paging: return everything from `offset` in one page (the caller truncates to its limit)
  // rather than re-fetching the whole folder per page.
  async list(path: string, _limit: number, offset: number): Promise<ListPage> {
    const response = await this.request("PROPFIND", path, {
      body: RESOURCE_PROPFIND,
      headers: { ...XML_HEADERS, Depth: "1" },
    })
    const resources = parseMultiStatus(await this.readText(response), path)
    // Depth:1 includes the target itself; for a file it is the only entry.
    const selfIndex = Math.max(0, resources.findIndex((r) => r.path === path))
    const items = resources.filter((_, i) => i !== selfIndex)
    return { self: resources[selfIndex], items: items.slice(offset), total: items.length }
  }

  async mkdir(path: string): Promise<void> {
    try {
      await this.request("MKCOL", path)
    } catch (err) {
      if (isYaDiskError(err) && err.status === 405) {
        throw new YaDiskError("already_exists", `Already exists: ${path}`, { status: 405 })
      }
      throw err
    }
  }

  async delete(path: string): Promise<undefined> {
    await this.request("DELETE", path)
    return undefined
  }

  async transfer(kind: "copy" | "move", from: string, to: string, overwrite: boolean): Promise<void> {
    try {
      await this.request(kind === "copy" ? "COPY" : "MOVE", from, {
        headers: { Destination: davUrl(to), Overwrite: overwrite ? "T" : "F" },
      })
    } catch (err) {
      if (isYaDiskError(err) && err.status === 412) {
        throw new YaDiskError("already_exists", `Destination already exists: ${to}`, { status: 412 })
      }
      throw err
    }
  }

  async publish(path: string): Promise<string | undefined> {
    const published = await this.request("PROPPATCH", path, { body: PUBLISH_PROPPATCH, headers: XML_HEADERS })
    const url = parsePublicUrl(await this.readText(published))
    if (url) return url
    // Already-public resources answer the PROPPATCH without the URL; read it back.
    const current = await this.request("PROPFIND", path, { body: PUBLIC_URL_PROPFIND, headers: { ...XML_HEADERS, Depth: "0" } })
    return parsePublicUrl(await this.readText(current))
  }

  async unpublish(path: string): Promise<void> {
    await this.request("PROPPATCH", path, { body: UNPUBLISH_PROPPATCH, headers: XML_HEADERS })
  }

  async download(path: string): Promise<Response> {
    try {
      return await this.request("GET", path)
    } catch (err) {
      // Yandex answers GET on a folder with 415.
      if (!isYaDiskError(err) || err.status !== 415) throw err
      throw new YaDiskError("is_a_directory", `Is a directory: ${path}`, {
        status: 415,
        hint: "Folders download as zip only via the REST API — run: yadisk auth --oauth",
      })
    }
  }

  async upload(path: string, localFile: string): Promise<void> {
    await this.request("PUT", path, { body: Bun.file(localFile) })
  }

  private request(method: string, path: string, options?: RequestOptions): Promise<Response> {
    const send = () => this.send(method, path, options)
    return IDEMPOTENT_METHODS.has(method) ? withRetry(send, this.retry) : send()
  }

  private async send(method: string, path: string, options?: RequestOptions): Promise<Response> {
    const headers = { Authorization: this.authHeader, ...options?.headers }
    const response = await fetchWithTimeout(davUrl(path), { method, headers, body: options?.body }, this.timeoutMs)
    if (response.ok) return response

    let detail = ""
    try {
      detail = bodySnippet(await response.text())
    } catch {}
    const status = `${response.status} ${response.statusText}`.trim()
    throw httpError(response.status, `WebDAV ${status}: ${method} ${path}${detail ? ` — ${detail}` : ""}`, {
      hint: hintForStatus(response.status, path),
      retryAfter: response.headers.get("retry-after"),
    })
  }

  private async readText(response: Response): Promise<string> {
    try {
      return await response.text()
    } catch (err) {
      throw transportError(err, this.timeoutMs)
    }
  }
}

function hintForStatus(status: number, path: string): string | undefined {
  if (status === 401) return "Check username and app password — run: yadisk auth"
  if (status === 404) return `Check the path: yadisk ls ${parentPath(path)}`
  if (status === 507) return "Disk is full — check: yadisk info"
  return undefined
}

function davUrl(normalizedPath: string): string {
  return BASE_URL + normalizedPath.split("/").map(encodeURIComponent).join("/")
}
