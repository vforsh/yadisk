import { expect, test } from "bun:test"
import { parseMultiStatus } from "./webdav"

const XML = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/docs/a%20b.png</d:href>
    <d:propstat>
      <d:status>HTTP/1.1 200 OK</d:status>
      <d:prop>
        <d:displayname>a b.png</d:displayname>
        <d:resourcetype/>
        <d:getcontentlength>137714</d:getcontentlength>
        <d:getcontenttype>image/png</d:getcontenttype>
        <d:getetag>"4becf54956d10a7c200b278be4c6457f"</d:getetag>
        <d:creationdate>2020-11-04T09:30:33Z</d:creationdate>
        <d:getlastmodified>Wed, 04 Nov 2020 09:30:33 GMT</d:getlastmodified>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`

test("parses a file resource with ISO dates", () => {
  expect(parseMultiStatus(XML, "/docs/a b.png")).toEqual([
    {
      name: "a b.png",
      path: "/docs/a b.png",
      type: "file",
      size: 137714,
      content_type: "image/png",
      etag: "4becf54956d10a7c200b278be4c6457f",
      md5: "4becf54956d10a7c200b278be4c6457f",
      created: "2020-11-04T09:30:33.000Z",
      modified: "2020-11-04T09:30:33.000Z",
    },
  ])
})

test("keeps numeric-looking names and etags as strings", () => {
  const xml = XML.replace("a b.png", "2026").replace("a%20b.png", "2026").replace("4becf54956d10a7c200b278be4c6457f", "12345678901234567890123456789012")
  const [resource] = parseMultiStatus(xml, "/docs/2026")
  expect(resource.name).toBe("2026")
  expect(resource.etag).toBe("12345678901234567890123456789012")
  expect(resource.size).toBe(137714)
})

test("malformed responses throw a YaDiskError", () => {
  expect(() => parseMultiStatus("<html>nope</html>", "/")).toThrow(expect.objectContaining({ code: "server" }))
})
