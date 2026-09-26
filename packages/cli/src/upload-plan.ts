import type { Dirent } from "fs"
import { readdir, stat } from "fs/promises"
import { basename, join, resolve } from "path"
import { YaDiskError, getConfigValue, localFileSize, normalizePath } from "@vforsh/yadisk"

export interface UploadItem {
  local: string
  remote: string
  size: number
}

export interface UploadPlan {
  files: UploadItem[]
  /** Remote folders to create before uploading (from -r), parents first. */
  dirs: string[]
  /** The folders named by the arguments (-r); their parents must already exist unless -p. */
  roots: string[]
  /** Several sources or a folder: the result is an array with one entry per file. */
  batch: boolean
}

/**
 * `upload <file> [dest]` keeps its single-file meaning: dest is the exact remote path, or a folder when it ends in "/".
 * With several sources, the last argument is the destination folder, like cp. A lone folder (-r) with a destination
 * not ending in "/" becomes that destination; otherwise folders go inside it under their own name.
 */
export async function planUpload(args: string[], recursive: boolean): Promise<UploadPlan> {
  const [sources, dest] = args.length === 1 ? [args, undefined] : [args.slice(0, -1), args.at(-1)]
  const kinds = await Promise.all(sources.map(localKind))
  kinds.forEach((kind, i) => {
    if (kind === "other") throw new YaDiskError("usage", `Not a regular file or folder: ${sources[i]}`)
    if (kind === "dir" && !recursive) {
      throw new YaDiskError("usage", `Is a directory: ${sources[i]}`, { hint: "Pass -r to upload a folder with everything inside" })
    }
  })

  if (sources.length === 1 && kinds[0] === "file") {
    const [local] = sources
    return { files: [{ local, remote: singleFileDest(local, dest), size: await localFileSize(local) }], dirs: [], roots: [], batch: false }
  }

  const into = dest ?? defaultDir()
  const files: UploadItem[] = []
  const dirs: string[] = []
  const roots: string[] = []
  for (const [i, source] of sources.entries()) {
    const name = basename(resolve(source))
    if (kinds[i] === "file") {
      files.push({ local: source, remote: normalizePath(`${into}/${name}`), size: await localFileSize(source) })
      continue
    }
    const root = normalizePath(sources.length === 1 && dest && !dest.endsWith("/") ? dest : `${into}/${name}`)
    roots.push(root)
    dirs.push(root)
    await collectTree(source, root, files, dirs)
  }

  refuseDuplicates(files)
  dirs.sort((a, b) => depth(a) - depth(b))
  files.sort((a, b) => a.remote.localeCompare(b.remote))
  return { files, dirs, roots, batch: true }
}

// Walked by hand: readdir's `recursive` descends into symlinked folders (cycles, or a link to ~ uploading everything).
// Symlinked files are uploaded; symlinked folders are skipped.
async function collectTree(localDir: string, remoteDir: string, files: UploadItem[], dirs: string[]): Promise<void> {
  for (const entry of await readdir(localDir, { withFileTypes: true })) {
    const local = join(localDir, entry.name)
    const remote = normalizePath(`${remoteDir}/${entry.name}`)
    if (entry.isDirectory()) {
      dirs.push(remote)
      await collectTree(local, remote, files, dirs)
    } else if (await isUploadableFile(entry, local)) {
      files.push({ local, remote, size: await localFileSize(local) })
    }
  }
}

async function isUploadableFile(entry: Dirent, path: string): Promise<boolean> {
  if (entry.isFile()) return true
  if (!entry.isSymbolicLink()) return false
  return (await localKind(path).catch(() => "other")) === "file"
}

function singleFileDest(file: string, dest?: string): string {
  if (dest) return dest.endsWith("/") ? `${dest}${basename(file)}` : dest
  return `${defaultDir()}/${basename(file)}`
}

function defaultDir(): string {
  const uploadDir = getConfigValue("upload_dir")
  if (!uploadDir) {
    throw new YaDiskError("usage", "No destination specified", {
      hint: "Pass the destination as the last argument, or set a default: yadisk config set upload_dir /path",
    })
  }
  return uploadDir.replace(/\/$/, "")
}

async function localKind(path: string): Promise<"file" | "dir" | "other"> {
  try {
    const stats = await stat(path)
    return stats.isFile() ? "file" : stats.isDirectory() ? "dir" : "other"
  } catch {
    throw new YaDiskError("local_not_found", `Local file not found: ${path}`)
  }
}

function refuseDuplicates(files: UploadItem[]): void {
  const seen = new Map<string, string>()
  for (const { local, remote } of files) {
    const other = seen.get(remote)
    if (other) throw new YaDiskError("usage", `${other} and ${local} would both upload to ${remote}`, { hint: "Upload them separately" })
    seen.set(remote, local)
  }
}

function depth(path: string): number {
  return path.split("/").length
}
