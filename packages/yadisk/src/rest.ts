import type { Backend, ListPage } from "./backend"
import { YaDiskError, isYaDiskError } from "./errors"
import type { RetryOptions } from "./http"
import { normalizePath, parentPath } from "./path"
import { RestApi, pathFromLink, type Link } from "./rest-api"
import type { DiskInfo, Resource, TrashItem } from "./types"

const FILE_FIELDS = ["name", "path", "type", "size", "created", "modified", "md5", "sha256", "mime_type", "media_type", "public_url"]
export const RESOURCE_FIELDS = FILE_FIELDS.join(",")
const LIST_FIELDS = [...FILE_FIELDS, ...FILE_FIELDS.map((f) => `_embedded.items.${f}`), "_embedded.total"].join(",")
const TRASH_ITEM_FIELDS = ["name", "path", "type", "size", "origin_path", "deleted"]
const TRASH_FIELDS = [...TRASH_ITEM_FIELDS.map((f) => `_embedded.items.${f}`), "_embedded.total"].join(",")

export interface RestResource {
  name: string
  path: string
  type: "dir" | "file"
  size?: number
  created: string
  modified: string
  md5?: string
  sha256?: string
  mime_type?: string
  media_type?: string
  public_url?: string
  origin_path?: string
  deleted?: string
  _embedded?: { items: RestResource[]; total: number }
}

// Uploader hosts hold the response ~8s/MB vs ~60s/MB on WebDAV, and scale with parallel uploads.
export class RestBackend implements Backend {
  readonly kind = "rest"
  readonly api: RestApi

  constructor(token: string, timeoutMs: number | undefined, retry: RetryOptions) {
    this.api = new RestApi(token, timeoutMs, retry)
  }

  async info(): Promise<DiskInfo> {
    const disk = await this.api.call<{ total_space: number; used_space: number; trash_size: number; max_file_size: number }>(
      "GET",
      "",
      { fields: "total_space,used_space,trash_size,max_file_size" }
    )
    return {
      used_bytes: disk.used_space,
      available_bytes: disk.total_space - disk.used_space,
      total_bytes: disk.total_space,
      trash_bytes: disk.trash_size,
      max_file_size: disk.max_file_size,
    }
  }

  async stat(path: string): Promise<Resource> {
    return toResource(await this.api.call<RestResource>("GET", "/resources", { path, fields: RESOURCE_FIELDS }))
  }

  async list(path: string, limit: number, offset: number): Promise<ListPage> {
    const dir = await this.api.call<RestResource>("GET", "/resources", { path, limit, offset, fields: LIST_FIELDS })
    return {
      self: toResource(dir),
      items: (dir._embedded?.items ?? []).map(toResource),
      total: dir._embedded?.total ?? 0,
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.api.call("PUT", "/resources", { path })
  }

  async delete(path: string): Promise<boolean> {
    await this.api.settle(await this.api.call<Link>("DELETE", "/resources", { path, permanently: false }), `Delete ${path}`)
    return true
  }

  async transfer(kind: "copy" | "move", from: string, to: string, overwrite: boolean): Promise<void> {
    const link = await this.api.call<Link>("POST", `/resources/${kind}`, { from, path: to, overwrite })
    await this.api.settle(link, `${kind === "copy" ? "Copy" : "Move"} ${from} → ${to}`)
  }

  async publish(path: string): Promise<string | undefined> {
    await this.api.call("PUT", "/resources/publish", { path }, { idempotent: true })
    return (await this.api.call<RestResource>("GET", "/resources", { path, fields: "public_url" })).public_url
  }

  async unpublish(path: string): Promise<void> {
    await this.api.call("PUT", "/resources/unpublish", { path }, { idempotent: true })
  }

  async download(path: string): Promise<Response> {
    return this.api.follow(await this.api.call<Link>("GET", "/resources/download", { path }))
  }

  async upload(path: string, localFile: string): Promise<void> {
    const link = await this.api.call<Link>("GET", "/resources/upload", { path, overwrite: true })
    const response = await this.api.follow(link, { body: Bun.file(localFile) })
    if (response.status === 202) await this.api.settle(link, `Upload ${path}`)
  }

  // --- REST-only ---

  /** Yandex fetches the URL itself; resolves when the file has landed. */
  async uploadFromUrl(url: string, path: string): Promise<void> {
    await this.api.settle(await this.api.call<Link>("POST", "/resources/upload", { url, path }), `Upload from ${url}`)
  }

  /** Flat listing of every file on the disk, in Yandex's (unspecified) order. */
  async files(limit: number, offset: number, mediaType?: string): Promise<Resource[]> {
    // Lean fields: hashes and URLs roughly double the server time on this endpoint.
    const fields = ["name", "path", "type", "size", "created", "modified", "media_type"].map((f) => `items.${f}`).join(",")
    const page = await this.api.call<{ items: RestResource[] }>("GET", "/resources/files", {
      limit,
      offset,
      fields,
      media_type: mediaType,
    })
    return page.items.map(toResource)
  }

  async trashList(limit: number, offset: number): Promise<{ items: TrashItem[]; total: number }> {
    const trash = await this.api.call<RestResource>("GET", "/trash/resources", {
      path: "trash:/",
      limit,
      offset,
      fields: TRASH_FIELDS,
    })
    return { items: (trash._embedded?.items ?? []).map(toTrashItem), total: trash._embedded?.total ?? 0 }
  }

  /** Returns the restored disk path. */
  async trashRestore(trashPath: string, options: { name?: string; overwrite?: boolean }): Promise<string> {
    const name = trashPath.replace(/^trash:/, "").replace(/^\/+/, "")
    // "trash:/" itself means the whole trash — restoring it would dump every deleted item back onto the disk.
    if (!name.replace(/\/+$/, "")) {
      throw new YaDiskError("usage", `Refusing to restore the entire trash: ${JSON.stringify(trashPath)}`, {
        hint: "Pass one item's trash path from: yadisk trash ls",
      })
    }
    const path = `trash:/${name}`
    let origin: string | undefined
    try {
      origin = (await this.api.call<RestResource>("GET", "/trash/resources", { path, fields: "origin_path" })).origin_path
    } catch (err) {
      if (isYaDiskError(err, "not_found")) {
        throw new YaDiskError("not_found", `Not in trash: ${path}`, { status: 404, hint: "List the trash: yadisk trash ls" })
      }
      throw err
    }
    const originPath = origin ? stripScheme(origin) : undefined
    const target = originPath && options.name ? normalizePath(`${parentPath(originPath)}/${options.name}`) : originPath
    // Overwriting a folder replaces the whole folder — same rule as cp/mv.
    if (options.overwrite && target && (await this.statOrUndefined(target))?.type === "dir") {
      throw new YaDiskError("is_a_directory", `Restore target is an existing folder: ${target}`, {
        hint: "Restore under another name with --name, or move the folder away first",
      })
    }
    const link = await this.api.call<Link>("PUT", "/trash/resources/restore", { path, name: options.name, overwrite: options.overwrite })
    await this.api.settle(link, `Restore ${path}`)
    const linked = pathFromLink(link)
    if (linked) return stripScheme(linked)
    if (!target) throw new YaDiskError("server", `Restore of ${path} returned no destination`)
    return target
  }

  private async statOrUndefined(path: string): Promise<Resource | undefined> {
    try {
      return await this.stat(path)
    } catch (err) {
      if (isYaDiskError(err, "not_found")) return undefined
      throw err
    }
  }
}

export function toResource(r: RestResource): Resource {
  const resource: Resource = {
    name: r.name,
    path: stripScheme(r.path),
    type: r.type,
    created: toIso(r.created),
    modified: toIso(r.modified),
  }
  if (r.type === "file" && r.size != null) resource.size = r.size
  if (r.md5) resource.md5 = r.md5
  if (r.sha256) resource.sha256 = r.sha256
  if (r.mime_type) resource.content_type = r.mime_type
  if (r.media_type) resource.media_type = r.media_type
  if (r.public_url) resource.public_url = r.public_url
  return resource
}

function toTrashItem(r: RestResource): TrashItem {
  const item: TrashItem = { name: r.name, path: r.path, type: r.type, origin_path: stripScheme(r.origin_path ?? ""), deleted: toIso(r.deleted ?? "") }
  if (r.type === "file" && r.size != null) item.size = r.size
  return item
}

function stripScheme(path: string): string {
  return path.replace(/^(disk|trash|app):/, "") || "/"
}

function toIso(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

/** Probes read (disk info) and write (upload link, nothing uploaded) access. Throws on an invalid token. */
export async function checkToken(token: string, timeoutMs?: number): Promise<{ read: boolean; write: boolean }> {
  const api = new RestApi(token, timeoutMs, { retries: 1 })
  const probe = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      return true
    } catch (err) {
      if (isYaDiskError(err, "auth") && err.status === 403) return false
      throw err
    }
  }
  const read = await probe(() => api.call("GET", "", { fields: "total_space" }))
  const write = await probe(() => api.call("GET", "/resources/upload", { path: `/.yadisk-token-check-${Date.now()}`, overwrite: true }))
  return { read, write }
}
