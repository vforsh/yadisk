import type { Command } from "commander"
import { CONFIG_FILE, YaDiskClient, YaDiskError, checkToken, isYaDiskError, resolveCredentials, setConfigValue } from "@vforsh/yadisk"
import type { BackendKind, ClientOptions, CredentialSource, ResolvedCredentials } from "@vforsh/yadisk"
import { getClientOptions } from "../context"
import { EXIT_CODES, emit, warn } from "../output"
import { withTask } from "../progress"
import { prompt, promptSecret } from "../prompts"

interface TokenStatus {
  source: CredentialSource
  valid: boolean
  read: boolean
  write: boolean
  login: string | null
  error?: string
}

interface AppPasswordStatus {
  source: CredentialSource
  username: string
  valid: boolean
  error?: string
}

export function registerAuth(program: Command): void {
  program
    .command("auth")
    .description("Authenticate with username and app password, or save an OAuth token with --oauth")
    .option("--oauth", "Save an OAuth token (REST API: fast uploads, trash, find, zip downloads)")
    .option("--client-id <id>", "OAuth app client ID (prints the authorize URL)")
    .action(async (options) => {
      if (options.oauth) {
        await authOAuth(options.clientId)
        return
      }

      const clientOptions = getClientOptions()
      const username = await prompt("Username: ", "username")
      const password = await promptSecret("App password: ", "app password")

      await withTask("Validating credentials", () => new YaDiskClient({ username, password }, clientOptions).info())

      setConfigValue("username", username)
      setConfigValue("password", password)
      emit(
        { authenticated: true, username, config_path: CONFIG_FILE },
        `Authenticated as ${username}\nCredentials saved to ${CONFIG_FILE}`
      )
    })

  program
    .command("status")
    .alias("whoami")
    .description("Which credentials are set (and from where), whether they work, and the backend in use (exit 3 if none)")
    .action(async () => {
      const opts = program.opts()
      const { token, basic } = resolveCredentials({ username: opts.username, password: opts.password, token: opts.token })
      const clientOptions = getClientOptions()
      const [tokenStatus, passwordStatus] = await withTask("Checking credentials", () =>
        Promise.all([probeToken(token, clientOptions.timeoutMs), probeAppPassword(basic, clientOptions)])
      )
      const backend = activeBackend(tokenStatus, passwordStatus)
      const report = {
        ready: backend !== null,
        backend,
        login: tokenStatus?.login ?? passwordStatus?.username ?? null,
        token: tokenStatus ?? null,
        app_password: passwordStatus ?? null,
        fallback: Boolean(tokenStatus && passwordStatus?.valid),
        config_path: CONFIG_FILE,
        ...(!backend && {
          error: new YaDiskError("auth", token || basic ? "No working credentials" : "No credentials found", {
            hint: "Run: yadisk auth --oauth, or set YADISK_TOKEN",
          }).toJSON(),
        }),
      }
      emit(report, formatStatus(report))
      if (!backend) process.exitCode = EXIT_CODES.auth
    })
}

async function probeToken(token: ResolvedCredentials["token"], timeoutMs?: number): Promise<TokenStatus | undefined> {
  if (!token) return undefined
  try {
    const access = await checkToken(token.value, timeoutMs)
    return { source: token.source, valid: true, read: access.read, write: access.write, login: access.login ?? null }
  } catch (err) {
    if (!isRejection(err)) throw err
    return { source: token.source, valid: false, read: false, write: false, login: null, error: err.message }
  }
}

async function probeAppPassword(basic: ResolvedCredentials["basic"], options: ClientOptions): Promise<AppPasswordStatus | undefined> {
  if (!basic) return undefined
  const status = { source: basic.source, username: basic.username }
  try {
    await new YaDiskClient({ username: basic.username, password: basic.password }, options).info()
    return { ...status, valid: true }
  } catch (err) {
    if (!isRejection(err)) throw err
    return { ...status, valid: false, error: err.message }
  }
}

// Mirrors YaDiskClient: REST first. A rejected token — or one that can't read, whose first read is rejected — falls
// back to WebDAV for the rest of the process when an app password works.
function activeBackend(token?: TokenStatus, password?: AppPasswordStatus): BackendKind | null {
  const tokenWorks = token?.valid && (token.read || token.write)
  if (tokenWorks && (token.read || !password?.valid)) return "rest"
  if (password?.valid) return "webdav"
  return null
}

function formatStatus(report: {
  backend: string | null
  login: string | null
  token: TokenStatus | null
  app_password: AppPasswordStatus | null
  fallback: boolean
}): string {
  const lines = [
    `Backend:      ${report.backend ?? "none — no working credentials"}`,
    `Login:        ${report.login ?? "-"}`,
    `Token:        ${describeToken(report.token)}`,
    `App password: ${describeAppPassword(report.app_password)}`,
  ]
  if (report.token) lines.push(`WebDAV fallback: ${report.fallback ? "available" : "none"}`)
  return lines.join("\n")
}

function describeToken(token: TokenStatus | null): string {
  if (!token) return "not set"
  if (!token.valid) return `rejected (${token.source}): ${token.error}`
  const scopes = [token.read && "read", token.write && "write"].filter(Boolean).join("+")
  return `valid (${scopes || "no disk scopes"}) from ${token.source}`
}

function describeAppPassword(password: AppPasswordStatus | null): string {
  if (!password) return "not set"
  if (!password.valid) return `rejected (${password.source}): ${password.error}`
  return `valid for ${password.username} from ${password.source}`
}

async function authOAuth(clientId?: string): Promise<void> {
  if (clientId) {
    const url = `https://oauth.yandex.ru/authorize?response_type=token&client_id=${clientId}`
    console.error(`Open this URL, grant access, and copy the token:\n  ${url}\n`)
  }

  const { timeoutMs } = getClientOptions()
  const token = await promptSecret("OAuth token: ", "OAuth token")

  const access = await withTask("Validating token", () => checkToken(token, timeoutMs))
  if (!access.read && !access.write) {
    throw new YaDiskError("auth", "Token has neither cloud_api:disk.read nor cloud_api:disk.write", {
      hint: "Grant both scopes to the OAuth app and issue a new token",
    })
  }
  if (!access.read) warn("Warning: token lacks cloud_api:disk.read — reads fall back to WebDAV (needs yadisk auth)")
  if (!access.write) warn("Warning: token lacks cloud_api:disk.write — uploads and changes fall back to WebDAV")

  setConfigValue("token", token)
  const scopes = [access.read && "cloud_api:disk.read", access.write && "cloud_api:disk.write"].filter(Boolean)
  const who = access.login ? ` for ${access.login}` : ""
  emit(
    { token_saved: true, read: access.read, write: access.write, login: access.login ?? null, config_path: CONFIG_FILE },
    `Token valid${who} (${scopes.join(", ")})\nToken saved to ${CONFIG_FILE}`
  )
}

// A credential the server refuses (WebDAV answers some refusals with 403 → forbidden). Network/server errors still fail.
function isRejection(err: unknown): err is YaDiskError {
  return isYaDiskError(err, "auth") || isYaDiskError(err, "forbidden")
}
