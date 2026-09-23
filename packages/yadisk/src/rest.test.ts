import { expect, test } from "bun:test"
import { RestBackend, toResource } from "./rest"

test("maps REST resources onto the shared shape", () => {
  expect(
    toResource({
      name: "2026",
      path: "disk:/releases/2026",
      type: "dir",
      created: "2020-11-04T09:30:33+00:00",
      modified: "2020-11-04T09:30:33+00:00",
    })
  ).toEqual({
    name: "2026",
    path: "/releases/2026",
    type: "dir",
    created: "2020-11-04T09:30:33.000Z",
    modified: "2020-11-04T09:30:33.000Z",
  })
  expect(
    toResource({ name: "a", path: "disk:/a", type: "file", size: 3, md5: "m", sha256: "s", mime_type: "text/plain", created: "", modified: "" })
  ).toMatchObject({ size: 3, md5: "m", sha256: "s", content_type: "text/plain" })
})

test.each(["", "/", "trash:", "trash:/", "trash://"])("refuses to restore the whole trash for %p", async (path) => {
  const backend = new RestBackend("token", undefined, { retries: 0 })
  await expect(backend.trashRestore(path, {})).rejects.toMatchObject({ code: "usage" })
})
