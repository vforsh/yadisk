import { expect, test } from "bun:test"
import { find } from "./find"
import type { Resource } from "./types"

const r = (path: string, type: "file" | "dir" = "file"): Resource => ({
  name: path.split("/").pop()!,
  path,
  type,
  created: "",
  modified: "",
})

const TREE: Record<string, Resource[]> = {
  "/": [r("/a", "dir"), r("/top.zip")],
  "/a": [r("/a/b", "dir"), r("/a/x.zip"), r("/a/y.txt")],
  "/a/b": [r("/a/b/deep.zip")],
}
const list = async (path: string) => TREE[path] ?? []

test("walks folders and matches the glob", async () => {
  const found = await find("/", { name: "*.zip" }, { list })
  expect(found.map((f) => f.path)).toEqual(["/a/b/deep.zip", "/a/x.zip", "/top.zip"])
})

test("respects maxDepth, type and limit", async () => {
  expect((await find("/", { maxDepth: 1 }, { list })).map((f) => f.path)).toEqual(["/a", "/top.zip"])
  expect((await find("/", { type: "dir" }, { list })).map((f) => f.path)).toEqual(["/a", "/a/b"])
  expect(await find("/", { name: "*.zip", limit: 1 }, { list })).toHaveLength(1)
})

test("uses the flat file index for whole-disk file searches", async () => {
  const pages: number[] = []
  const files = async (limit: number, offset: number) => {
    pages.push(offset)
    return offset === 0 ? [r("/q/a.zip"), r("/q/b.txt")] : []
  }
  let scanned = 0
  const found = await find("/", { type: "file", name: "*.zip", onProgress: (n) => (scanned = n) }, { list, files })
  expect(found.map((f) => f.path)).toEqual(["/q/a.zip"])
  expect(pages).toEqual([0])
  expect(scanned).toBe(2)
})

test("whole-disk search without a type walks folders (the file index has no folders)", async () => {
  const files = async () => {
    throw new Error("index must not be used")
  }
  const found = await find("/", {}, { list, files })
  expect(found.map((f) => f.path)).toContain("/a/b")
})
