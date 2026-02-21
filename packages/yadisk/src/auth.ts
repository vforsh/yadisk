import { getConfig } from "./config"
import type { Credentials, GetCredentialsOptions } from "./types"

export function getCredentials(options?: GetCredentialsOptions): Credentials {
  // 1. explicit flags
  if (options?.username && options?.password) {
    return { username: options.username, password: options.password }
  }

  // 2. env vars
  const envUser = process.env.YADISK_USERNAME
  const envPass = process.env.YADISK_PASSWORD
  if (envUser && envPass) {
    return { username: envUser, password: envPass }
  }

  // 3. config file
  const config = getConfig()
  if (config.username && config.password) {
    return { username: config.username, password: config.password }
  }

  console.error(
    "Error: No credentials found.\n" +
      "Provide via --username/--password flags, YADISK_USERNAME/YADISK_PASSWORD env, or run: yadisk auth"
  )
  process.exit(1)
}

export function encodeBasicAuth(credentials: Credentials): string {
  const encoded = btoa(`${credentials.username}:${credentials.password}`)
  return `Basic ${encoded}`
}
