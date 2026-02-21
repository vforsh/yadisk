import type { DiskInfo, Resource } from "@vforsh/yadisk"

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
  const total = formatSize(disk.total_bytes)
  const used = formatSize(disk.used_bytes)
  const free = formatSize(disk.available_bytes)
  const pct = ((disk.used_bytes / disk.total_bytes) * 100).toFixed(1)

  return [
    `Total:   ${total}`,
    `Used:    ${used} (${pct}%)`,
    `Free:    ${free}`,
  ].join("\n")
}

export function formatResourceList(items: Resource[]): string {
  if (items.length === 0) return "Empty folder."
  return renderTable(items, [
    {
      header: "Type",
      value: (r) => (r.type === "dir" ? "dir" : r.content_type ?? "file"),
      width: 6,
    },
    {
      header: "Size",
      value: (r) => (r.size !== undefined ? formatSize(r.size) : "-"),
      width: 10,
    },
    {
      header: "Modified",
      value: (r) => formatDate(r.modified),
      width: 19,
    },
    { header: "Name", value: "name" },
  ])
}

export function formatResource(resource: Resource): string {
  const type = resource.content_type ?? resource.type
  const lines = [
    `Name:     ${resource.name}`,
    `Path:     ${resource.path}`,
    `Type:     ${type}`,
  ]
  if (resource.size !== undefined) lines.push(`Size:     ${formatSize(resource.size)}`)
  lines.push(`Created:  ${formatDate(resource.created)}`)
  lines.push(`Modified: ${formatDate(resource.modified)}`)
  if (resource.etag) lines.push(`ETag:     ${resource.etag}`)
  return lines.join("\n")
}

export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-"
  try {
    return new Date(dateStr).toISOString().replace("T", " ").slice(0, 19)
  } catch {
    return dateStr.slice(0, 19)
  }
}
