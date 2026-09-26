import type { ListSort, Resource, SortField } from "./types"

const COMPARATORS: Record<SortField, (a: Resource, b: Resource) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  size: (a, b) => (a.size ?? 0) - (b.size ?? 0),
  created: (a, b) => time(a.created) - time(b.created),
  modified: (a, b) => time(a.modified) - time(b.modified),
}

// WebDAV may omit dates; NaN would make the comparator inconsistent.
function time(date: string): number {
  return Date.parse(date) || 0
}

/** Local equivalent of the REST `sort` parameter, for WebDAV (PROPFIND can't sort). */
export function sortResources(items: Resource[], sort: ListSort): Resource[] {
  const descending = sort.startsWith("-")
  const compare = COMPARATORS[sort.replace(/^-/, "") as SortField]
  return [...items].sort((a, b) => (descending ? compare(b, a) : compare(a, b)))
}
