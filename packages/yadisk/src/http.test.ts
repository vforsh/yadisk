import { expect, test } from "bun:test"
import { YaDiskError, codeForStatus } from "./errors"
import { transportError, withRetry } from "./http"

const instant = (code: YaDiskError["code"]) => new YaDiskError(code, code, { retryAfterMs: 0 })

test("retries retryable errors up to the limit", async () => {
  let calls = 0
  const result = await withRetry(
    async () => {
      if (++calls < 3) throw instant("network")
      return "ok"
    },
    { retries: 2 }
  )
  expect(result).toBe("ok")
  expect(calls).toBe(3)
})

test("gives up after the retry budget", async () => {
  let calls = 0
  const run = withRetry(async () => {
    calls++
    throw instant("server")
  }, { retries: 1 })
  await expect(run).rejects.toMatchObject({ code: "server" })
  expect(calls).toBe(2)
})

test("does not retry timeouts or client errors", async () => {
  for (const code of ["timeout", "not_found", "conflict"] as const) {
    let calls = 0
    const run = withRetry(async () => {
      calls++
      throw instant(code)
    }, { retries: 3 })
    await expect(run).rejects.toMatchObject({ code })
    expect(calls).toBe(1)
  }
})

test("fails fast when Retry-After exceeds the cap", async () => {
  let calls = 0
  const run = withRetry(async () => {
    calls++
    throw new YaDiskError("rate_limited", "429", { retryAfterMs: 3_600_000 })
  }, { retries: 2 })
  await expect(run).rejects.toMatchObject({ code: "rate_limited", hint: "Server asked to retry after 3600s" })
  expect(calls).toBe(1)
})

test("maps HTTP statuses to error codes", () => {
  expect(codeForStatus(401)).toBe("auth")
  expect(codeForStatus(403)).toBe("forbidden")
  expect(codeForStatus(404)).toBe("not_found")
  expect(codeForStatus(409)).toBe("conflict")
  expect(codeForStatus(412)).toBe("conflict")
  expect(codeForStatus(429)).toBe("rate_limited")
  expect(codeForStatus(503)).toBe("server")
  expect(codeForStatus(507)).toBe("quota")
})

test("classifies transport failures", () => {
  const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" })
  expect(transportError(timeout, 5000)).toMatchObject({ code: "timeout", message: "Request timed out after 5s" })
  expect(transportError(new Error("Unable to connect"))).toMatchObject({ code: "network", retryable: true })
})

test("local I/O errors are not retryable network errors", () => {
  const eacces = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES", syscall: "open" })
  expect(transportError(eacces)).toMatchObject({ code: "usage", retryable: false })
})

test("JSON form always carries hint and status keys", () => {
  expect(new YaDiskError("network", "x").toJSON()).toEqual({ code: "network", message: "x", hint: null, status: null })
})
