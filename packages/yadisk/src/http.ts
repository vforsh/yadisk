// Bun's fetch accepts `timeout: false` to disable its implicit 5-min idle timeout, but bun-types doesn't declare it.
type BunFetchInit = RequestInit & { timeout?: boolean }

// Yandex holds the upload response for ~60s/MB (WebDAV throttling), so any idle timeout would kill large uploads.
export function fetchWithTimeout(url: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
  const fetchInit: BunFetchInit = { ...init, timeout: false }
  if (timeoutMs) fetchInit.signal = AbortSignal.timeout(timeoutMs)
  return fetch(url, fetchInit)
}
