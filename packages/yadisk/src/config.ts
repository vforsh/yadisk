import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"

const CONFIG_DIR = join(homedir(), ".config", "yadisk")
const CONFIG_FILE = join(CONFIG_DIR, "config.json")

export interface YaDiskConfig {
  upload_dir?: string
}

const KNOWN_KEYS = new Set<keyof YaDiskConfig>(["upload_dir"])

export function isValidConfigKey(key: string): key is keyof YaDiskConfig {
  return KNOWN_KEYS.has(key as keyof YaDiskConfig)
}

export function getConfig(): YaDiskConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"))
  } catch {
    return {}
  }
}

export function getConfigValue<K extends keyof YaDiskConfig>(key: K): YaDiskConfig[K] {
  return getConfig()[key]
}

export function setConfigValue<K extends keyof YaDiskConfig>(key: K, value: YaDiskConfig[K]): void {
  const config = getConfig()
  config[key] = value
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 })
}

export function deleteConfigValue<K extends keyof YaDiskConfig>(key: K): void {
  const config = getConfig()
  delete config[key]
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 })
}
