import type { Credentials, DiskInfo, Resource, WebDAVError } from "./types"
import { encodeBasicAuth } from "./auth"
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

export class YaDiskClient {
  private authHeader: string

  constructor(credentials: Credentials) {
    this.authHeader = encodeBasicAuth(credentials)
  }

  private async request(
    method: string,
    path: string,
    options?: {
      body?: BodyInit | null
      headers?: Record<string, string>
      expectBody?: boolean
    }
  ): Promise<Response> {
    const url = `${BASE_URL}${encodeDavPath(path)}`

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      ...options?.headers,
    }

    const response = await fetch(url, {
      method,
      headers,
      body: options?.body,
    })

    if (!response.ok) {
      const err: WebDAVError = {
        status: response.status,
        statusText: response.statusText,
        message: `WebDAV error: ${response.status} ${response.statusText}`,
      }

      try {
        const text = await response.text()
        if (text) err.message = `WebDAV error: ${response.status} — ${text.slice(0, 200)}`
      } catch {}

      throw new Error(err.message)
    }

    return response
  }

  // --- Disk Info ---

  async info(): Promise<DiskInfo> {
    const response = await this.request("PROPFIND", "/", {
      body: QUOTA_PROPFIND,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        Depth: "0",
      },
    })
    const xml = await response.text()
    return parseQuota(xml)
  }

  // --- Resources ---

  async stat(path: string): Promise<Resource> {
    const response = await this.request("PROPFIND", path, {
      body: RESOURCE_PROPFIND,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        Depth: "0",
      },
    })
    const xml = await response.text()
    const resources = parseMultiStatus(xml, path)
    return resources[0]
  }

  async list(path: string): Promise<Resource[]> {
    const response = await this.request("PROPFIND", path, {
      body: RESOURCE_PROPFIND,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        Depth: "1",
      },
    })
    const xml = await response.text()
    const resources = parseMultiStatus(xml, path)
    // Depth:1 includes the folder itself as the first entry — skip it
    return resources.slice(1)
  }

  async mkdir(path: string): Promise<void> {
    await this.request("MKCOL", path)
  }

  async delete(path: string): Promise<void> {
    await this.request("DELETE", path)
  }

  async copy(from: string, to: string, overwrite?: boolean): Promise<void> {
    await this.request("COPY", from, {
      headers: {
        Destination: `${BASE_URL}${encodeDavPath(to)}`,
        Overwrite: overwrite ? "T" : "F",
      },
    })
  }

  async move(from: string, to: string, overwrite?: boolean): Promise<void> {
    await this.request("MOVE", from, {
      headers: {
        Destination: `${BASE_URL}${encodeDavPath(to)}`,
        Overwrite: overwrite ? "T" : "F",
      },
    })
  }

  // --- Publish ---

  async publish(path: string): Promise<string | undefined> {
    const response = await this.request("PROPPATCH", path, {
      body: PUBLISH_PROPPATCH,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    })
    const xml = await response.text()
    return parsePublicUrl(xml)
  }

  async unpublish(path: string): Promise<void> {
    await this.request("PROPPATCH", path, {
      body: UNPUBLISH_PROPPATCH,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    })
  }

  async getPublicUrl(path: string): Promise<string | undefined> {
    const response = await this.request("PROPFIND", path, {
      body: PUBLIC_URL_PROPFIND,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        Depth: "0",
      },
    })
    const xml = await response.text()
    return parsePublicUrl(xml)
  }

  // --- Upload ---

  async upload(remotePath: string, localFile: string): Promise<void> {
    const body = Bun.file(localFile)
    await this.request("PUT", remotePath, { body })
  }

  // --- Download ---

  async download(remotePath: string, localDest: string): Promise<void> {
    const response = await this.request("GET", remotePath)
    await Bun.write(localDest, response)
  }
}

function encodeDavPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}
