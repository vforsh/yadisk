import { getConfig } from "./config"
import { YaDiskError } from "./errors"
import type { Credentials, GetCredentialsOptions } from "./types"

export type CredentialSource = "flag" | "env" | "config"

/** Each credential with where it came from, for diagnostics (`yadisk status`). */
export interface ResolvedCredentials {
  token?: { value: string; source: CredentialSource }
  basic?: { username: string; password: string; source: CredentialSource }
}

/**
 * Username/password (flags → env → config) and the OAuth token (flag → env → config) resolve independently.
 * Either is enough: the token alone drives everything through REST.
 */
export function getCredentials(options?: GetCredentialsOptions): Credentials {
  const { token, basic } = resolveCredentials(options)
  if (!basic && !token) {
    throw new YaDiskError("auth", "No credentials found", {
      hint: "Set YADISK_TOKEN (or YADISK_USERNAME/YADISK_PASSWORD), or run: yadisk auth --oauth",
    })
  }
  return { username: basic?.username, password: basic?.password, token: token?.value }
}

/** Like getCredentials, but reports each credential's source and never throws when none is found. */
export function resolveCredentials(options?: GetCredentialsOptions): ResolvedCredentials {
  const config = getConfig()
  const token = first<string>([
    [options?.token, "flag"],
    [process.env.YADISK_TOKEN, "env"],
    [config.token, "config"],
  ])
  const basic = first<{ username: string; password: string }>([
    [pair(options?.username, options?.password), "flag"],
    [pair(process.env.YADISK_USERNAME, process.env.YADISK_PASSWORD), "env"],
    [pair(config.username, config.password), "config"],
  ])
  return { token: token && { value: token.value, source: token.source }, basic: basic && { ...basic.value, source: basic.source } }
}

export function encodeBasicAuth(credentials: { username: string; password: string }): string {
  return `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`
}

function first<T>(candidates: [T | undefined, CredentialSource][]): { value: T; source: CredentialSource } | undefined {
  for (const [value, source] of candidates) if (value) return { value, source }
  return undefined
}

function pair(username?: string, password?: string): { username: string; password: string } | undefined {
  return username && password ? { username, password } : undefined
}
