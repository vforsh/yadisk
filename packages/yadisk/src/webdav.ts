import { XMLParser } from "fast-xml-parser"
import type { DiskInfo, Resource } from "./types"

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
})

// --- PROPFIND request bodies ---

export const QUOTA_PROPFIND = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:quota-available-bytes/>
    <D:quota-used-bytes/>
  </D:prop>
</D:propfind>`

export const RESOURCE_PROPFIND = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
    <D:getcontentlength/>
    <D:getcontenttype/>
    <D:getetag/>
    <D:creationdate/>
    <D:getlastmodified/>
  </D:prop>
</D:propfind>`

// --- PROPPATCH request bodies ---

export const PUBLISH_PROPPATCH = `<?xml version="1.0" encoding="utf-8"?>
<propertyupdate xmlns="DAV:">
  <set>
    <prop>
      <public_url xmlns="urn:yandex:disk:meta">true</public_url>
    </prop>
  </set>
</propertyupdate>`

export const UNPUBLISH_PROPPATCH = `<?xml version="1.0" encoding="utf-8"?>
<propertyupdate xmlns="DAV:">
  <remove>
    <prop>
      <public_url xmlns="urn:yandex:disk:meta"/>
    </prop>
  </remove>
</propertyupdate>`

export const PUBLIC_URL_PROPFIND = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <public_url xmlns="urn:yandex:disk:meta"/>
  </D:prop>
</D:propfind>`

// --- Parsers ---

export function parseQuota(xml: string): DiskInfo {
  const parsed = parser.parse(xml)
  const response = getResponse(parsed)
  const props = getPropstat(response).prop

  const used = Number(props["quota-used-bytes"] ?? 0)
  const available = Number(props["quota-available-bytes"] ?? 0)

  return {
    used_bytes: used,
    available_bytes: available,
    total_bytes: used + available,
  }
}

export function parseMultiStatus(xml: string, basePath: string): Resource[] {
  const parsed = parser.parse(xml)
  const multistatus = parsed.multistatus
  if (!multistatus) throw new Error("Invalid WebDAV response: no multistatus")

  const responses = Array.isArray(multistatus.response)
    ? multistatus.response
    : [multistatus.response]

  return responses.map((r: any) => parseResource(r, basePath))
}

export function parseResource(response: any, basePath?: string): Resource {
  const href = response.href ?? ""
  const propstat = getPropstat(response)
  const props = propstat.prop

  const isDir = props.resourcetype?.collection !== undefined
  const rawPath = decodeURIComponent(href).replace(/\/$/, "") || "/"
  const name = props.displayname || rawPath.split("/").pop() || ""

  const resource: Resource = {
    name,
    path: rawPath,
    type: isDir ? "dir" : "file",
    created: props.creationdate ?? "",
    modified: props.getlastmodified ?? "",
  }

  if (!isDir && props.getcontentlength != null) {
    resource.size = Number(props.getcontentlength)
  }

  if (props.getcontenttype) {
    resource.content_type = props.getcontenttype
  }

  if (props.getetag) {
    resource.etag = String(props.getetag).replace(/"/g, "")
  }

  return resource
}

export function parsePublicUrl(xml: string): string | undefined {
  const parsed = parser.parse(xml)
  const response = getResponse(parsed)
  const propstat = getPropstat(response)
  const url = propstat?.prop?.public_url
  if (typeof url === "string" && url.startsWith("http")) return url
  return undefined
}

// --- Helpers ---

function getResponse(parsed: any): any {
  const ms = parsed.multistatus
  if (!ms) throw new Error("Invalid WebDAV response: no multistatus")
  return Array.isArray(ms.response) ? ms.response[0] : ms.response
}

function getPropstat(response: any): any {
  if (!response) throw new Error("Invalid WebDAV response: no response element")
  const propstat = response.propstat
  if (Array.isArray(propstat)) {
    return propstat.find((p: any) => {
      const status = String(p.status ?? "")
      return status.includes("200")
    }) ?? propstat[0]
  }
  return propstat
}
