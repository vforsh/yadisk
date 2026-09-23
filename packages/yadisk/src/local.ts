import { mkdir, rename, rm } from "fs/promises"
import { dirname, join, resolve } from "path"
import { YaDiskError } from "./errors"
import { transportError } from "./http"

export async function localFileSize(path: string): Promise<number> {
  let stats
  try {
    stats = await Bun.file(path).stat()
  } catch {
    throw new YaDiskError("local_not_found", `Local file not found: ${path}`)
  }
  if (!stats.isFile()) {
    throw new YaDiskError("usage", `Not a regular file: ${path}`, { hint: "Upload files one at a time" })
  }
  try {
    await Bun.file(path).slice(0, 1).arrayBuffer()
  } catch (err) {
    throw new YaDiskError("usage", `Cannot read local file: ${path}`, { cause: err })
  }
  return stats.size
}

export async function md5File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("md5")
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk)
  return hasher.digest("hex")
}

/** No dest → ./<name>; a dest ending in "/" or naming an existing folder → <dest>/<name>; else dest itself. */
export async function resolveLocalTarget(dest: string | undefined, defaultName: string): Promise<string> {
  if (!dest) return resolve(defaultName)
  if (dest.endsWith("/") || (await isLocalDir(dest))) return join(resolve(dest), defaultName)
  return resolve(dest)
}

// Streams chunk by chunk (Bun.write(path, response) buffers the whole body — fatal for multi-GB zips) into a
// sibling .part file, renamed on success so an interrupted download never leaves a truncated target behind.
export async function writeLocal(target: string, response: Response): Promise<number> {
  const partial = `${target}.part`
  let size = 0
  try {
    await mkdir(dirname(target), { recursive: true })
    const writer = Bun.file(partial).writer()
    try {
      for await (const chunk of response.body ?? []) {
        writer.write(chunk)
        size += chunk.byteLength
      }
    } finally {
      await writer.end()
    }
    await rename(partial, target)
    return size
  } catch (err) {
    await rm(partial, { force: true })
    if (err instanceof Error && "syscall" in err && !String((err as { code?: string }).code).startsWith("ECONN")) {
      throw new YaDiskError("usage", `Cannot write ${target}: ${err.message}`, { cause: err })
    }
    throw transportError(err)
  }
}

async function isLocalDir(path: string): Promise<boolean> {
  try {
    return (await Bun.file(path).stat()).isDirectory()
  } catch {
    return false
  }
}
