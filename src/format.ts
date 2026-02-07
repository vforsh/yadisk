import type { DiskInfo, Resource } from "./types"

// --- Size Formatting ---

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"]

export function formatSize(bytes: number): string {
  let i = 0
  let size = bytes
  while (size >= 1024 && i < SIZE_UNITS.length - 1) {
    size /= 1024
    i++
  }
  return i === 0 ? `${size} ${SIZE_UNITS[i]}` : `${size.toFixed(1)} ${SIZE_UNITS[i]}`
}

// --- Table Renderer ---

interface Column<T> {
  header: string
  value: keyof T | ((item: T) => string)
  width?: number
}

function renderTable<T>(items: T[], columns: Column<T>[]): string {
  const widths = columns.map((col) => {
    const headerLen = col.header.length
    const maxDataLen = items.reduce((max, item) => {
      const val =
        typeof col.value === "function"
          ? col.value(item)
          : String(item[col.value] ?? "")
      return Math.max(max, val.length)
    }, 0)
    return col.width ?? Math.max(headerLen, maxDataLen)
  })

  const header = columns
    .map((col, i) => col.header.padEnd(widths[i]))
    .join("  ")
  const separator = widths.map((w) => "-".repeat(w)).join("  ")
  const rows = items.map((item) =>
    columns
      .map((col, i) => {
        const val =
          typeof col.value === "function"
            ? col.value(item)
            : String(item[col.value] ?? "")
        return val.padEnd(widths[i])
      })
      .join("  ")
  )

  return [header, separator, ...rows].join("\n")
}

// --- Formatters ---

export function formatDiskInfo(disk: DiskInfo): string {
  const total = formatSize(disk.total_space)
  const used = formatSize(disk.used_space)
  const free = formatSize(disk.total_space - disk.used_space)
  const trash = formatSize(disk.trash_size)
  const pct = ((disk.used_space / disk.total_space) * 100).toFixed(1)

  return [
    `User:    ${disk.user.display_name} (${disk.user.login})`,
    `Total:   ${total}`,
    `Used:    ${used} (${pct}%)`,
    `Free:    ${free}`,
    `Trash:   ${trash}`,
    `Plan:    ${disk.is_paid ? "paid" : "free"}`,
  ].join("\n")
}

export function formatResourceList(items: Resource[]): string {
  if (items.length === 0) return "Empty folder."
  return renderTable(items, [
    {
      header: "Type",
      value: (r) => (r.type === "dir" ? "dir" : r.mime_type ?? "file"),
      width: 6,
    },
    {
      header: "Size",
      value: (r) => (r.size !== undefined ? formatSize(r.size) : "-"),
      width: 10,
    },
    {
      header: "Modified",
      value: (r) => r.modified.replace("T", " ").slice(0, 19),
      width: 19,
    },
    { header: "Name", value: "name" },
  ])
}

export function formatResource(resource: Resource): string {
  const lines = [
    `Name:     ${resource.name}`,
    `Path:     ${resource.path}`,
    `Type:     ${resource.type}`,
  ]
  if (resource.size !== undefined) lines.push(`Size:     ${formatSize(resource.size)}`)
  if (resource.mime_type) lines.push(`MIME:     ${resource.mime_type}`)
  lines.push(`Created:  ${resource.created}`)
  lines.push(`Modified: ${resource.modified}`)
  if (resource.md5) lines.push(`MD5:      ${resource.md5}`)
  if (resource.sha256) lines.push(`SHA256:   ${resource.sha256}`)
  if (resource.public_url) lines.push(`Public:   ${resource.public_url}`)
  return lines.join("\n")
}

export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2)
}
