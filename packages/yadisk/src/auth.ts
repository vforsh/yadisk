import { getConfig } from "./config"
import { YaDiskError } from "./errors"
import type { Credentials, GetCredentialsOptions } from "./types"

/**
 * Username/password (flags → env → config) and the OAuth token (flag → env → config) resolve independently.
 * Either is enough: the token alone drives everything through REST.
 */
export function getCredentials(options?: GetCredentialsOptions): Credentials {
  const token = options?.token || process.env.YADISK_TOKEN || getConfig().token || undefined
  const basic = resolveBasic(options)
  if (!basic && !token) {
    throw new YaDiskError("auth", "No credentials found", {
      hint: "Set YADISK_TOKEN (or YADISK_USERNAME/YADISK_PASSWORD), or run: yadisk auth --oauth",
    })
  }
  return { ...basic, token }
}

function resolveBasic(options?: GetCredentialsOptions): { username: string; password: string } | undefined {
  if (options?.username && options?.password) return { username: options.username, password: options.password }
  const { YADISK_USERNAME: username, YADISK_PASSWORD: password } = process.env
  if (username && password) return { username, password }
  const config = getConfig()
  if (config.username && config.password) return { username: config.username, password: config.password }
  return undefined
}

export function encodeBasicAuth(credentials: { username: string; password: string }): string {
  return `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`
}
