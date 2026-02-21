#!/usr/bin/env bun

import { Command } from "commander"
import chalk from "chalk"
import ora from "ora"
import {
  YaDiskClient,
  getCredentials,
  getConfig,
  getConfigValue,
  setConfigValue,
  deleteConfigValue,
  isValidConfigKey,
} from "@vforsh/yadisk"
import type { Credentials, Resource } from "@vforsh/yadisk"
import {
  formatDiskInfo,
  formatResourceList,
  formatResource,
  formatJson,
  formatSize,
} from "./format"
import { basename } from "path"
import { createInterface } from "readline"

const program = new Command()

function getClient(): YaDiskClient {
  const opts = program.opts()
  const credentials = getCredentials({ username: opts.username, password: opts.password })
  return new YaDiskClient(credentials)
}

function resolveUploadDest(file: string, dest?: string): string {
  if (dest) return dest
  const uploadDir = getConfigValue("upload_dir")
  if (!uploadDir) {
    console.error(
      "Error: No destination specified.\n" +
        "Provide <dest> argument or set default: yadisk config set upload_dir /path"
    )
    process.exit(1)
  }
  return `${uploadDir.replace(/\/$/, "")}/${basename(file)}`
}

program
  .name("yadisk")
  .description("Yandex.Disk file management CLI")
  .version("1.0.0")
  .option("--username <username>", "Yandex username (overrides env)")
  .option("--password <password>", "App password (overrides env)")
  .option("--json", "Output as JSON")

// --- yadisk auth ---

program
  .command("auth")
  .description("Authenticate with username and app password")
  .action(async () => {
    const username = await prompt("Username: ")
    if (!username) {
      console.error("Error: No username provided.")
      process.exit(1)
    }

    const password = await promptSecret("App password: ")
    if (!password) {
      console.error("Error: No app password provided.")
      process.exit(1)
    }

    const credentials: Credentials = { username, password }
    const spinner = ora("Validating credentials...").start()
    try {
      const client = new YaDiskClient(credentials)
      await client.info()
      spinner.succeed(`Authenticated as ${username}`)
    } catch (err) {
      spinner.fail("Authentication failed — check username and app password")
      throw err
    }

    setConfigValue("username", username)
    setConfigValue("password", password)
    console.log("Credentials saved to ~/.config/yadisk/config.json")
  })

// --- yadisk config ---

const configCmd = program
  .command("config")
  .description("Manage configuration")

configCmd
  .command("set")
  .description("Set a config value")
  .argument("<key>", "Config key (username, password, upload_dir)")
  .argument("<value>", "Config value")
  .action((key: string, value: string) => {
    if (!isValidConfigKey(key)) {
      console.error(`Unknown config key: ${key}`)
      console.error("Valid keys: username, password, upload_dir")
      process.exit(1)
    }
    setConfigValue(key, value)
    console.log(`${key} = ${key === "password" ? "***" : value}`)
  })

configCmd
  .command("get")
  .description("Get a config value")
  .argument("<key>", "Config key")
  .action((key: string) => {
    if (!isValidConfigKey(key)) {
      console.error(`Unknown config key: ${key}`)
      process.exit(1)
    }
    const value = getConfigValue(key)
    if (value !== undefined) {
      console.log(key === "password" ? "***" : value)
    } else {
      console.error(`${key} is not set`)
      process.exit(1)
    }
  })

configCmd
  .command("list")
  .description("List all config values")
  .action(() => {
    const config = getConfig()
    const entries = Object.entries(config)
    if (entries.length === 0) {
      console.log("No config values set.")
    } else {
      for (const [key, value] of entries) {
        console.log(`${key} = ${key === "password" ? "***" : value}`)
      }
    }
  })

configCmd
  .command("unset")
  .description("Remove a config value")
  .argument("<key>", "Config key")
  .action((key: string) => {
    if (!isValidConfigKey(key)) {
      console.error(`Unknown config key: ${key}`)
      process.exit(1)
    }
    deleteConfigValue(key)
    console.log(`Removed: ${key}`)
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
  .option("--sort <field>", "Sort field (name, size, modified)", "name")
  .action(async (path: string, options) => {
    const client = getClient()
    const items = await client.list(path)

    const sorted = sortResources(items, options.sort)

    if (program.opts().json) {
      console.log(formatJson(sorted))
    } else {
      console.log(formatResourceList(sorted))
      console.log(chalk.dim(`\n${sorted.length} items`))
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
  .argument("[dest]", "Destination disk path (default: <upload_dir>/<filename>)")
  .option("--publish", "Publish after upload")
  .action(async (file: string, dest: string | undefined, options) => {
    const client = getClient()

    const resolvedDest = resolveUploadDest(file, dest)
    const fileObj = Bun.file(file)
    const size = fileObj.size
    const spinner = ora(`Uploading ${basename(file)} (${formatSize(size)})...`).start()

    try {
      await client.upload(resolvedDest, file)
      spinner.succeed(`Uploaded: ${basename(file)} → ${resolvedDest}`)
    } catch (err) {
      spinner.fail("Upload failed")
      throw err
    }

    if (options.publish) {
      const url = await client.publish(resolvedDest)
      const publicUrl = url ?? await client.getPublicUrl(resolvedDest)
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
      await client.download(path, localDest)
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
  .action(async (path: string) => {
    const client = getClient()
    await client.delete(path)
    console.log(`Deleted: ${path}`)
  })

// --- yadisk publish ---

program
  .command("publish")
  .description("Publish a resource and get public URL")
  .argument("<path>", "Disk path")
  .action(async (path: string) => {
    const client = getClient()
    const url = await client.publish(path)
    if (url) {
      console.log(url)
    } else {
      const existing = await client.getPublicUrl(path)
      console.log(existing ?? "Published (no URL returned)")
    }
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

// --- Helpers ---

function prompt(message: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function promptSecret(message: string): Promise<string> {
  process.stdout.write(message)
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, terminal: false })
    process.stdin.setRawMode?.(true)
    let input = ""
    const onData = (ch: Buffer) => {
      const c = ch.toString()
      if (c === "\n" || c === "\r") {
        process.stdin.setRawMode?.(false)
        process.stdin.removeListener("data", onData)
        rl.close()
        process.stdout.write("\n")
        resolve(input.trim())
      } else if (c === "\x7f" || c === "\b") {
        input = input.slice(0, -1)
      } else if (c === "\x03") {
        process.exit(130)
      } else {
        input += c
      }
    }
    process.stdin.on("data", onData)
  })
}

function sortResources(items: Resource[], field: string): Resource[] {
  const sorted = [...items]
  switch (field) {
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name))
      break
    case "size":
      sorted.sort((a, b) => (a.size ?? 0) - (b.size ?? 0))
      break
    case "modified":
      sorted.sort((a, b) => new Date(a.modified).getTime() - new Date(b.modified).getTime())
      break
    case "-name":
      sorted.sort((a, b) => b.name.localeCompare(a.name))
      break
    case "-size":
      sorted.sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
      break
    case "-modified":
      sorted.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
      break
  }
  return sorted
}

// --- Run ---

program.parseAsync().catch((err: Error) => {
  console.error(chalk.red(`Error: ${err.message}`))
  process.exit(1)
})
