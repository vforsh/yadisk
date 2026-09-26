import type { Command } from "commander"
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { YaDiskError } from "@vforsh/yadisk"
import { EXIT_CODES, EXIT_RUNNING, emit } from "./output"

// `--detach` re-runs the same command line as a detached child with --json. The child's stdout (the one JSON result)
// and stderr (progress log) go to files in the job's folder, and the child records its exit code on the way out, so
// `yadisk job <id>` can answer from those files alone — no daemon, nothing to keep alive.
const JOBS_DIR = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "yadisk", "jobs")
const JOB_ENV = "YADISK_JOB_DIR"
const KEEP_FINISHED_MS = 7 * 24 * 3600 * 1000
const POLL_MS = 1000
// Passed to the child as env instead: argv is visible in `ps` for the job's whole run, and is stored in job.json.
const CREDENTIAL_FLAGS: Record<string, string> = {
  "--token": "YADISK_TOKEN",
  "--username": "YADISK_USERNAME",
  "--password": "YADISK_PASSWORD",
}
const KNOWN_EXIT_CODES = new Set(Object.values(EXIT_CODES))

export const DETACH_HELP = "Run in the background: prints a job id at once; get the result with: yadisk job <id> --wait <sec>"

interface JobMeta {
  id: string
  command: string
  /** Without credential flags (the child gets those as env). */
  argv: string[]
  cwd: string
  pid: number
  started_at: string
}

interface JobExit {
  exit_code: number
  finished_at: string
}

export type JobStatus = "running" | "done" | "failed" | "lost"

export interface JobReport {
  job_id: string
  command: string
  argv: string[]
  status: JobStatus
  pid: number
  started_at: string
  finished_at: string | null
  exit_code: number | null
  /** The job's stderr: progress, retries, warnings. */
  log: string
  /** Last log line, while running. */
  progress?: string
  /** The command's JSON output (also present on partial failures, e.g. a batch upload). */
  result?: unknown
  error?: unknown
}

/** Wraps a command action: with --detach, the command starts as a background job instead of running here. */
export function detachable<A extends unknown[]>(action: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  return async (...args) => {
    const command = args.at(-1) as Command
    if (!command.opts().detach) return action(...args)
    const job = startJob(command)
    const check = `yadisk job ${job.id} --wait 100 --json`
    emit(
      { job_id: job.id, status: "running", command: job.command, pid: job.pid, log: logPath(job.id), hint: `Check: ${check}` },
      `Started job ${job.id} (pid ${job.pid})\nCheck: ${check}`
    )
  }
}

/** In a job's child process: records the exit code however the process ends (normally, via exit(), or a signal). */
export function recordJobExit(): void {
  const dir = process.env[JOB_ENV]
  if (!dir) return
  delete process.env[JOB_ENV]
  process.on("exit", (code) => {
    const record: JobExit = { exit_code: code, finished_at: new Date().toISOString() }
    writeFileSync(join(dir, "exit.json"), JSON.stringify(record))
  })
  // Signals skip "exit" handlers by default; exiting explicitly turns `kill <pid>` into a recorded failure.
  for (const [signal, number] of [["SIGTERM", 15], ["SIGHUP", 1], ["SIGINT", 2]] as const) {
    process.on(signal, () => process.exit(128 + number))
  }
}

export function readJob(id: string): JobReport {
  if (!/^[0-9a-f]{8}$/.test(id)) throw new YaDiskError("usage", `Invalid job id: ${id}`, { hint: "List jobs: yadisk jobs" })
  const meta = readJson<JobMeta>(join(jobDir(id), "job.json"))
  if (!meta) throw new YaDiskError("not_found", `No such job: ${id}`, { hint: "List jobs: yadisk jobs" })
  const exit = readJson<JobExit>(join(jobDir(id), "exit.json"))
  const log = logPath(id)
  const report: JobReport = {
    job_id: id,
    command: meta.command,
    argv: meta.argv,
    status: "running",
    pid: meta.pid,
    started_at: meta.started_at,
    finished_at: exit?.finished_at ?? null,
    exit_code: exit?.exit_code ?? null,
    log,
  }

  if (!exit) {
    if (isAlive(meta.pid)) return { ...report, status: "running", progress: lastLine(log) }
    // It may have finished between the first read and the liveness check.
    const late = readJson<JobExit>(join(jobDir(id), "exit.json"))
    if (late) return readJob(id)
    return {
      ...report,
      status: "lost",
      error: jobError("The job's process ended without recording a result", `Check the log (${log}) and re-run`),
    }
  }
  const output = readJson<unknown>(join(jobDir(id), "stdout"))
  if (exit.exit_code === 0) return { ...report, status: "done", result: output }
  const envelope = (output as { error?: unknown } | undefined)?.error
  if (envelope) return { ...report, status: "failed", error: envelope }
  return {
    ...report,
    status: "failed",
    ...(output !== undefined && { result: output }),
    error: jobError(
      exit.exit_code > 128 ? `Killed by signal ${exit.exit_code - 128}` : `Finished with exit code ${exit.exit_code}`,
      output === undefined ? `Check the log (${log}) and re-run` : "See result for per-item errors"
    ),
  }
}

/** Polls until the job leaves "running" or `timeoutMs` passes. */
export async function waitForJob(id: string, timeoutMs: number): Promise<JobReport> {
  const deadline = Date.now() + timeoutMs
  let report = readJob(id)
  while (report.status === "running" && Date.now() < deadline) {
    await Bun.sleep(Math.min(POLL_MS, deadline - Date.now()))
    report = readJob(id)
  }
  return report
}

/** Newest first, without result/error bodies. */
export function listJobs(): JobReport[] {
  return jobIds()
    .flatMap((id) => {
      try {
        const { result: _result, error: _error, ...summary } = readJob(id)
        return [summary]
      } catch {
        return []
      }
    })
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
}

/** The job's own exit code, so callers branch the same way as on a foreground run; anything else (signals) → 1. */
export function jobExitCode(report: JobReport): number {
  if (report.status === "running") return EXIT_RUNNING
  const code = report.exit_code
  return code !== null && (code === 0 || KNOWN_EXIT_CODES.has(code)) ? code : EXIT_CODES.unknown
}

function startJob(command: Command): JobMeta {
  if (command.args.includes("-")) {
    throw new YaDiskError("usage", "A background job can't read stdin", { hint: "Save the data to a file and upload that" })
  }
  const { argv: rest, env: credentials } = extractCredentials(process.argv.slice(2).filter((arg) => arg !== "--detach"))
  // In front: appended, it would land after a `--` and turn into a positional argument.
  const argv = rest.includes("--json") ? rest : ["--json", ...rest]
  pruneJobs()

  const id = crypto.randomUUID().slice(0, 8)
  const dir = jobDir(id)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const child = Bun.spawn([process.execPath, Bun.main, ...argv], {
    cwd: process.cwd(),
    env: { ...process.env, ...credentials, [JOB_ENV]: dir },
    stdio: ["ignore", Bun.file(join(dir, "stdout")), Bun.file(logPath(id))],
    detached: true,
  })
  child.unref()

  const meta: JobMeta = {
    id,
    command: commandPath(command),
    argv,
    cwd: process.cwd(),
    pid: child.pid,
    started_at: new Date().toISOString(),
  }
  writeFileSync(join(dir, "job.json"), JSON.stringify(meta))
  return meta
}

function pruneJobs(): void {
  const cutoff = Date.now() - KEEP_FINISHED_MS
  for (const id of jobIds()) {
    try {
      const job = readJob(id)
      const endedAt = Date.parse(job.finished_at ?? job.started_at)
      if (job.status !== "running" && endedAt < cutoff) rmSync(jobDir(id), { recursive: true, force: true })
    } catch {}
  }
}

function jobIds(): string[] {
  try {
    return readdirSync(JOBS_DIR)
  } catch {
    return []
  }
}

function jobDir(id: string): string {
  return join(JOBS_DIR, id)
}

function logPath(id: string): string {
  return join(jobDir(id), "stderr")
}

// "public download", not just "download".
function commandPath(command: Command): string {
  const names: string[] = []
  for (let c: Command | null = command; c?.parent; c = c.parent) names.unshift(c.name())
  return names.join(" ")
}

/** Moves `--token x` / `--token=x` (and username/password) out of argv into env vars of the same precedence. */
function extractCredentials(args: string[]): { argv: string[]; env: Record<string, string> } {
  const argv: string[] = []
  const env: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--") {
      argv.push(...args.slice(i))
      break
    }
    const eq = arg.indexOf("=")
    const flag = eq > 0 ? arg.slice(0, eq) : arg
    const envName = CREDENTIAL_FLAGS[flag]
    if (!envName) {
      argv.push(arg)
      continue
    }
    env[envName] = eq > 0 ? arg.slice(eq + 1) : (args[++i] ?? "")
  }
  return { argv, env }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as { code?: string }).code === "EPERM"
  }
}

function lastLine(path: string): string | undefined {
  try {
    return readFileSync(path, "utf-8").trimEnd().split("\n").pop() || undefined
  } catch {
    return undefined
  }
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T
  } catch {
    return undefined
  }
}

function jobError(message: string, hint: string) {
  return { code: "unknown", message, hint, status: null }
}
