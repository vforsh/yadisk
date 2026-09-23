import type { Command } from "commander"
import { CONFIG_FILE, YaDiskClient, YaDiskError, checkToken, setConfigValue } from "@vforsh/yadisk"
import { getClientOptions } from "../context"
import { emit, warn } from "../output"
import { withTask } from "../progress"
import { prompt, promptSecret } from "../prompts"

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
  emit(
    { token_saved: true, read: access.read, write: access.write, config_path: CONFIG_FILE },
    `Token valid (${scopes.join(", ")})\nToken saved to ${CONFIG_FILE}`
  )
}
