import { YaDiskError } from "@vforsh/yadisk"

// One shared stdin reader for all prompts: separate readline instances on piped stdin each buffer ahead
// and swallow the lines meant for the next prompt. Processing per char also handles pasted multi-char chunks.
const lines: string[] = []
const waiters: (() => void)[] = []
let current = ""
let lastWasCR = false
let inEscape = false
let ended = false
let listening = false

function wake(): void {
  while (waiters.length) waiters.shift()!()
}

function onData(chunk: Buffer): void {
  for (const c of chunk.toString()) {
    // Swallow ANSI escape sequences (arrow keys etc.): ESC [ … final letter.
    if (inEscape) {
      if (/[A-Za-z~]/.test(c)) inEscape = false
      continue
    }
    if (c === "\x1b") {
      inEscape = true
      continue
    }
    if (c === "\n" && lastWasCR) {
      lastWasCR = false
      continue
    }
    lastWasCR = c === "\r"
    if (c === "\n" || c === "\r") {
      lines.push(current.trim())
      current = ""
    } else if (c === "\x7f" || c === "\b") {
      current = current.slice(0, -1)
    } else if (c === "\x03") {
      process.stdin.setRawMode?.(false)
      process.exit(130)
    } else if (c === "\x04") {
      if (!current) return onEnd() // Ctrl-D on an empty line = EOF, as in cooked mode
    } else if (c >= " ") {
      current += c
    }
  }
  wake()
}

function onEnd(): void {
  if (current) lines.push(current.trim())
  current = ""
  ended = true
  wake()
}

async function readLine(): Promise<string | undefined> {
  if (!listening) {
    listening = true
    process.stdin.on("data", onData)
    process.stdin.on("end", onEnd)
  }
  process.stdin.resume()
  while (!lines.length && !ended) await new Promise<void>((resolve) => waiters.push(resolve))
  process.stdin.pause()
  return lines.shift()
}

// Prompts go to stderr so --json stdout stays parseable.
export async function prompt(message: string, what: string): Promise<string> {
  process.stderr.write(message)
  return requireInput(await readLine(), what)
}

export async function promptSecret(message: string, what: string): Promise<string> {
  process.stderr.write(message)
  process.stdin.setRawMode?.(true)
  try {
    return requireInput(await readLine(), what)
  } finally {
    process.stdin.setRawMode?.(false)
    process.stderr.write("\n")
  }
}

function requireInput(value: string | undefined, what: string): string {
  if (value) return value
  throw new YaDiskError("usage", `No ${what} provided${value === undefined ? " (stdin closed)" : ""}`, {
    hint: "Run interactively, pipe one value per line, or use env vars (YADISK_USERNAME/YADISK_PASSWORD/YADISK_TOKEN)",
  })
}
