// --- Yandex.Disk WebDAV Types ---

export interface Credentials {
  username: string
  password: string
  /** OAuth token (`cloud_api:disk.write`). Enables REST uploads, ~8× faster than throttled WebDAV. */
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
}

export type UploadMethod = "rest" | "webdav"

export interface DiskInfo {
  used_bytes: number
  available_bytes: number
  total_bytes: number
}

export interface Resource {
  name: string
  path: string
  type: "dir" | "file"
  size?: number
  created: string
  modified: string
  etag?: string
  content_type?: string
}

export interface WebDAVError {
  status: number
  statusText: string
  message: string
}
