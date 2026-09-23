import type { Command } from "commander"
import {
  YaDiskError,
  deleteConfigValue,
  getConfig,
  getConfigValue,
  isValidConfigKey,
  setConfigValue,
} from "@vforsh/yadisk"
import type { YaDiskConfig } from "@vforsh/yadisk"
import { emit } from "../output"

const SECRET_KEYS = new Set(["password", "token"])
const VALID_KEYS = "username, password, token, upload_dir"

function displayValue(key: string, value: unknown): string {
  return SECRET_KEYS.has(key) ? "***" : String(value)
}

function requireKey(key: string): keyof YaDiskConfig {
  if (!isValidConfigKey(key)) {
    throw new YaDiskError("usage", `Unknown config key: ${key}`, { hint: `Valid keys: ${VALID_KEYS}` })
  }
  return key
}

export function registerConfig(program: Command): void {
  const configCmd = program.command("config").description("Manage configuration")

  configCmd
    .command("set")
    .description("Set a config value")
    .argument("<key>", `Config key (${VALID_KEYS})`)
    .argument("<value>", "Config value")
    .action((key: string, value: string) => {
      const configKey = requireKey(key)
      setConfigValue(configKey, value)
      const shown = displayValue(key, value)
      emit({ key, value: shown }, `${key} = ${shown}`)
    })

  configCmd
    .command("get")
    .description("Get a config value")
    .argument("<key>", "Config key")
    .action((key: string) => {
      const value = getConfigValue(requireKey(key))
      if (value === undefined) throw new YaDiskError("not_found", `${key} is not set`)
      const shown = displayValue(key, value)
      emit({ key, value: shown }, shown)
    })

  configCmd
    .command("list")
    .description("List all config values (secrets masked)")
    .action(() => {
      const entries = Object.entries(getConfig()).map(([key, value]) => [key, displayValue(key, value)])
      const human = entries.length ? entries.map(([k, v]) => `${k} = ${v}`).join("\n") : "No config values set."
      emit(Object.fromEntries(entries), human)
    })

  configCmd
    .command("unset")
    .description("Remove a config value")
    .argument("<key>", "Config key")
    .action((key: string) => {
      deleteConfigValue(requireKey(key))
      emit({ key, removed: true }, `Removed: ${key}`)
    })
}
