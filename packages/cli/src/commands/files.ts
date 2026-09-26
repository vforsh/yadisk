import type { Command } from "commander"
import chalk from "chalk"
import { normalizePath } from "@vforsh/yadisk"
import type { BackendKind, DeleteResult } from "@vforsh/yadisk"
import { failures, mapSettled } from "../batch"
import { RESOURCE_FIELDS, dryRunFlag, dryRunOption, examples, fieldsOption, getClient, parseCount, sortOption } from "../context"
import { formatDiskInfo, formatResource, formatResourceList } from "../format"
import { emit, emitWithFailures, pick } from "../output"

const STAT_CONCURRENCY = 4

const TRANSFERS = [
  {
    command: "cp",
    kind: "copy",
    key: "copied",
    done: "Copied",
    description: "Copy a file or folder",
    examples: ["yadisk cp /releases/build.zip /archive/   # → /archive/build.zip"],
  },
  {
    command: "mv",
    kind: "move",
    key: "moved",
    done: "Moved",
    description: "Move or rename a file or folder",
    examples: ["yadisk mv /tmp/build.zip /releases/ --dry-run --json", "yadisk mv /releases/old.zip /releases/new.zip"],
  },
] as const

export function registerFileCommands(program: Command): void {
  program
    .command("info")
    .description("Show disk usage and capacity")
    .action(async () => {
      const disk = await getClient().info()
      emit(disk, formatDiskInfo(disk))
    })

  program
    .command("ls")
    .description("List folder contents")
    .argument("[path]", "Disk path (e.g. /uploads)", "/")
    .addOption(sortOption())
    .option("--limit <n>", "Max items (after sorting)", parseCount("--limit"))
    .option("--offset <n>", "Skip the first n items (after sorting)", parseCount("--offset", 0))
    .addOption(fieldsOption(RESOURCE_FIELDS))
    .addHelpText(
      "after",
      examples([
        "yadisk ls /releases --sort -modified --limit 5 --fields path,size,modified --json   # 5 newest",
        "yadisk ls / --limit 50 --offset 50 --json",
      ])
    )
    .action(async (path: string, options) => {
      const items = await getClient().list(path, { limit: options.limit, offset: options.offset, sort: options.sort })
      emit(pick(items, options.fields), `${formatResourceList(items)}\n${chalk.dim(`\n${items.length} items`)}`)
    })

  program
    .command("stat")
    .description("Show file/folder metadata (exit 4 if missing). Several paths → one array entry each")
    .argument("<paths...>", "Disk paths")
    .addOption(fieldsOption(RESOURCE_FIELDS))
    .addHelpText(
      "after",
      examples([
        "yadisk stat /releases/build.zip --json   # md5, sha256, public_url with a token",
        "yadisk stat /a.zip /b.zip --fields path,size --json   # missing ones become {path, error}; exit 4",
      ])
    )
    .action(async (paths: string[], options) => {
      const client = getClient()
      if (paths.length === 1) {
        const resource = await client.stat(paths[0])
        emit(pick(resource, options.fields), formatResource(resource))
        return
      }
      const results = await mapSettled(paths, STAT_CONCURRENCY, (path) => client.stat(path))
      const entries = results.map((r, i) => (r.ok ? pick(r.value, options.fields) : { path: paths[i], error: r.error.toJSON() }))
      const human = results.map((r, i) => (r.ok ? formatResource(r.value) : `${paths[i]}: ${chalk.red(r.error.message)}`))
      emitWithFailures(entries, human.join("\n\n"), failures(results))
    })

  program
    .command("mkdir")
    .description("Create a folder")
    .argument("<path>", "Disk path")
    .option("-p, --parents", "Create missing parents; an existing folder is success (created: false)")
    .addHelpText("after", examples(["yadisk mkdir -p /releases/2026/09 --json   # idempotent"]))
    .action(async (path: string, options) => {
      const created = await getClient().mkdir(path, { parents: options.parents })
      const normalized = normalizePath(path)
      emit({ path: normalized, created }, created ? `Created: ${normalized}` : `Exists: ${normalized}`)
    })

  for (const spec of TRANSFERS) {
    program
      .command(spec.command)
      .description(spec.description)
      .argument("<from>", "Source disk path")
      .argument("<to>", "Destination disk path; trailing / means 'into this folder'")
      .option("--overwrite", "Overwrite an existing destination file (never a folder)")
      .addOption(dryRunOption())
      .addHelpText("after", examples(spec.examples))
      .action(async (from: string, to: string, options) => {
        const client = getClient()
        const transferOptions = { overwrite: options.overwrite, dryRun: options.dryRun }
        const dst = await client[spec.kind](from, to, transferOptions)
        const src = normalizePath(from)
        const label = options.dryRun ? `Would ${spec.kind}` : spec.done
        emit({ from: src, to: dst, [spec.key]: !options.dryRun, ...dryRunFlag(options) }, `${label}: ${src} → ${dst}`)
      })
  }

  program
    .command("rm")
    .description("Delete a file or folder (to the trash with a token; restore with: yadisk trash restore)")
    .argument("<path>", "Disk path")
    .option("-r, --recursive", "Allow deleting a non-empty folder (refused otherwise, exit 5)")
    .option("-f, --force", "A missing path is success (existed: false)")
    .addOption(dryRunOption())
    .addHelpText(
      "after",
      examples(["yadisk rm /releases/old.zip --json", "yadisk rm /tmp/build -r --dry-run --json   # check first", "yadisk rm /maybe.txt -f --json"])
    )
    .action(async (path: string, options) => {
      const client = getClient()
      const result = await client.delete(path, { recursive: options.recursive, force: options.force, dryRun: options.dryRun })
      emit(
        { ...result, type: result.type ?? null, trashed: result.trashed ?? null, ...dryRunFlag(options) },
        describeDelete(result, options.dryRun, client.backend)
      )
    })

  program
    .command("publish")
    .description("Publish a resource and print its public URL")
    .argument("<path>", "Disk path")
    .action(async (path: string) => {
      const url = await getClient().publish(path)
      emit({ path: normalizePath(path), public_url: url ?? null }, url ?? `Published: ${normalizePath(path)} (no URL returned)`)
    })

  program
    .command("unpublish")
    .description("Remove public access from a resource")
    .argument("<path>", "Disk path")
    .action(async (path: string) => {
      await getClient().unpublish(path)
      emit({ path: normalizePath(path), published: false }, `Unpublished: ${normalizePath(path)}`)
    })
}

function describeDelete(result: DeleteResult, dryRun: boolean | undefined, backend: BackendKind): string {
  if (!result.existed) return `Not found (nothing to delete): ${result.path}`
  if (dryRun) return `Would delete${backend === "rest" ? " (to trash)" : ""}: ${result.path}`
  return `Deleted: ${result.path}${result.trashed ? " (moved to trash)" : ""}`
}
