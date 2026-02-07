// --- Yandex.Disk API Types ---

export interface DiskInfo {
  total_space: number
  used_space: number
  trash_size: number
  max_file_size: number
  is_paid: boolean
  system_folders: Record<string, string>
  user: {
    login: string
    display_name: string
    uid: string
  }
}

export interface Resource {
  name: string
  path: string
  type: "dir" | "file"
  size?: number
  created: string
  modified: string
  md5?: string
  sha256?: string
  mime_type?: string
  public_key?: string
  public_url?: string
  _embedded?: ResourceList
}

export interface ResourceList {
  sort: string
  path: string
  items: Resource[]
  limit: number
  offset: number
  total: number
}

export interface Link {
  href: string
  method: string
  templated: boolean
}

export interface Operation {
  status: "success" | "failure" | "in-progress"
}

export interface ApiError {
  message: string
  description: string
  error: string
}

export interface ListOptions {
  limit?: number
  offset?: number
  sort?: string
}

export interface GetTokenOptions {
  token?: string
}
