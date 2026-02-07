import { homedir } from "os"
import { join } from "path"
import type { GetTokenOptions } from "./types"

const CONFIG_DIR = join(homedir(), ".config", "yadisk")
const TOKEN_FILE = join(CONFIG_DIR, "token")

export function getToken(options?: GetTokenOptions): string {
  // 1. explicit token
  if (options?.token) return options.token

  // 2. YADISK_TOKEN env
  const envToken = process.env.YADISK_TOKEN
  if (envToken) return envToken

  // 3. ~/.config/yadisk/token file
  const fileToken = readTokenFile()
  if (fileToken) return fileToken

  console.error(
    "Error: No token found.\n" +
      "Provide via --token flag, YADISK_TOKEN env, or run: yadisk auth --client-id <id>"
  )
  process.exit(1)
}

function readTokenFile(): string | null {
  try {
    const content = require("fs").readFileSync(TOKEN_FILE, "utf-8").trim()
    return content || null
  } catch {
    return null
  }
}

export async function saveToken(token: string): Promise<void> {
  const fs = await import("fs")
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 })
}

export async function runOAuthFlow(clientId: string): Promise<string> {
  const url = `https://oauth.yandex.ru/authorize?response_type=token&client_id=${clientId}`
  console.log(`Open this URL in your browser:\n  ${url}\n`)
  console.log("After authorization, copy the token and paste it below.\n")

  const token = await promptForToken()
  if (!token) {
    console.error("Error: No token provided.")
    process.exit(1)
  }

  await saveToken(token)
  console.log(`Token saved to ${TOKEN_FILE}`)
  return token
}

async function promptForToken(): Promise<string> {
  process.stdout.write("Token: ")
  for await (const line of console) {
    return line.trim()
  }
  return ""
}
