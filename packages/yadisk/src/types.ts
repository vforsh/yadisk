// --- Yandex.Disk WebDAV Types ---

export interface Credentials {
  username: string
  password: string
}

export interface GetCredentialsOptions {
  username?: string
  password?: string
}

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
