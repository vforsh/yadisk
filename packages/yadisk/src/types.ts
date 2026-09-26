import type { YaDiskError } from "./errors"

/** Either an OAuth token, an app password, or both. With a token, the REST API is used; WebDAV is the fallback. */
export interface Credentials {
  username?: string
  password?: string
  /** OAuth token (`cloud_api:disk.read` + `cloud_api:disk.write`). REST uploads are ~8× faster than WebDAV. */
  token?: string
}

export interface GetCredentialsOptions {
  username?: string
  password?: string
  token?: string
}

export interface ClientOptions {
  /** Per-request timeout in ms. Omit or 0 to disable (Bun's implicit 5-min idle timeout is also disabled). */
  timeoutMs?: number
  /** Retries for network errors, 429 and 5xx on idempotent requests. Default 2. */
  retries?: number
  onRetry?: (err: YaDiskError, attempt: number, delayMs: number) => void
  /** Non-fatal notices, e.g. falling back from REST to WebDAV. */
  onWarning?: (message: string) => void
}

export interface UploadOptions {
  /** Compare remote size + md5 with the local file after upload. Default true. */
  verify?: boolean
  /** Skip the upload when the remote file already has the same size + md5. */
  skipIfSame?: boolean
  /** Create missing parent folders. */
  parents?: boolean
}

export interface MkdirOptions {
  /** Create missing parents, and treat an existing folder as success (like `mkdir -p`). */
  parents?: boolean
}

export interface TransferOptions {
  /** Replace an existing destination file (never a folder). */
  overwrite?: boolean
  /** Run the checks a real copy/move would fail on, change nothing. */
  dryRun?: boolean
}

export interface DeleteOptions {
  /** Allow deleting a non-empty folder. Without it, one is refused with `is_a_directory`. */
  recursive?: boolean
  /** A missing path is not an error (`existed: false`). */
  force?: boolean
  /** Run the checks a real delete would fail on, change nothing. */
  dryRun?: boolean
}

export interface DeleteResult {
  path: string
  existed: boolean
  deleted: boolean
  type?: "dir" | "file"
  /** true when it went to the trash (REST); undefined when the transport can't tell or nothing was deleted. */
  trashed?: boolean
}

export interface DownloadOptions {
  /** Skip files whose local copy already has the same size + md5 (folders always download). */
  skipIfSame?: boolean
}

export interface OpenOptions {
  /** Refuse files larger than this many bytes before downloading anything. */
  maxBytes?: number
}

export interface TrashRestoreOptions {
  /** Restore under a different name. */
  name?: string
  /** Replace an existing file at the target (never a folder). */
  overwrite?: boolean
  /** Run the checks a real restore would fail on, change nothing. */
  dryRun?: boolean
}

export interface UploadResult {
  path: string
  size: number
  md5: string
  method: BackendKind
  skipped: boolean
  verified: boolean
}

export type BackendKind = "rest" | "webdav"

export type SortField = "name" | "size" | "created" | "modified"
/** A sort field; prefix "-" for descending. */
export type ListSort = SortField | `-${SortField}`

export interface ListOptions {
  /** Max items to return. Default: all. */
  limit?: number
  offset?: number
  /** Applied before limit/offset — server-side on REST, over the whole folder on WebDAV. Default: server order. */
  sort?: ListSort
}

export interface FindOptions {
  /** Glob matched against the resource name, e.g. "*.zip". */
  name?: string
  type?: "file" | "dir"
  /** 1 = direct children only. Default: unlimited. */
  maxDepth?: number
  limit?: number
  /** REST only: Yandex media type, e.g. "image", "video", "compressed", "document". Filtered server-side on whole-disk scans. */
  mediaType?: string
  /** Called as resources are scanned (running total). */
  onProgress?: (scanned: number) => void
}

export interface DownloadResult {
  path: string
  local_path: string
  size: number
  /** true when a folder was downloaded as a zip archive. */
  archive: boolean
  /** true when `skipIfSame` found an identical local file and nothing was downloaded. */
  skipped: boolean
}

/** Deliberately lean: hash/URL fields make the trash listing several times slower server-side. */
export interface TrashItem {
  name: string
  /** Trash path to pass to `trashRestore`, e.g. "trash:/build.zip_1f2e…". */
  path: string
  type: "dir" | "file"
  size?: number
  origin_path: string
  deleted: string
}

export interface DiskInfo {
  used_bytes: number
  available_bytes: number
  total_bytes: number
  /** REST only. */
  trash_bytes?: number
  /** REST only: largest single file the account may upload. */
  max_file_size?: number
  /** REST only: the account's Yandex login. */
  login?: string
}

export interface Resource {
  name: string
  path: string
  type: "dir" | "file"
  size?: number
  created: string
  modified: string
  md5?: string
  /** REST only. */
  sha256?: string
  content_type?: string
  /** REST only, e.g. "image", "video", "document". */
  media_type?: string
  /** Present when the resource is published (REST only). */
  public_url?: string
  /** WebDAV only (equals the md5 for files). */
  etag?: string
}
