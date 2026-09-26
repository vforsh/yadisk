import type { YaDiskError } from "@vforsh/yadisk"
import { asYaDiskError } from "./output"

export type Settled<T> = { ok: true; value: T } | { ok: false; error: YaDiskError }

/** Runs `fn` over `items`, at most `concurrency` at a time, collecting every outcome in input order. */
export async function mapSettled<I, T>(items: readonly I[], concurrency: number, fn: (item: I) => Promise<T>): Promise<Settled<T>[]> {
  const results: Settled<T>[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      try {
        results[i] = { ok: true, value: await fn(items[i]) }
      } catch (err) {
        results[i] = { ok: false, error: asYaDiskError(err) }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

export function failures<T>(results: Settled<T>[]): YaDiskError[] {
  return results.flatMap((r) => (r.ok ? [] : [r.error]))
}
