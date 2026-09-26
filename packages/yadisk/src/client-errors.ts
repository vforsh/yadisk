import { YaDiskError } from "./errors"
import { parentPath } from "./path"

// Explanations YaDiskClient attaches when a raw 404/409 doesn't say which side of an operation is wrong.

export function sourceNotFound(source: string, status?: number): YaDiskError {
  return new YaDiskError("not_found", `Source not found: ${source}`, { status, hint: `Check the path: yadisk ls ${parentPath(source)}` })
}

export function destinationExists(destination: string, status?: number): YaDiskError {
  return new YaDiskError("already_exists", `Destination already exists: ${destination}`, {
    status,
    hint: "Pass --overwrite to replace that file",
  })
}

export function folderTarget(path: string, verb: string, status?: number): YaDiskError {
  return new YaDiskError("is_a_directory", `Destination is an existing folder: ${path}`, {
    status,
    hint: `To ${verb} into it, add a trailing slash: ${path}/`,
  })
}

export function missingParent(parent: string, status?: number): YaDiskError {
  return new YaDiskError("conflict", `Parent folder does not exist: ${parent}`, {
    status,
    hint: `Create it first: yadisk mkdir -p ${parent}`,
  })
}
