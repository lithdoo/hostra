import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { fileEditTool, readFileInRangeTool } from '../dist/index.js'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'a-tools-fet-'))
}

test('fileEditTool: name and requires readFileState', async () => {
  assert.equal(fileEditTool.name, 'Edit')
  const dir = tmpDir()
  const fp = path.join(dir, 'n.txt')
  await assert.rejects(
    () =>
      fileEditTool.execute(
        { file_path: fp, old_string: 'a', new_string: 'b' },
        {},
      ),
    (e: unknown) =>
      e instanceof Error && e.message.includes('requires options.readFileState'),
  )
  fs.rmSync(dir, { recursive: true })
})

test('fileEditTool: read + edit with shared readFileState', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'a.txt')
  fs.writeFileSync(fp, 'old\n', 'utf8')
  const readFileState = new Map()
  const cwd = dir
  await readFileInRangeTool.execute(
    { file_path: 'a.txt' },
    { readFileState, cwd },
  )
  const w = await fileEditTool.execute(
    { file_path: 'a.txt', old_string: 'old', new_string: 'new' },
    { readFileState, cwd },
  )
  assert.equal(w.kind, 'update')
  assert.equal(fs.readFileSync(fp, 'utf8'), 'new\n')
  const keys = [...readFileState.keys()]
  assert.equal(readFileState.get(keys[0])!.content, 'new\n')
  fs.rmSync(dir, { recursive: true })
})

test('fileEditTool: missing file_path or strings', async () => {
  const readFileState = new Map()
  await assert.rejects(
    () => fileEditTool.execute({ old_string: 'a', new_string: 'b' }, { readFileState }),
    /Missing file_path/,
  )
  const dir = tmpDir()
  const fp = path.join(dir, 'x.txt')
  await assert.rejects(
    () => fileEditTool.execute({ file_path: fp, new_string: 'b' }, { readFileState }),
    /Missing old_string/,
  )
  await assert.rejects(
    () => fileEditTool.execute({ file_path: fp, old_string: 'a' }, { readFileState }),
    /Missing new_string/,
  )
  fs.rmSync(dir, { recursive: true })
})
