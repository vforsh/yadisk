import ora from "ora"
import { isJson, note } from "./output"

// Agents run without a TTY and often under a ~2 min tool timeout: an invisible spinner looks like a hang.
// Without a TTY, print the label once, then a heartbeat line so long transfers stay observable.
const HEARTBEAT_MS = 15_000

interface Task {
  stop(): void
}

export interface TaskOptions {
  estimateSeconds?: number
  /** Live detail (e.g. "1200 scanned") appended to spinner and heartbeat lines. */
  status?: () => string
}

/** Runs `fn` with a spinner (TTY) or label + heartbeat lines (no TTY) on stderr. */
export async function withTask<T>(label: string, fn: () => Promise<T>, options?: TaskOptions): Promise<T> {
  const task = startTask(label, options?.estimateSeconds, options?.status)
  try {
    return await fn()
  } finally {
    task.stop()
  }
}

function startTask(label: string, estimateSeconds?: number, status?: () => string): Task {
  const estimate = estimateSeconds !== undefined ? ` — est ~${formatDuration(estimateSeconds)}` : ""
  const startedAt = Date.now()
  const elapsed = () => `${formatDuration((Date.now() - startedAt) / 1000)} elapsed${status ? `, ${status()}` : ""}`

  if (process.stderr.isTTY && !isJson()) {
    const spinner = ora(`${label}${estimate}`).start()
    const timer = setInterval(() => (spinner.text = `${label} — ${elapsed()}${estimate}`), 1000)
    return {
      stop: () => {
        clearInterval(timer)
        spinner.stop()
      },
    }
  }

  note(`${label}${estimate}`)
  const timer = setInterval(() => note(`… ${label}: ${elapsed()}${estimate}`), HEARTBEAT_MS)
  return { stop: () => clearInterval(timer) }
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return `${h}h${String(m).padStart(2, "0")}m`
  if (m) return `${m}m${String(s).padStart(2, "0")}s`
  return `${s}s`
}
