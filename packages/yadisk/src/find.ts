import type { FindOptions, Resource } from "./types"

// Bigger pages amortize Yandex's per-request cost: ~25s per 10k files vs ~8s per 1k.
const FILES_PAGE = 10_000
const LIST_CONCURRENCY = 4

export interface FindSources {
  list(path: string): Promise<Resource[]>
  /** Flat listing of every file on the disk (REST only). */
  files?(limit: number, offset: number, mediaType?: string): Promise<Resource[]>
}

export async function find(root: string, options: FindOptions, sources: FindSources): Promise<Resource[]> {
  const glob = options.name ? new Bun.Glob(options.name) : undefined
  const limit = options.limit ?? Infinity
  const matches = (r: Resource) =>
    (!options.type || r.type === options.type) &&
    (!options.mediaType || r.media_type === options.mediaType) &&
    (!glob || glob.match(r.name))
  let scanned = 0
  const progress = (n: number) => options.onProgress?.((scanned += n))

  // Whole-disk file search: one paginated stream beats walking every folder. The index holds files only, so it is
  // used only when folders are excluded anyway (--type file, or --media-type which folders never have).
  const filesOnly = options.type === "file" || (options.mediaType !== undefined && options.type !== "dir")
  if (root === "/" && sources.files && filesOnly && options.maxDepth === undefined) {
    const results: Resource[] = []
    for (let offset = 0; results.length < limit; offset += FILES_PAGE) {
      const page = await sources.files(FILES_PAGE, offset, options.mediaType)
      progress(page.length)
      results.push(...page.filter(matches))
      if (page.length < FILES_PAGE) break
    }
    return sortByPath(results.slice(0, limit))
  }

  const results: Resource[] = []
  let level = [root]
  for (let depth = 1; level.length && results.length < limit; depth++) {
    const next: string[] = []
    for (let i = 0; i < level.length && results.length < limit; i += LIST_CONCURRENCY) {
      const listings = await Promise.all(level.slice(i, i + LIST_CONCURRENCY).map((dir) => sources.list(dir)))
      progress(listings.flat().length)
      for (const child of listings.flat()) {
        if (matches(child)) results.push(child)
        if (child.type === "dir" && (options.maxDepth === undefined || depth < options.maxDepth)) next.push(child.path)
      }
    }
    level = next
  }
  return sortByPath(results.slice(0, limit))
}

function sortByPath(items: Resource[]): Resource[] {
  return items.sort((a, b) => a.path.localeCompare(b.path))
}
