import type { Command } from "commander"
import { basename } from "path"
import { YaDiskError, estimateUploadSeconds, getConfigValue, localFileSize, normalizePath } from "@vforsh/yadisk"
import { examples, getClient } from "../context"
import { formatSize } from "../format"
import { emit, warn } from "../output"
import { formatDuration, withTask } from "../progress"

export function registerTransferCommands(program: Command): void {
  program
    .command("upload")
    .description("Upload a local file to Yandex.Disk (verifies size + md5 afterwards)")
    .argument("<file>", "Local file path")
    .argument("[dest]", "Destination disk path; trailing / means 'into this folder' (default: <upload_dir>/<filename>)")
    .option("--publish", "Publish after upload and print the public URL")
    .option("--skip-if-same", "Skip when the remote file already has the same size + md5 (safe retries)")
    .option("--no-verify", "Skip post-upload size + md5 verification")
    .addHelpText(
      "after",
      examples([
        "yadisk upload ./build.zip /releases/ --publish --json",
        "yadisk upload ./build.zip /releases/build.zip --skip-if-same --json   # safe to re-run",
      ])
    )
    .action(async (file: string, dest: string | undefined, options) => {
      const size = await localFileSize(file)
      const remote = resolveUploadDest(file, dest)
      const client = getClient()

      if (client.backend === "webdav") {
        warn(
          "Warning: No OAuth token — uploading via WebDAV, which Yandex throttles to ~60s/MB.\n" +
            "For fast uploads run: yadisk auth --oauth"
        )
      }

      const startedAt = Date.now()
      const result = await withTask(
        `Uploading ${basename(file)} (${formatSize(size)}) via ${client.backend}`,
        () => client.upload(remote, file, { verify: options.verify, skipIfSame: options.skipIfSame }),
        { estimateSeconds: estimateUploadSeconds(size, client.backend) }
      )

      const publicUrl = options.publish ? await client.publish(result.path) : undefined
      const durationMs = Date.now() - startedAt

      const lines = [
        result.skipped
          ? `Skipped (unchanged): ${result.path}`
          : `Uploaded: ${file} → ${result.path} (${formatSize(result.size)}, ${formatDuration(durationMs / 1000)}` +
            `${result.verified ? ", verified" : ""})`,
      ]
      if (options.publish) lines.push(`Public URL: ${publicUrl ?? "(none returned)"}`)
      emit(
        { ...result, ...(options.publish && { public_url: publicUrl ?? null }), duration_ms: durationMs },
        lines.join("\n")
      )
    })

  program
    .command("upload-url")
    .description("Have Yandex fetch a URL straight into the disk (REST; nothing passes through this machine)")
    .argument("<url>", "Source URL (http/https)")
    .argument("<dest>", "Destination disk path; trailing / means 'into this folder, keep the URL's file name'")
    .addHelpText("after", examples(["yadisk upload-url https://example.com/big.iso /isos/ --json"]))
    .action(async (url: string, dest: string) => {
      if (!/^https?:\/\//.test(url)) throw new YaDiskError("usage", `Not an http(s) URL: ${url}`)
      const resource = await withTask(`Yandex is fetching ${url}`, () => getClient().uploadFromUrl(url, dest))
      const size = resource.size !== undefined ? ` (${formatSize(resource.size)})` : ""
      emit({ url, ...resource }, `Uploaded: ${url} → ${resource.path}${size}`)
    })

  program
    .command("download")
    .description("Download a file, or a folder as .zip (folders need a token)")
    .argument("<path>", "Disk path")
    .argument("[dest]", "Local file, or folder / path ending in / (default: ./<name>, ./<name>.zip for folders)")
    .addHelpText(
      "after",
      examples(["yadisk download /releases/build.zip ./out/ --json", "yadisk download /releases --json   # → ./releases.zip"])
    )
    .action(async (path: string, dest?: string) => {
      const remote = normalizePath(path)
      const result = await withTask(`Downloading ${remote}`, () => getClient().download(remote, dest))
      const kind = result.archive ? " as zip" : ""
      emit(result, `Downloaded${kind}: ${result.path} → ${result.local_path} (${formatSize(result.size)})`)
    })
}

function resolveUploadDest(file: string, dest?: string): string {
  if (dest) return dest.endsWith("/") ? `${dest}${basename(file)}` : dest
  const uploadDir = getConfigValue("upload_dir")
  if (!uploadDir) {
    throw new YaDiskError("usage", "No destination specified", {
      hint: "Pass <dest>, or set a default: yadisk config set upload_dir /path",
    })
  }
  return `${uploadDir.replace(/\/$/, "")}/${basename(file)}`
}
