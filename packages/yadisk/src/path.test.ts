import { describe, expect, test } from "bun:test"
import { normalizePath, parentPath, refuseRoot } from "./path"

describe("normalizePath", () => {
  test.each([
    ["uploads/x.zip", "/uploads/x.zip"],
    ["/uploads/x.zip", "/uploads/x.zip"],
    ["/uploads/", "/uploads"],
    ["disk:/uploads//x", "/uploads/x"],
    ["/a/b ", "/a/b "],
    ["disk:/", "/"],
    ["/", "/"],
  ])("%p → %p", (input, expected) => expect(normalizePath(input)).toBe(expected))
})

test("parentPath", () => {
  expect(parentPath("/a/b/c")).toBe("/a/b")
  expect(parentPath("a")).toBe("/")
  expect(parentPath("/")).toBe("/")
})

test.each(["", "  ", "disk:"])("rejects empty path %p", (input) => {
  expect(() => normalizePath(input)).toThrow(expect.objectContaining({ code: "usage" }))
})

test("refuseRoot", () => {
  expect(() => refuseRoot("/", "delete")).toThrow("Refusing to delete the disk root")
  expect(() => refuseRoot("disk://", "delete")).toThrow("disk root")
  expect(refuseRoot("a/", "delete")).toBe("/a")
})

test.each([".", "/.", "/tmp/..", "..", "a/./b", "disk:/."])("rejects dot segments %p", (input) => {
  expect(() => normalizePath(input)).toThrow(expect.objectContaining({ code: "usage" }))
})
