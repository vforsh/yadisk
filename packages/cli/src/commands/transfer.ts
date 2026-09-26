import type { Command } from "commander"
import { YaDiskError, normalizePath } from "@vforsh/yadisk"
import type { DownloadResult } from "@vforsh/yadisk"
import { examples, getClient, parseCount } from "../context"
import { formatSize } from "../format"
import { DETACH_HELP, detachable } from "../jobs"
import { emit, isJson } from "../output"
import { withTask } from "../progress"

// Guards an agent's context window: `cat` of a stray multi-MB file would flood it.
const DEFAULT_CAT_MAX_BYTES = 1024 * 1024

export function registerTransferCommands(program: Command): void {
  program
    .command("upload-url")
    .description("Have Yandex fetch a URL straight into the disk (REST; nothing passes through this machine)")
    .argument("<url>", "Source URL (http/https)")
    .argument("<dest>", "Destination disk path; trailing / means 'into this folder, keep the URL's file name'")
    .option("-p, --parents", "Create missing parent folders")
    .option("--detach", DETACH_HELP)
    .addHelpText("after", examples(["yadisk upload-url https://example.com/big.iso /isos/ -p --json"]))
    .action(
      detachable(async (url: string, dest: string, options) => {
        if (!/^https?:\/\//.test(url)) throw new YaDiskError("usage", `Not an http(s) URL: ${url}`)
        const resource = await withTask(`Yandex is fetching ${url}`, () =>
          getClient().uploadFromUrl(url, dest, { parents: options.parents })
        )
        const size = resource.size !== undefined ? ` (${formatSize(resource.size)})` : ""
        emit({ url, ...resource }, `Uploaded: ${url} → ${resource.path}${size}`)
      })
    )

  program
    .command("download")
    .description("Download a file, or a folder as .zip (folders need a token)")
    .argument("<path>", "Disk path")
    .argument("[dest]", "Local file, or folder / path ending in / (default: ./<name>, ./<name>.zip for folders)")
    .option("--skip-if-same", "Skip when the local file already has the same size + md5 (files only)")
    .option("--detach", DETACH_HELP)
    .addHelpText(
      "after",
      examples([
        "yadisk download /releases/build.zip ./out/ --skip-if-same --json",
        "yadisk download /releases --json   # → ./releases.zip",
      ])
    )
    .action(
      detachable(async (path: string, dest: string | undefined, options) => {
        const remote = normalizePath(path)
        const result = await withTask(`Downloading ${remote}`, () =>
          getClient().download(remote, dest, { skipIfSame: options.skipIfSame })
        )
        emit(result, downloadSummary(result))
      })
    )

  program
    .command("cat")
    .description("Print a file's contents. With --json: {path, size, encoding: utf8|base64, content}")
    .argument("<path>", "Disk path")
    .option("--max-bytes <n>", "Refuse bigger files before downloading (0 = no limit)", parseCount("--max-bytes", 0), DEFAULT_CAT_MAX_BYTES)
    .addHelpText("after", examples(["yadisk cat /notes/todo.md", "yadisk cat /config.json --json | jq -r .content"]))
    .action(async (path: string, options) => {
      const { resource, body } = await getClient().open(path, { maxBytes: options.maxBytes })
      if (isJson()) {
        const bytes = new Uint8Array(await new Response(body).arrayBuffer())
        emit({ path: resource.path, size: bytes.byteLength, ...encodeContent(bytes) }, "")
        return
      }
      const out = Bun.stdout.writer()
      for await (const chunk of body) {
        out.write(chunk)
        await out.flush()
      }
    })
}

export function downloadSummary(result: DownloadResult): string {
  if (result.skipped) return `Skipped (unchanged): ${result.path} → ${result.local_path}`
  return `Downloaded${result.archive ? " as zip" : ""}: ${result.path} → ${result.local_path} (${formatSize(result.size)})`
}

function encodeContent(bytes: Uint8Array): { encoding: "utf8" | "base64"; content: string } {
  try {
    return { encoding: "utf8", content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }
  } catch {
    return { encoding: "base64", content: Buffer.from(bytes).toString("base64") }
  }
}
