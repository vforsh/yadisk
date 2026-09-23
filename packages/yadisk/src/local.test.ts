import { expect, test } from "bun:test"
import { mkdtemp, readdir } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { resolveLocalTarget, writeLocal } from "./local"

test("streams to the target and leaves no .part file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yadisk-"))
  const target = join(dir, "nested", "out.bin")
  const size = await writeLocal(target, new Response(new Uint8Array(70_000)))
  expect(size).toBe(70_000)
  expect(await Bun.file(target).size).toBe(70_000)
  expect(await readdir(join(dir, "nested"))).toEqual(["out.bin"])
})

test("a failed stream removes the partial file and keeps the old target", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yadisk-"))
  const target = join(dir, "out.bin")
  await Bun.write(target, "old")
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(10))
      controller.error(new Error("connection reset"))
    },
  })
  await expect(writeLocal(target, new Response(body))).rejects.toMatchObject({ code: "network" })
  expect(await Bun.file(target).text()).toBe("old")
  expect(await readdir(dir)).toEqual(["out.bin"])
})

test("resolves folder destinations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yadisk-"))
  expect(await resolveLocalTarget(dir, "a.zip")).toBe(join(dir, "a.zip"))
  expect(await resolveLocalTarget(`${dir}/new/`, "a.zip")).toBe(join(dir, "new", "a.zip"))
  expect(await resolveLocalTarget(join(dir, "b.bin"), "a.zip")).toBe(join(dir, "b.bin"))
})
