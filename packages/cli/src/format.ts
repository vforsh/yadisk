import type { DiskInfo, Resource, TrashItem } from "@vforsh/yadisk"
import type { JobReport } from "./jobs"

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

  const lines = disk.login ? [`Login:   ${disk.login}`] : []
  lines.push(`Total:   ${total}`, `Used:    ${used} (${pct}%)`, `Free:    ${free}`)
  if (disk.trash_bytes !== undefined) lines.push(`Trash:   ${formatSize(disk.trash_bytes)}`)
  if (disk.max_file_size !== undefined) lines.push(`Max file: ${formatSize(disk.max_file_size)}`)
  return lines.join("\n")
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
  if (resource.md5) lines.push(`MD5:      ${resource.md5}`)
  if (resource.sha256) lines.push(`SHA256:   ${resource.sha256}`)
  if (resource.public_url) lines.push(`Public:   ${resource.public_url}`)
  return lines.join("\n")
}

export function formatPathList(items: Resource[]): string {
  if (items.length === 0) return "No matches."
  return renderTable(items, [
    { header: "Size", value: (r) => (r.size !== undefined ? formatSize(r.size) : "dir"), width: 10 },
    { header: "Modified", value: (r) => formatDate(r.modified), width: 19 },
    { header: "Path", value: "path" },
  ])
}

export function formatTrashList(items: TrashItem[]): string {
  if (items.length === 0) return "Trash is empty."
  return renderTable(items, [
    { header: "Deleted", value: (r) => formatDate(r.deleted), width: 19 },
    { header: "Size", value: (r) => (r.size !== undefined ? formatSize(r.size) : "dir"), width: 10 },
    { header: "Origin", value: "origin_path" },
    { header: "Trash path", value: "path" },
  ])
}

export function formatJob(job: JobReport): string {
  const exit = job.exit_code === null ? "" : `, exit ${job.exit_code}`
  const lines = [`Job ${job.job_id} (${job.command}): ${job.status}${exit}`, `Started:  ${formatDate(job.started_at)}`]
  if (job.finished_at) lines.push(`Finished: ${formatDate(job.finished_at)}`)
  if (job.progress) lines.push(`Progress: ${job.progress}`)
  lines.push(`Log:      ${job.log}`)
  if (job.result !== undefined) lines.push(`Result:\n${JSON.stringify(job.result, null, 2)}`)
  const error = job.error as { message?: string; hint?: string | null } | undefined
  if (error?.message) lines.push(`Error:    ${error.message}`)
  if (error?.hint) lines.push(`Hint:     ${error.hint}`)
  return lines.join("\n")
}

export function formatJobList(jobs: JobReport[]): string {
  if (jobs.length === 0) return "No jobs."
  return renderTable(jobs, [
    { header: "Id", value: "job_id", width: 8 },
    { header: "Status", value: "status", width: 7 },
    { header: "Exit", value: (j) => (j.exit_code === null ? "-" : String(j.exit_code)), width: 4 },
    { header: "Started", value: (j) => formatDate(j.started_at), width: 19 },
    { header: "Command line", value: (j) => j.argv.join(" ") },
  ])
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-"
  try {
    return new Date(dateStr).toISOString().replace("T", " ").slice(0, 19)
  } catch {
    return dateStr.slice(0, 19)
  }
}
