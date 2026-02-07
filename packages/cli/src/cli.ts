#!/usr/bin/env bun

import { Command } from "commander"
import chalk from "chalk"
import ora from "ora"
import { YaDiskClient, getToken, runOAuthFlow } from "@vforsh/yadisk"
import {
  formatDiskInfo,
  formatResourceList,
  formatResource,
  formatJson,
  formatSize,
} from "./format"
import { basename } from "path"

const program = new Command()

function getClient(): YaDiskClient {
  const token = getToken({ token: program.opts().token })
  return new YaDiskClient(token)
}

program
  .name("yadisk")
  .description("Yandex.Disk file management CLI")
  .version("1.0.0")
  .option("--token <token>", "OAuth token (overrides env)")
  .option("--json", "Output as JSON")

// --- yadisk auth ---

program
  .command("auth")
  .description("Authenticate via OAuth and save token")
  .requiredOption("--client-id <id>", "OAuth application client ID")
  .action(async (options) => {
    const token = await runOAuthFlow(options.clientId)

    const spinner = ora("Validating token...").start()
    try {
      const client = new YaDiskClient(token)
      const disk = await client.info()
      spinner.succeed(`Authenticated as ${disk.user.display_name} (${disk.user.login})`)
    } catch (err) {
      spinner.fail("Token validation failed")
      throw err
    }
  })

// --- yadisk info ---

program
  .command("info")
  .description("Show disk usage and capacity")
  .action(async () => {
    const client = getClient()
    const disk = await client.info()

    if (program.opts().json) {
      console.log(formatJson(disk))
    } else {
      console.log(formatDiskInfo(disk))
    }
  })

// --- yadisk ls ---

program
  .command("ls")
  .description("List folder contents")
  .argument("<path>", "Disk path (e.g. /uploads)")
  .option("--limit <n>", "Max items", "20")
  .option("--offset <n>", "Offset", "0")
  .option("--sort <field>", "Sort field (name, size, modified)", "name")
  .action(async (path: string, options) => {
    const client = getClient()
    const resource = await client.list(path, {
      limit: parseInt(options.limit, 10),
      offset: parseInt(options.offset, 10),
      sort: options.sort,
    })

    if (program.opts().json) {
      console.log(formatJson(resource._embedded))
    } else if (resource._embedded) {
      console.log(formatResourceList(resource._embedded.items))
      const { offset, limit, total } = resource._embedded
      console.log(chalk.dim(`\n${offset + resource._embedded.items.length}/${total} items`))
    } else {
      console.log("Not a folder or empty.")
    }
  })

// --- yadisk stat ---

program
  .command("stat")
  .description("Show file/folder metadata")
  .argument("<path>", "Disk path")
  .action(async (path: string) => {
    const client = getClient()
    const resource = await client.stat(path)

    if (program.opts().json) {
      console.log(formatJson(resource))
    } else {
      console.log(formatResource(resource))
    }
  })

// --- yadisk mkdir ---

program
  .command("mkdir")
  .description("Create a folder")
  .argument("<path>", "Disk path")
  .action(async (path: string) => {
    const client = getClient()
    await client.mkdir(path)
    console.log(`Created: ${path}`)
  })

// --- yadisk upload ---

program
  .command("upload")
  .description("Upload a local file to Yandex.Disk")
  .argument("<file>", "Local file path")
  .argument("<dest>", "Destination disk path")
  .option("--overwrite", "Overwrite existing file", true)
  .option("--publish", "Publish after upload")
  .action(async (file: string, dest: string, options) => {
    const client = getClient()

    const fileObj = Bun.file(file)
    const size = fileObj.size
    const spinner = ora(`Uploading ${basename(file)} (${formatSize(size)})...`).start()

    try {
      const uploadUrl = await client.getUploadUrl(dest, options.overwrite)
      await client.upload(uploadUrl, file)
      spinner.succeed(`Uploaded: ${basename(file)} → ${dest}`)
    } catch (err) {
      spinner.fail("Upload failed")
      throw err
    }

    if (options.publish) {
      await client.publish(dest)
      const publicUrl = await client.getPublicUrl(dest)
      console.log(`Public URL: ${publicUrl}`)
    }
  })

// --- yadisk download ---

program
  .command("download")
  .description("Download a file from Yandex.Disk")
  .argument("<path>", "Disk path")
  .argument("[dest]", "Local destination (default: current dir + filename)")
  .action(async (path: string, dest?: string) => {
    const client = getClient()
    const localDest = dest ?? basename(path)

    const spinner = ora(`Downloading ${basename(path)}...`).start()
    try {
      const downloadUrl = await client.getDownloadUrl(path)
      await client.download(downloadUrl, localDest)
      spinner.succeed(`Downloaded: ${path} → ${localDest}`)
    } catch (err) {
      spinner.fail("Download failed")
      throw err
    }
  })

// --- yadisk cp ---

program
  .command("cp")
  .description("Copy a file or folder")
  .argument("<from>", "Source disk path")
  .argument("<to>", "Destination disk path")
  .option("--overwrite", "Overwrite if exists")
  .action(async (from: string, to: string, options) => {
    const client = getClient()
    await client.copy(from, to, options.overwrite)
    console.log(`Copied: ${from} → ${to}`)
  })

// --- yadisk mv ---

program
  .command("mv")
  .description("Move or rename a file or folder")
  .argument("<from>", "Source disk path")
  .argument("<to>", "Destination disk path")
  .option("--overwrite", "Overwrite if exists")
  .action(async (from: string, to: string, options) => {
    const client = getClient()
    await client.move(from, to, options.overwrite)
    console.log(`Moved: ${from} → ${to}`)
  })

// --- yadisk rm ---

program
  .command("rm")
  .description("Delete a file or folder")
  .argument("<path>", "Disk path")
  .option("--permanently", "Delete permanently (skip trash)")
  .action(async (path: string, options) => {
    const client = getClient()
    await client.delete(path, options.permanently)
    console.log(`Deleted: ${path}`)
  })

// --- yadisk publish ---

program
  .command("publish")
  .description("Publish a resource and get public URL")
  .argument("<path>", "Disk path")
  .action(async (path: string) => {
    const client = getClient()
    await client.publish(path)
    const publicUrl = await client.getPublicUrl(path)
    console.log(publicUrl)
  })

// --- yadisk unpublish ---

program
  .command("unpublish")
  .description("Remove public access from a resource")
  .argument("<path>", "Disk path")
  .action(async (path: string) => {
    const client = getClient()
    await client.unpublish(path)
    console.log(`Unpublished: ${path}`)
  })

// --- Run ---

program.parseAsync().catch((err: Error) => {
  console.error(chalk.red(`Error: ${err.message}`))
  process.exit(1)
})
