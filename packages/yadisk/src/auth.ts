import { getConfig } from "./config"
import type { Credentials, GetCredentialsOptions } from "./types"

export function getCredentials(options?: GetCredentialsOptions): Credentials {
  const token = resolveToken(options)

  // 1. explicit flags
  if (options?.username && options?.password) {
    return { username: options.username, password: options.password, token }
  }

  // 2. env vars
  const envUser = process.env.YADISK_USERNAME
  const envPass = process.env.YADISK_PASSWORD
  if (envUser && envPass) {
    return { username: envUser, password: envPass, token }
  }

  // 3. config file
  const config = getConfig()
  if (config.username && config.password) {
    return { username: config.username, password: config.password, token }
  }

  console.error(
    "Error: No credentials found.\n" +
      "Provide via --username/--password flags, YADISK_USERNAME/YADISK_PASSWORD env, or run: yadisk auth"
  )
  process.exit(1)
}

// Resolved independently of username/password: the token is optional and only used for uploads.
function resolveToken(options?: GetCredentialsOptions): string | undefined {
  return options?.token || process.env.YADISK_TOKEN || getConfig().token || undefined
}

export function encodeBasicAuth(credentials: Credentials): string {
  const encoded = btoa(`${credentials.username}:${credentials.password}`)
  return `Basic ${encoded}`
}
