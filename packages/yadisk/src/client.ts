import type { Backend } from "./backend"
import { encodeBasicAuth } from "./auth"
import { DavBackend } from "./dav"
import { YaDiskError, isYaDiskError } from "./errors"
import { find } from "./find"
import { withRetry, withRetryDefaults, type RetryOptions } from "./http"
import { localFileSize, md5File, resolveLocalTarget, writeLocal } from "./local"
import { basenamePath, normalizePath, parentPath, refuseRoot } from "./path"
import { RestBackend } from "./rest"
import type {
  BackendKind,
  ClientOptions,
  Credentials,
  DiskInfo,
  DownloadResult,
  FindOptions,
  ListOptions,
  Resource,
  TrashItem,
  UploadOptions,
  UploadResult,
} from "./types"

const PAGE_SIZE = 1000
// Observed server-side response hold per MB; see AGENTS.md "Upload flow".
const SECONDS_PER_MB: Record<BackendKind, number> = { rest: 8, webdav: 60 }
const VERIFY_ATTEMPTS = 3
const VERIFY_DELAY_MS = 1000
const TRASH_CONCURRENCY = 4

export function estimateUploadSeconds(bytes: number, method: BackendKind): number {
  return Math.ceil((bytes / 1024 ** 2) * SECONDS_PER_MB[method]) + 2
}

/**
 * REST when an OAuth token is set (faster uploads, richer metadata, trash, find, zip downloads); WebDAV with an
 * app password otherwise. If REST rejects the token and an app password is configured, it falls back to WebDAV.
 */
export class YaDiskClient {
  private rest?: RestBackend
  private dav?: DavBackend
  private restRejected = false
  private retry: RetryOptions
  private onWarning?: (message: string) => void

  constructor(credentials: Credentials, options?: ClientOptions) {
    this.retry = withRetryDefaults(options)
    this.onWarning = options?.onWarning
    const { username, password, token } = credentials
    if (token) this.rest = new RestBackend(token, options?.timeoutMs, this.retry)
    if (username && password) this.dav = new DavBackend(encodeBasicAuth({ username, password }), options?.timeoutMs, this.retry)
    if (!this.rest && !this.dav) throw new YaDiskError("auth", "No credentials: pass an OAuth token or username + app password")
  }

  get backend(): BackendKind {
    return this.activeRest() ? "rest" : "webdav"
  }

  // --- Disk & resources ---

  info(): Promise<DiskInfo> {
    return this.run((b) => b.info())
  }

  stat(path: string): Promise<Resource> {
    const normalized = normalizePath(path)
    return this.run((b) => b.stat(normalized))
  }

  async exists(path: string): Promise<boolean> {
    return (await this.statIfExists(path)) !== undefined
  }

  async list(path: string, options?: ListOptions): Promise<Resource[]> {
    const normalized = normalizePath(path)
    const limit = options?.limit ?? Infinity
    let offset = options?.offset ?? 0
    const items: Resource[] = []
    while (items.length < limit) {
      const page = await this.run((b) => b.list(normalized, Math.min(PAGE_SIZE, limit - items.length), offset))
      if (page.self.type === "file") {
        throw new YaDiskError("not_a_directory", `Not a directory: ${normalized}`, {
          hint: `It is a file — use: yadisk stat ${normalized}`,
        })
      }
      items.push(...page.items)
      offset += page.items.length
      if (!page.items.length || offset >= page.total) break
    }
    return items.slice(0, limit)
  }

  /** Recursive search under `path`. Whole-disk file searches use the REST flat file index when available. */
  find(path: string, options: FindOptions = {}): Promise<Resource[]> {
    const rest = this.activeRest()
    if (options.mediaType && !rest) {
      return Promise.reject(new YaDiskError("auth", "--media-type requires an OAuth token (REST API)", {
        hint: "Run: yadisk auth --oauth, or filter with --name",
      }))
    }
    const root = normalizePath(path)
    const walk = () => find(root, options, { list: (dir) => this.list(dir) })
    if (!rest) return walk()
    return find(root, options, {
      list: (dir) => this.list(dir),
      files: (limit, offset, mediaType) => rest.files(limit, offset, mediaType),
    }).catch((err) => {
      if (!this.dav || options.mediaType || !isYaDiskError(err, "auth")) throw err
      this.rejectRest(err)
      return walk()
    })
  }

  async mkdir(path: string): Promise<void> {
    const normalized = normalizePath(path)
    try {
      await this.run((b) => b.mkdir(normalized))
    } catch (err) {
      if (!isYaDiskError(err, "conflict")) throw err
      if (await this.exists(normalized)) {
        throw new YaDiskError("already_exists", `Already exists: ${normalized}`, { status: err.status })
      }
      throw await this.explainMissingParent(normalized, err)
    }
  }

  /** Goes to the trash with REST (`trashed: true`); WebDAV can't report where it went (`trashed: undefined`). */
  async delete(path: string): Promise<{ trashed?: boolean }> {
    const normalized = refuseRoot(path, "delete")
    return { trashed: await this.run((b) => b.delete(normalized)) }
  }

  /** A destination ending in "/" means "into this folder". Returns the resolved destination. */
  copy(from: string, to: string, overwrite?: boolean): Promise<string> {
    return this.transfer("copy", from, to, overwrite ?? false)
  }

  /** A destination ending in "/" means "into this folder". Returns the resolved destination. */
  move(from: string, to: string, overwrite?: boolean): Promise<string> {
    return this.transfer("move", from, to, overwrite ?? false)
  }

  private async transfer(kind: "copy" | "move", from: string, to: string, overwrite: boolean): Promise<string> {
    const source = refuseRoot(from, kind)
    const destination = refuseRoot(to.endsWith("/") ? `${to}${basenamePath(source)}` : to, `${kind} onto`)
    if (source === destination) throw new YaDiskError("usage", `Source and destination are the same: ${source}`)
    // Overwriting a folder replaces the whole folder — never do it implicitly.
    if (overwrite) await this.refuseFolderTarget(destination, kind)
    try {
      await this.run((b) => b.transfer(kind, source, destination, overwrite))
      return destination
    } catch (err) {
      if (!isYaDiskError(err, "conflict") && !isYaDiskError(err, "already_exists") && !isYaDiskError(err, "not_found")) throw err
      // WebDAV reports a missing source as 409 too; REST 404s may name either side.
      if (!(await this.exists(source))) {
        throw new YaDiskError("not_found", `Source not found: ${source}`, {
          status: err.status,
          hint: `Check the path: yadisk ls ${parentPath(source)}`,
        })
      }
      if (err.code !== "already_exists") throw await this.explainMissingParent(destination, err)
      await this.refuseFolderTarget(destination, kind)
      throw new YaDiskError("already_exists", `Destination already exists: ${destination}`, {
        status: err.status,
        hint: "Pass --overwrite to replace that file",
      })
    }
  }

  // --- Publish ---

  publish(path: string): Promise<string | undefined> {
    const normalized = refuseRoot(path, "publish")
    return this.run((b) => b.publish(normalized))
  }

  unpublish(path: string): Promise<void> {
    const normalized = normalizePath(path)
    return this.run((b) => b.unpublish(normalized))
  }

  // --- Upload ---

  async upload(remotePath: string, localFile: string, options?: UploadOptions): Promise<UploadResult> {
    const path = normalizePath(remotePath)
    const size = await localFileSize(localFile)
    const md5Promise = md5File(localFile)
    md5Promise.catch(() => {}) // awaited later on every path that needs it; avoid unhandled rejection on early throws
    const verify = options?.verify ?? true

    const rest = this.activeRest()
    if (rest) await this.checkUploadLimits(rest, size)

    if (options?.skipIfSame) {
      const md5 = await md5Promise
      if (confirmedSame(await this.statIfExists(path), size, md5)) {
        return { path, size, md5, method: this.backend, skipped: true, verified: true }
      }
    }

    let method: BackendKind = this.backend
    try {
      await this.run((b) => {
        method = b.kind
        // REST's upload link + PUT is retried as a unit (overwrite=true keeps it idempotent); WebDAV PUT retries itself.
        return b.kind === "rest" ? withRetry(() => b.upload(path, localFile), this.retry) : b.upload(path, localFile)
      })
    } catch (err) {
      if (isYaDiskError(err, "conflict") || isYaDiskError(err, "already_exists")) {
        throw await this.explainUploadConflict(path, err)
      }
      if (!isYaDiskError(err, "timeout")) throw err
      // The body is fully sent before Yandex holds the response, so a timed-out upload often already landed.
      const md5 = await md5Promise
      if (verify && confirmedSame(await this.statIfExists(path), size, md5)) {
        return { path, size, md5, method, skipped: false, verified: true }
      }
      err.hint = "The upload may still land server-side — re-run with --skip-if-same, or raise --timeout"
      throw err
    }

    const md5 = await md5Promise
    const verified = verify && (await this.verifyUpload(path, size, md5))
    return { path, size, md5, method, skipped: false, verified }
  }

  /** Yandex downloads the URL server-side (REST only). Destination ending in "/" = into that folder. */
  async uploadFromUrl(url: string, remotePath: string): Promise<Resource> {
    const rest = this.requireRest("Upload from URL")
    const name = urlFileName(url)
    if (remotePath.endsWith("/") && !name) {
      throw new YaDiskError("usage", `Cannot derive a file name from ${url}`, { hint: "Pass a full destination path" })
    }
    const path = normalizePath(remotePath.endsWith("/") ? `${remotePath}${name}` : remotePath)
    try {
      await rest.uploadFromUrl(url, path)
    } catch (err) {
      if (isYaDiskError(err, "already_exists")) {
        err.hint = `Remove it first (yadisk rm ${path}) or pick another destination`
        throw err
      }
      if (isYaDiskError(err, "conflict")) throw await this.explainUploadConflict(path, err)
      throw err
    }
    return this.stat(path)
  }

  // --- Download ---

  /** Files download as-is; folders download as a zip (REST only). `localDest` may be a folder or end in "/". */
  async download(remotePath: string, localDest?: string): Promise<DownloadResult> {
    const path = normalizePath(remotePath)
    const resource = await this.stat(path)
    const archive = resource.type === "dir"
    if (archive && !this.activeRest()) {
      throw new YaDiskError("is_a_directory", `Is a directory: ${path}`, {
        hint: "Folders download as zip only via the REST API — run: yadisk auth --oauth",
      })
    }
    const target = await resolveLocalTarget(localDest, archive ? `${resource.name || "disk"}.zip` : resource.name)
    const response = await this.run((b) => b.download(path))
    return { path, local_path: target, size: await writeLocal(target, response), archive }
  }

  // --- Trash (REST only) ---

  /**
   * Most recently deleted first. The API can't sort by deletion time, so the whole trash is read (1000 per request)
   * and sorted locally. `origin` keeps items deleted from that path or anywhere under it.
   */
  async trashList(options?: { origin?: string; limit?: number }): Promise<TrashItem[]> {
    const rest = this.requireRest("Trash")
    const origin = options?.origin && normalizePath(options.origin)
    const first = await rest.trashList(PAGE_SIZE, 0)
    const items = [...first.items]
    for (let offset = PAGE_SIZE; offset < first.total; offset += PAGE_SIZE * TRASH_CONCURRENCY) {
      const batch = []
      for (let o = offset; o < Math.min(first.total, offset + PAGE_SIZE * TRASH_CONCURRENCY); o += PAGE_SIZE) batch.push(o)
      for (const page of await Promise.all(batch.map((o) => rest.trashList(PAGE_SIZE, o)))) items.push(...page.items)
    }
    return items
      .filter((i) => !origin || origin === "/" || i.origin_path === origin || i.origin_path.startsWith(`${origin}/`))
      .sort((a, b) => Date.parse(b.deleted) - Date.parse(a.deleted))
      .slice(0, options?.limit ?? Infinity)
  }

  /** Restores a trash item (its `path` from trashList). Returns the disk path it was restored to. */
  trashRestore(trashPath: string, options?: { name?: string; overwrite?: boolean }): Promise<string> {
    return this.requireRest("Trash").trashRestore(trashPath, options ?? {})
  }

  // --- Helpers ---

  private activeRest(): RestBackend | undefined {
    return this.restRejected ? undefined : this.rest
  }

  private async run<T>(fn: (backend: Backend) => Promise<T>): Promise<T> {
    const rest = this.activeRest()
    if (rest) {
      try {
        return await fn(rest)
      } catch (err) {
        if (!this.dav || !isYaDiskError(err, "auth")) throw err
        this.rejectRest(err)
      }
    }
    return fn(this.dav!)
  }

  // Sticky for the client's lifetime: re-probing REST on every call would double the latency of each request.
  private rejectRest(err: YaDiskError): void {
    this.restRejected = true
    this.onWarning?.(`REST API rejected the OAuth token (${err.message}) — falling back to WebDAV`)
  }

  private requireRest(feature: string): RestBackend {
    const rest = this.activeRest()
    if (rest) return rest
    throw new YaDiskError("auth", `${feature} requires an OAuth token (REST API)`, {
      hint: "Run: yadisk auth --oauth, or set YADISK_TOKEN",
    })
  }

  // Advisory only: a write-only token can't read disk info, and that must not block (or de-REST) the upload itself.
  private async checkUploadLimits(rest: RestBackend, size: number): Promise<void> {
    let info: DiskInfo
    try {
      info = await rest.info()
    } catch (err) {
      if (isYaDiskError(err, "auth")) return
      throw err
    }
    const { max_file_size: max, available_bytes: available } = info
    if (max !== undefined && size > max) {
      throw new YaDiskError("quota", `File too large: ${size} bytes exceeds the account limit of ${max} bytes`)
    }
    if (size > available) {
      throw new YaDiskError("quota", `Not enough space: ${size} bytes needed, ${available} available`, {
        hint: "Free space or empty the trash — check: yadisk info",
      })
    }
  }

  private async statIfExists(path: string): Promise<Resource | undefined> {
    try {
      return await this.stat(path)
    } catch (err) {
      if (isYaDiskError(err, "not_found")) return undefined
      throw err
    }
  }

  /** true = size + md5 confirmed; false = size matches but the server exposed no md5 to compare. */
  private async verifyUpload(path: string, size: number, md5: string): Promise<boolean> {
    let remote: Resource | undefined
    for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
      remote = await this.statIfExists(path)
      if (confirmedSame(remote, size, md5)) return true
      if (remote?.type === "file" && remote.size === size && !remote.md5) return false
      if (attempt < VERIFY_ATTEMPTS) await Bun.sleep(VERIFY_DELAY_MS)
    }
    const got = remote ? `size ${remote.size}, md5 ${remote.md5}` : "missing"
    throw new YaDiskError("verify_failed", `Upload verification failed for ${path}: expected size ${size}, md5 ${md5}; remote ${got}`, {
      hint: "Re-run the upload",
    })
  }

  private async refuseFolderTarget(path: string, kind: "copy" | "move"): Promise<void> {
    if ((await this.statIfExists(path))?.type !== "dir") return
    throw new YaDiskError("is_a_directory", `Destination is an existing folder: ${path}`, {
      hint: `To ${kind} into it, add a trailing slash: ${path}/`,
    })
  }

  private async explainUploadConflict(path: string, original: YaDiskError): Promise<YaDiskError> {
    if ((await this.statIfExists(path))?.type === "dir") {
      return new YaDiskError("is_a_directory", `Destination is an existing folder: ${path}`, {
        status: original.status,
        hint: `To upload into it, add a trailing slash: ${path}/`,
      })
    }
    return this.explainMissingParent(path, original)
  }

  private async explainMissingParent(path: string, original: YaDiskError): Promise<YaDiskError> {
    const parent = parentPath(path)
    if (await this.exists(parent)) return original
    return new YaDiskError("conflict", `Parent folder does not exist: ${parent}`, {
      status: original.status,
      hint: `Create it first: yadisk mkdir ${parent}`,
    })
  }
}

// Last URL path segment as a file name; malformed escapes and encoded slashes stay literal.
function urlFileName(url: string): string {
  const raw = new URL(url).pathname.split("/").pop() ?? ""
  let name = raw
  try {
    name = decodeURIComponent(raw)
  } catch {}
  return name.includes("/") ? raw : name
}

function confirmedSame(remote: Resource | undefined, size: number, md5: string): boolean {
  return remote?.type === "file" && remote.size === size && remote.md5 === md5
}
