import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { fileWriteTool, readFileInRangeTool } from '../dist/index.js'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'a-tools-fwt-'))
}

test('fileWriteTool: name and requires readFileState', async () => {
  assert.equal(fileWriteTool.name, 'Write')
  const dir = tmpDir()
  const fp = path.join(dir, 'n.txt')
  await assert.rejects(
    () => fileWriteTool.execute({ file_path: fp, content: 'a' }, {}),
    (e: unknown) =>
      e instanceof Error && e.message.includes('requires options.readFileState'),
  )
  fs.rmSync(dir, { recursive: true })
})

test('fileWriteTool: read + write with shared readFileState', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'a.txt')
  fs.writeFileSync(fp, 'old\n', 'utf8')
  const readFileState = new Map()
  const cwd = dir
  await readFileInRangeTool.execute(
    { file_path: 'a.txt' },
    { readFileState, cwd },
  )
  const w = (await fileWriteTool.execute(
    { file_path: 'a.txt', content: 'new\n' },
    { readFileState, cwd },
  )) as { kind: string; previousContent: string }
  assert.equal(w.kind, 'update')
  assert.equal(w.previousContent, 'old\n')
  assert.equal(fs.readFileSync(fp, 'utf8'), 'new\n')
  const keys = [...readFileState.keys()]
  assert.equal(keys.length, 1)
  assert.equal(readFileState.get(keys[0])!.content, 'new\n')
  fs.rmSync(dir, { recursive: true })
})

test('fileWriteTool: missing file_path or content', async () => {
  const readFileState = new Map()
  await assert.rejects(
    () => fileWriteTool.execute({ content: 'a' }, { readFileState }),
    /Missing file_path/,
  )
  const dir = tmpDir()
  const fp = path.join(dir, 'x.txt')
  await assert.rejects(
    () => fileWriteTool.execute({ file_path: fp }, { readFileState }),
    /Missing content/,
  )
  fs.rmSync(dir, { recursive: true })
})
