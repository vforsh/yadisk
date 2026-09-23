import { Option, type Command } from "commander"
import chalk from "chalk"
import { normalizePath } from "@vforsh/yadisk"
import type { Resource } from "@vforsh/yadisk"
import { examples, getClient, parseCount } from "../context"
import { formatDiskInfo, formatResource, formatResourceList } from "../format"
import { emit } from "../output"

const SORT_FIELDS = ["name", "size", "modified", "-name", "-size", "-modified"]

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
    .addOption(new Option("--sort <field>", "Sort field; prefix - for descending").choices(SORT_FIELDS).default("name"))
    .option("--limit <n>", "Max items (paged server-side with a token)", parseCount("--limit"))
    .option("--offset <n>", "Skip the first n items (server order)", parseCount("--offset", 0))
    .addHelpText("after", examples(["yadisk ls /releases --sort -modified --json", "yadisk ls / --limit 50 --offset 50 --json"]))
    .action(async (path: string, options) => {
      const listed = await getClient().list(path, { limit: options.limit, offset: options.offset })
      const items = sortResources(listed, options.sort)
      emit(items, `${formatResourceList(items)}\n${chalk.dim(`\n${items.length} items`)}`)
    })

  program
    .command("stat")
    .description("Show file/folder metadata (exit 4 if missing)")
    .argument("<path>", "Disk path")
    .addHelpText("after", examples(["yadisk stat /releases/build.zip --json   # md5, sha256, public_url with a token"]))
    .action(async (path: string) => {
      const resource = await getClient().stat(path)
      emit(resource, formatResource(resource))
    })

  program
    .command("mkdir")
    .description("Create a folder")
    .argument("<path>", "Disk path")
    .action(async (path: string) => {
      await getClient().mkdir(path)
      emit({ path: normalizePath(path), created: true }, `Created: ${normalizePath(path)}`)
    })

  program
    .command("cp")
    .description("Copy a file or folder")
    .argument("<from>", "Source disk path")
    .argument("<to>", "Destination disk path; trailing / means 'into this folder'")
    .option("--overwrite", "Overwrite an existing destination file (never a folder)")
    .addHelpText("after", examples(["yadisk cp /releases/build.zip /archive/   # → /archive/build.zip"]))
    .action(async (from: string, to: string, options) => {
      const dst = await getClient().copy(from, to, options.overwrite)
      const src = normalizePath(from)
      emit({ from: src, to: dst, copied: true }, `Copied: ${src} → ${dst}`)
    })

  program
    .command("mv")
    .description("Move or rename a file or folder")
    .argument("<from>", "Source disk path")
    .argument("<to>", "Destination disk path; trailing / means 'into this folder'")
    .option("--overwrite", "Overwrite an existing destination file (never a folder)")
    .addHelpText("after", examples(["yadisk mv /tmp/build.zip /releases/", "yadisk mv /releases/old.zip /releases/new.zip"]))
    .action(async (from: string, to: string, options) => {
      const dst = await getClient().move(from, to, options.overwrite)
      const src = normalizePath(from)
      emit({ from: src, to: dst, moved: true }, `Moved: ${src} → ${dst}`)
    })

  program
    .command("rm")
    .description("Delete a file or folder (to the trash with a token; restore with: yadisk trash restore)")
    .argument("<path>", "Disk path")
    .action(async (path: string) => {
      const { trashed } = await getClient().delete(path)
      const where = trashed ? " (moved to trash)" : ""
      emit({ path: normalizePath(path), deleted: true, trashed: trashed ?? null }, `Deleted: ${normalizePath(path)}${where}`)
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

const COMPARATORS: Record<string, (a: Resource, b: Resource) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  size: (a, b) => (a.size ?? 0) - (b.size ?? 0),
  modified: (a, b) => Date.parse(a.modified) - Date.parse(b.modified),
}

function sortResources(items: Resource[], field: string): Resource[] {
  const descending = field.startsWith("-")
  const compare = COMPARATORS[field.replace(/^-/, "")]
  return [...items].sort((a, b) => (descending ? -compare(a, b) : compare(a, b)))
}
