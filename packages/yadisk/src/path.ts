import { YaDiskError } from "./errors"

// Accepts "uploads/x", "/uploads/x/", "disk:/uploads//x" → "/uploads/x".
// Empty input is rejected rather than read as "/": an unset shell variable must never target the disk root.
export function normalizePath(path: string): string {
  const stripped = path.replace(/^disk:/, "")
  if (!stripped.trim()) {
    throw new YaDiskError("usage", `Empty path: ${JSON.stringify(path)}`, { hint: "Pass \"/\" explicitly for the disk root" })
  }
  // URL parsing collapses "." / ".." (WebDAV "/." would DELETE the root), so they are never passed through.
  if (stripped.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new YaDiskError("usage", `Relative segments are not supported: ${JSON.stringify(path)}`, {
      hint: "Use an absolute path without . or ..",
    })
  }
  const collapsed = `/${stripped}`.replace(/\/{2,}/g, "/")
  return collapsed.length > 1 ? collapsed.replace(/\/$/, "") : collapsed
}

export function basenamePath(path: string): string {
  return normalizePath(path).split("/").pop() ?? ""
}

export function refuseRoot(path: string, action: string): string {
  const normalized = normalizePath(path)
  if (normalized === "/") throw new YaDiskError("usage", `Refusing to ${action} the disk root`)
  return normalized
}

export function parentPath(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf("/")
  return index <= 0 ? "/" : normalized.slice(0, index)
}
