import type { BackendKind, DiskInfo, ListSort, Resource } from "./types"

export interface ListPage {
  self: Resource
  items: Resource[]
  total: number
}

/**
 * One transport (WebDAV or REST). Paths are already normalized. Backends map their own failure shapes onto
 * shared codes: `already_exists` when the target exists, `conflict` for anything else the server refused
 * (typically a missing parent); YaDiskClient turns those into precise explanations.
 */
export interface Backend {
  readonly kind: BackendKind
  info(): Promise<DiskInfo>
  stat(path: string): Promise<Resource>
  list(path: string, limit: number, offset: number, sort?: ListSort): Promise<ListPage>
  mkdir(path: string): Promise<void>
  /** Returns true when the resource went to the trash, undefined when the transport can't tell. */
  delete(path: string): Promise<boolean | undefined>
  transfer(kind: "copy" | "move", from: string, to: string, overwrite: boolean): Promise<void>
  publish(path: string): Promise<string | undefined>
  unpublish(path: string): Promise<void>
  /** File contents; REST also serves folders as a zip archive. */
  download(path: string): Promise<Response>
  upload(path: string, localFile: string): Promise<void>
}
