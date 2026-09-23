import { Option, type Command } from "commander"
import { PublicClient, normalizePath } from "@vforsh/yadisk"
import { examples, getClient, getClientOptions, parseCount } from "../context"
import { formatPathList, formatResource, formatResourceList, formatSize, formatTrashList } from "../format"
import { emit } from "../output"
import { withTask } from "../progress"

// Yandex's fixed media_type vocabulary (the API rejects anything else).
const MEDIA_TYPES = [
  "audio", "backup", "book", "compressed", "data", "development", "diskimage", "document", "encoded",
  "executable", "flash", "font", "image", "settings", "spreadsheet", "text", "unknown", "video", "web",
]

export function registerRestCommands(program: Command): void {
  program
    .command("find")
    .description("Recursively search a folder. Prefer a subfolder: / means scanning the whole disk")
    .argument("[path]", "Folder to search", "/")
    .option("--name <glob>", 'Glob on the resource name, e.g. "*.zip"')
    .addOption(
      new Option("--type <type>", "Only files or only folders; `/ --type file` uses the REST file index").choices(["file", "dir"])
    )
    .option("--max-depth <n>", "1 = direct children only", parseCount("--max-depth"))
    .option("--limit <n>", "Stop after n matches", parseCount("--limit"))
    .addOption(new Option("--media-type <type>", "REST only; filtered server-side when searching /").choices(MEDIA_TYPES))
    .addHelpText(
      "after",
      examples([
        'yadisk find /releases --name "*.zip" --json',
        "yadisk find /releases --type dir --max-depth 1 --json",
        'yadisk find / --type file --name "*.iso" --limit 5 --json   # whole-disk file index (~25s per 10k files)',
        "yadisk find / --media-type video --limit 20 --json",
      ])
    )
    .action(async (path: string, options) => {
      let scanned = 0
      const items = await withTask(
        `Searching ${normalizePath(path)}`,
        () =>
          getClient().find(path, {
            name: options.name,
            type: options.type,
            maxDepth: options.maxDepth,
            limit: options.limit,
            mediaType: options.mediaType,
            onProgress: (n) => (scanned = n),
          }),
        { status: () => `${scanned} scanned` }
      )
      emit(items, `${formatPathList(items)}\n\n${items.length} matches`)
    })

  const trash = program.command("trash").description("Inspect and restore deleted items (REST)")

  trash
    .command("ls")
    .description("List the trash, most recently deleted first")
    .option("--origin <path>", "Only items deleted from this path or under it")
    .option("--limit <n>", "Max items", parseCount("--limit"))
    .addHelpText(
      "after",
      examples(["yadisk trash ls --limit 20 --json", "yadisk trash ls --origin /releases --limit 1 --json   # what did I just delete?"])
    )
    .action(async (options) => {
      const items = await withTask("Reading the trash", () =>
        getClient().trashList({ origin: options.origin, limit: options.limit })
      )
      emit(items, formatTrashList(items))
    })

  trash
    .command("restore")
    .description("Restore a trash item to where it was deleted from")
    .argument("<trash-path>", 'Trash path from "trash ls" (e.g. trash:/build.zip_1f2e…)')
    .option("--name <name>", "Restore under a different name")
    .option("--overwrite", "Replace an existing file at the original location")
    .addHelpText("after", examples(['yadisk trash restore "trash:/build.zip_1f2e…" --json']))
    .action(async (trashPath: string, options) => {
      const restored = await getClient().trashRestore(trashPath, { name: options.name, overwrite: options.overwrite })
      emit({ trash_path: trashPath, path: restored, restored: true }, `Restored: ${trashPath} → ${restored}`)
    })

  const pub = program
    .command("public")
    .description("Read anyone's public link (https://disk.yandex.ru/d/…) — no credentials needed")

  pub
    .command("stat")
    .description("Metadata of a public resource")
    .argument("<url>", "Public link")
    .option("--path <path>", "File inside a published folder", "/")
    .action(async (url: string, options) => {
      const resource = await new PublicClient(getClientOptions()).stat(url, options.path)
      emit(resource, formatResource(resource))
    })

  pub
    .command("ls")
    .description("List a published folder")
    .argument("<url>", "Public link")
    .option("--path <path>", "Subfolder inside the published folder", "/")
    .option("--limit <n>", "Max items", parseCount("--limit"))
    .action(async (url: string, options) => {
      const items = await new PublicClient(getClientOptions()).list(url, options.path, { limit: options.limit })
      emit(items, formatResourceList(items))
    })

  pub
    .command("download")
    .description("Download a public file, or a published folder as .zip")
    .argument("<url>", "Public link")
    .argument("[dest]", "Local file, or folder / path ending in /")
    .option("--path <path>", "File inside a published folder", "/")
    .addHelpText(
      "after",
      examples([
        "yadisk public download https://disk.yandex.ru/d/AbCd ./out/ --json",
        "yadisk public download https://disk.yandex.ru/d/AbCd --path /docs/a.pdf --json",
      ])
    )
    .action(async (url: string, dest: string | undefined, options) => {
      const result = await withTask(`Downloading ${url}`, () =>
        new PublicClient(getClientOptions()).download(url, dest, options.path)
      )
      emit({ url, ...result }, `Downloaded${result.archive ? " as zip" : ""}: ${url} → ${result.local_path} (${formatSize(result.size)})`)
    })
}
