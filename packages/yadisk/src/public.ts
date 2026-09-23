import { withRetryDefaults } from "./http"
import { resolveLocalTarget, writeLocal } from "./local"
import { RESOURCE_FIELDS, toResource, type RestResource } from "./rest"
import { RestApi, type Link } from "./rest-api"
import type { ClientOptions, DownloadResult, ListOptions, Resource } from "./types"

const PAGE_SIZE = 1000
const LIST_FIELDS = [RESOURCE_FIELDS, ...RESOURCE_FIELDS.split(",").map((f) => `_embedded.items.${f}`), "_embedded.total"].join(",")

/**
 * Read-only access to anyone's public link (https://disk.yandex.ru/d/… or /i/…) — no credentials needed.
 * `path` addresses a file inside a published folder, relative to it ("/" = the published resource itself).
 */
export class PublicClient {
  private api: RestApi

  constructor(options?: ClientOptions) {
    this.api = new RestApi(undefined, options?.timeoutMs, withRetryDefaults(options))
  }

  async stat(publicUrl: string, path = "/"): Promise<Resource> {
    return toResource(
      await this.api.call<RestResource>("GET", "/public/resources", { public_key: publicUrl, path, fields: RESOURCE_FIELDS })
    )
  }

  async list(publicUrl: string, path = "/", options?: ListOptions): Promise<Resource[]> {
    const limit = options?.limit ?? Infinity
    let offset = options?.offset ?? 0
    const items: Resource[] = []
    while (items.length < limit) {
      const dir = await this.api.call<RestResource>("GET", "/public/resources", {
        public_key: publicUrl,
        path,
        limit: Math.min(PAGE_SIZE, limit - items.length),
        offset,
        fields: LIST_FIELDS,
      })
      if (dir.type === "file") return [toResource(dir)]
      const page = dir._embedded?.items ?? []
      items.push(...page.map(toResource))
      offset += page.length
      if (!page.length || offset >= (dir._embedded?.total ?? 0)) break
    }
    return items
  }

  /** Published folders download as a zip archive. */
  async download(publicUrl: string, localDest?: string, path = "/"): Promise<DownloadResult> {
    const resource = await this.stat(publicUrl, path)
    const archive = resource.type === "dir"
    const target = await resolveLocalTarget(localDest, archive ? `${resource.name}.zip` : resource.name)
    const link = await this.api.call<Link>("GET", "/public/resources/download", { public_key: publicUrl, path })
    const size = await writeLocal(target, await this.api.follow(link))
    return { path: resource.path, local_path: target, size, archive }
  }
}
