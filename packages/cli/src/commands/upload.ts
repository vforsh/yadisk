import type { Command } from "commander"
import chalk from "chalk"
import { writeFileSync } from "fs"
import { rm } from "fs/promises"
import { tmpdir } from "os"
import { basename, join } from "path"
import { YaDiskError, estimateUploadSeconds, parentPath } from "@vforsh/yadisk"
import type { UploadResult, YaDiskClient } from "@vforsh/yadisk"
import { failures, mapSettled } from "../batch"
import { examples, getClient, parseCount } from "../context"
import { formatSize } from "../format"
import { DETACH_HELP, detachable } from "../jobs"
import { emit, emitWithFailures, warn } from "../output"
import { formatDuration, withTask } from "../progress"
import { planUpload, type UploadItem, type UploadPlan } from "../upload-plan"

const DEFAULT_CONCURRENCY = 4

type UploadEntry = UploadResult & { local_path: string; public_url?: string | null }

interface UploadFlags {
  recursive?: boolean
  parents?: boolean
  publish?: boolean
  skipIfSame?: boolean
  verify: boolean
  concurrency: number
}

export function registerUploadCommand(program: Command): void {
  program
    .command("upload")
    .description("Upload files or folders to Yandex.Disk (verifies size + md5 afterwards)")
    .argument(
      "<paths...>",
      "Local files/folders, then the destination (last argument). A single file's dest is optional " +
        "(default: <upload_dir>/<name>) and a trailing / means 'into this folder'. - reads stdin"
    )
    .option("-r, --recursive", "Upload folders with everything inside (remote folders are created)")
    .option("-p, --parents", "Create missing remote parent folders")
    .option("--publish", "Publish after upload and print the public URL")
    .option("--skip-if-same", "Skip when the remote file already has the same size + md5 (safe retries)")
    .option("--no-verify", "Skip post-upload size + md5 verification")
    .option("--concurrency <n>", "Parallel uploads when there are several files", parseCount("--concurrency"), DEFAULT_CONCURRENCY)
    .option("--detach", DETACH_HELP)
    .addHelpText(
      "after",
      examples([
        "yadisk upload ./build.zip /releases/ --publish --json",
        "yadisk upload ./build.zip /releases/build.zip --skip-if-same --json   # safe to re-run",
        "yadisk upload dist/*.zip /releases/2026/ -p --skip-if-same --json    # several files → array",
        "yadisk upload -r ./site /www/site --skip-if-same --json              # ./site/** → /www/site/**",
        "echo hello | yadisk upload - /notes/hello.txt --json",
        "yadisk upload ./big.iso /isos/ --detach --json                       # → {job_id}; then: yadisk job <id>",
      ])
    )
    .action(
      detachable(async (args: string[], flags: UploadFlags) => {
        if (args[0] === "-") return uploadStdin(args, flags)
        const plan = await planUpload(args, flags.recursive ?? false)
        const client = getClient()
        warnIfWebdav(client)
        await (plan.batch ? uploadBatch(client, plan, flags) : uploadOne(client, plan.files[0], flags))
      })
    )
}

async function uploadOne(client: YaDiskClient, file: UploadItem, flags: UploadFlags, label = file.local): Promise<void> {
  const startedAt = Date.now()
  const entry = await withTask(
    `Uploading ${basename(label)} (${formatSize(file.size)}) via ${client.backend}`,
    () => uploadFile(client, file, flags),
    { estimateSeconds: estimateUploadSeconds(file.size, client.backend) }
  )
  const durationMs = Date.now() - startedAt
  const lines = [
    entry.skipped
      ? `Skipped (unchanged): ${entry.path}`
      : `Uploaded: ${label} → ${entry.path} (${formatSize(entry.size)}, ${formatDuration(durationMs / 1000)}` +
        `${entry.verified ? ", verified" : ""})`,
  ]
  if (flags.publish) lines.push(`Public URL: ${entry.public_url ?? "(none returned)"}`)
  emit({ ...entry, local_path: label, duration_ms: durationMs }, lines.join("\n"))
}

async function uploadBatch(client: YaDiskClient, plan: UploadPlan, flags: UploadFlags): Promise<void> {
  if (!flags.parents) await requireParents(client, plan.roots)
  if (plan.dirs.length) {
    await withTask(`Creating ${plan.dirs.length} folders`, () => createFolders(client, plan.dirs, flags.concurrency))
  }
  const total = plan.files.reduce((sum, f) => sum + f.size, 0)
  const workers = Math.max(1, Math.min(flags.concurrency, plan.files.length))
  let done = 0
  const results = await withTask(
    `Uploading ${plan.files.length} files (${formatSize(total)}) via ${client.backend}, ${workers} at a time`,
    () => mapSettled(plan.files, flags.concurrency, (file) => uploadFile(client, file, flags).finally(() => done++)),
    { estimateSeconds: Math.ceil(estimateUploadSeconds(total, client.backend) / workers), status: () => `${done}/${plan.files.length} done` }
  )

  const entries = results.map((r, i) =>
    r.ok ? r.value : { local_path: plan.files[i].local, path: plan.files[i].remote, error: r.error.toJSON() }
  )
  const human = results.map((r, i) => {
    const { local, remote } = plan.files[i]
    if (!r.ok) return chalk.red(`Failed: ${local} → ${remote}: ${r.error.message}`)
    const publicUrl = r.value.public_url ? ` ${r.value.public_url}` : ""
    return `${r.value.skipped ? "Skipped (unchanged)" : "Uploaded"}: ${local} → ${remote}${publicUrl}`
  })
  const failed = failures(results)
  human.push(chalk.dim(`\n${plan.files.length - failed.length}/${plan.files.length} ok`))
  emitWithFailures(entries, human.join("\n"), failed)
}

async function uploadFile(client: YaDiskClient, file: UploadItem, flags: UploadFlags): Promise<UploadEntry> {
  const result = await client.upload(file.remote, file.local, {
    verify: flags.verify,
    skipIfSame: flags.skipIfSame,
    parents: flags.parents,
  })
  const entry: UploadEntry = { local_path: file.local, ...result }
  if (!flags.publish) return entry
  return { ...entry, public_url: (await client.publish(result.path)) ?? null }
}

// -r creates the named folders and everything below them, but, like any upload, not missing ancestors without -p.
async function requireParents(client: YaDiskClient, roots: string[]): Promise<void> {
  for (const parent of new Set(roots.map((root) => parentPath(root)))) {
    if (await client.exists(parent)) continue
    throw new YaDiskError("conflict", `Parent folder does not exist: ${parent}`, { hint: "Pass -p to create it" })
  }
}

// Level by level so every folder's parent exists before it is created; siblings go in parallel.
async function createFolders(client: YaDiskClient, dirs: string[], concurrency: number): Promise<void> {
  const levels = Map.groupBy(dirs, (dir) => dir.split("/").length)
  for (const level of [...levels.keys()].sort((a, b) => a - b)) {
    const [error] = failures(await mapSettled(levels.get(level)!, concurrency, (dir) => client.mkdir(dir, { parents: true })))
    if (error) throw error
  }
}

// Spooled to a temp file: the upload needs the size and md5 up front, and a retry needs the bytes again.
async function uploadStdin(args: string[], flags: UploadFlags): Promise<void> {
  const dest = args[1]
  if (args.length !== 2 || dest.endsWith("/")) {
    throw new YaDiskError("usage", "Uploading stdin needs exactly one destination file path", {
      hint: "e.g. echo hi | yadisk upload - /notes/hi.txt",
    })
  }
  if (process.stdin.isTTY) throw new YaDiskError("usage", "stdin is a terminal", { hint: "Pipe the data in: … | yadisk upload - <dest>" })

  const temp = join(tmpdir(), `yadisk-stdin-${crypto.randomUUID()}`)
  try {
    writeFileSync(temp, "", { mode: 0o600 }) // private before any data lands; the writer keeps the mode
    const writer = Bun.file(temp).writer()
    let size = 0
    for await (const chunk of Bun.stdin.stream()) {
      writer.write(chunk)
      size += chunk.byteLength
    }
    await writer.end()
    const client = getClient()
    warnIfWebdav(client)
    await uploadOne(client, { local: temp, remote: dest, size }, flags, "-")
  } finally {
    await rm(temp, { force: true })
  }
}

function warnIfWebdav(client: YaDiskClient): void {
  if (client.backend !== "webdav") return
  warn("Warning: No OAuth token — uploading via WebDAV, which Yandex throttles to ~60s/MB.\nFor fast uploads run: yadisk auth --oauth")
}
