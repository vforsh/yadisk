import type { DiskInfo, Resource, Link, ListOptions, ApiError } from "./types"

const BASE_URL = "https://cloud-api.yandex.net"

export class YaDiskClient {
  constructor(private token: string) {}

  private async request<T>(
    method: string,
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    body?: BodyInit | null
  ): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`)

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `OAuth ${this.token}`,
    }

    if (body && typeof body === "string") {
      headers["Content-Type"] = "application/json"
    }

    const response = await fetch(url.toString(), { method, headers, body })

    if (!response.ok) {
      let errorMsg = `API error: ${response.status} ${response.statusText}`
      try {
        const err = (await response.json()) as ApiError
        if (err.description) errorMsg = `API error: ${err.description}`
      } catch {}
      throw new Error(errorMsg)
    }

    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return undefined as T
    }

    return (await response.json()) as T
  }

  // --- Disk Info ---

  async info(): Promise<DiskInfo> {
    return this.request<DiskInfo>("GET", "/v1/disk")
  }

  // --- Resources ---

  async stat(path: string): Promise<Resource> {
    return this.request<Resource>("GET", "/v1/disk/resources", { path })
  }

  async list(path: string, opts?: ListOptions): Promise<Resource> {
    return this.request<Resource>("GET", "/v1/disk/resources", {
      path,
      limit: opts?.limit,
      offset: opts?.offset,
      sort: opts?.sort,
    })
  }

  async mkdir(path: string): Promise<Link> {
    return this.request<Link>("PUT", "/v1/disk/resources", { path })
  }

  async delete(path: string, permanently?: boolean): Promise<Link | undefined> {
    return this.request<Link | undefined>("DELETE", "/v1/disk/resources", {
      path,
      permanently,
    })
  }

  async copy(from: string, to: string, overwrite?: boolean): Promise<Link> {
    return this.request<Link>("POST", "/v1/disk/resources/copy", {
      from,
      path: to,
      overwrite,
    })
  }

  async move(from: string, to: string, overwrite?: boolean): Promise<Link> {
    return this.request<Link>("POST", "/v1/disk/resources/move", {
      from,
      path: to,
      overwrite,
    })
  }

  // --- Upload ---

  async getUploadUrl(path: string, overwrite?: boolean): Promise<string> {
    const link = await this.request<Link>("GET", "/v1/disk/resources/upload", {
      path,
      overwrite,
    })
    return link.href
  }

  async upload(uploadUrl: string, file: string): Promise<void> {
    const body = Bun.file(file)
    const response = await fetch(uploadUrl, { method: "PUT", body })
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status} ${response.statusText}`)
    }
  }

  // --- Download ---

  async getDownloadUrl(path: string): Promise<string> {
    const link = await this.request<Link>("GET", "/v1/disk/resources/download", {
      path,
    })
    return link.href
  }

  async download(downloadUrl: string, dest: string): Promise<void> {
    const response = await fetch(downloadUrl)
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`)
    }
    await Bun.write(dest, response)
  }

  // --- Publish ---

  async publish(path: string): Promise<Link> {
    return this.request<Link>("PUT", "/v1/disk/resources/publish", { path })
  }

  async unpublish(path: string): Promise<Link> {
    return this.request<Link>("PUT", "/v1/disk/resources/unpublish", { path })
  }

  async getPublicUrl(path: string): Promise<string | undefined> {
    const resource = await this.stat(path)
    return resource.public_url
  }
}
