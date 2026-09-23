import { fetchWithTimeout } from "./http"

const API_URL = "https://cloud-api.yandex.net/v1/disk"
const OPERATION_POLL_MS = 1000

interface Link {
  href: string
  method: string
  operation_id?: string
}

interface ApiError {
  message?: string
  description?: string
}

// Two-step REST upload: request an uploader URL, then PUT the body there (no auth header).
// Uploader hosts hold the response ~8s/MB vs ~60s/MB on WebDAV, and scale with parallel uploads.
export async function restUpload(
  token: string,
  remotePath: string,
  body: BodyInit,
  timeoutMs?: number
): Promise<void> {
  const link = await getUploadLink(token, remotePath, timeoutMs)

  const response = await fetchWithTimeout(link.href, { method: link.method, body }, timeoutMs)
  if (response.status === 202 && link.operation_id) {
    await waitForOperation(token, link.operation_id, timeoutMs)
    return
  }
  if (!response.ok) {
    throw new Error(`Upload error: ${response.status} ${response.statusText}`)
  }
}

// Requests an upload link without uploading anything: validates the token and its `disk.write` scope.
export async function verifyUploadToken(token: string, timeoutMs?: number): Promise<void> {
  await getUploadLink(token, `/.yadisk-token-check-${Date.now()}`, timeoutMs)
}

async function getUploadLink(token: string, remotePath: string, timeoutMs?: number): Promise<Link> {
  const params = new URLSearchParams({ path: remotePath, overwrite: "true" })
  return apiGet<Link>(token, `/resources/upload?${params}`, timeoutMs)
}

async function waitForOperation(token: string, operationId: string, timeoutMs?: number): Promise<void> {
  while (true) {
    const { status } = await apiGet<{ status: string }>(token, `/operations/${operationId}`, timeoutMs)
    if (status === "success") return
    if (status === "failed") throw new Error(`Upload error: operation ${operationId} failed`)
    await Bun.sleep(OPERATION_POLL_MS)
  }
}

async function apiGet<T>(token: string, endpoint: string, timeoutMs?: number): Promise<T> {
  const response = await fetchWithTimeout(
    `${API_URL}${endpoint}`,
    { headers: { Authorization: `OAuth ${token}`, Accept: "application/json" } },
    timeoutMs
  )

  if (!response.ok) {
    let details = response.statusText
    try {
      const err = (await response.json()) as ApiError
      details = err.description || err.message || details
    } catch {}
    const hint = response.status === 401 ? " (OAuth token invalid or expired — run: yadisk auth --oauth)" : ""
    throw new Error(`REST API error: ${response.status} — ${details}${hint}`)
  }

  return (await response.json()) as T
}
