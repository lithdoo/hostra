import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { readFileInRangeTool, FileTooLargeError } from '../dist/index.js'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'a-tools-agent-'))
}

test('readFileInRangeTool: name, description, parameters', () => {
  assert.equal(readFileInRangeTool.name, 'read_file')
  assert.ok(readFileInRangeTool.description.length > 0)
  assert.equal(
    (readFileInRangeTool.parameters as { type: string }).type,
    'object',
  )
  const req = (readFileInRangeTool.parameters as { required?: unknown[] })
    .required
  assert.ok(Array.isArray(req))
})

test('readFileInRangeTool.execute: reads file_path + offset + limit', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 't.txt')
  fs.writeFileSync(fp, 'a\nb\nc\n', 'utf8')
  const r = (await readFileInRangeTool.execute({
    file_path: fp,
    offset: 1,
    limit: 1,
  })) as { content: string; lineCount: number }
  assert.equal(r.content, 'b')
  assert.equal(r.lineCount, 1)
  fs.rmSync(dir, { recursive: true })
})

test('readFileInRangeTool.execute: camelCase filePath accepted', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'x.txt')
  fs.writeFileSync(fp, 'ok\n', 'utf8')
  const r = (await readFileInRangeTool.execute({ filePath: fp })) as {
    content: string
  }
  assert.equal(r.content, 'ok\n')
  fs.rmSync(dir, { recursive: true })
})

test('readFileInRangeTool.execute: rejects when args is null', async () => {
  await assert.rejects(
    () => readFileInRangeTool.execute(null),
    (e: unknown) =>
      e instanceof Error && e.message.includes('Tool args must be a JSON object'),
  )
})

test('readFileInRangeTool.execute: rejects when args is an array', async () => {
  await assert.rejects(
    () => readFileInRangeTool.execute([1, 2]),
    (e: unknown) =>
      e instanceof Error && e.message.includes('Tool args must be a JSON object'),
  )
})

test('readFileInRangeTool.execute: rejects when file path missing', async () => {
  await assert.rejects(
    () => readFileInRangeTool.execute({}),
    (e: unknown) =>
      e instanceof Error && e.message.includes('Missing file_path'),
  )
  await assert.rejects(
    () => readFileInRangeTool.execute({ file_path: '' }),
    (e: unknown) =>
      e instanceof Error && e.message.includes('Missing file_path'),
  )
})

test('readFileInRangeTool.execute: negative offset or limit', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'n.txt')
  fs.writeFileSync(fp, 'a\n', 'utf8')
  await assert.rejects(
    () => readFileInRangeTool.execute({ file_path: fp, offset: -1 }),
    (e: unknown) =>
      e instanceof Error &&
      e.message.includes('offset and limit must be non-negative'),
  )
  await assert.rejects(
    () => readFileInRangeTool.execute({ file_path: fp, limit: -1 }),
    (e: unknown) =>
      e instanceof Error &&
      e.message.includes('offset and limit must be non-negative'),
  )
  fs.rmSync(dir, { recursive: true })
})

test('readFileInRangeTool.execute: invalid number property', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'n.txt')
  fs.writeFileSync(fp, 'a\n', 'utf8')
  await assert.rejects(
    () => readFileInRangeTool.execute({ file_path: fp, offset: {} }),
    (e: unknown) =>
      e instanceof Error && e.message.includes('Invalid number property: offset'),
  )
  await assert.rejects(
    () => readFileInRangeTool.execute({ file_path: fp, offset: 'nope' }),
    (e: unknown) =>
      e instanceof Error && e.message.includes('Invalid number property: offset'),
  )
  fs.rmSync(dir, { recursive: true })
})

test('readFileInRangeTool.execute: invalid boolean property', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'b.txt')
  fs.writeFileSync(fp, 'a\n', 'utf8')
  await assert.rejects(
    () =>
      readFileInRangeTool.execute({
        file_path: fp,
        truncate_on_byte_limit: 'yes',
      }),
    (e: unknown) =>
      e instanceof Error &&
      e.message.includes('Invalid boolean property: truncate_on_byte_limit'),
  )
  fs.rmSync(dir, { recursive: true })
})

test('readFileInRangeTool.execute: numeric string offset matches number', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 's.txt')
  fs.writeFileSync(fp, 'a\nb\nc\n', 'utf8')
  const r1 = (await readFileInRangeTool.execute({
    file_path: fp,
    offset: 1,
    limit: 1,
  })) as { content: string; lineCount: number }
  const r2 = (await readFileInRangeTool.execute({
    file_path: fp,
    offset: '1',
    limit: 1,
  })) as { content: string; lineCount: number }
  assert.equal(r1.content, r2.content)
  assert.equal(r1.lineCount, r2.lineCount)
  fs.rmSync(dir, { recursive: true })
})

test('readFileInRangeTool.execute: FileTooLargeError from max_bytes', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'big.txt')
  fs.writeFileSync(fp, 'x'.repeat(200), 'utf8')
  await assert.rejects(
    () =>
      readFileInRangeTool.execute({
        file_path: fp,
        max_bytes: 100,
      }),
    (e: unknown) => e instanceof FileTooLargeError,
  )
  fs.rmSync(dir, { recursive: true })
})

test('readFileInRangeTool.execute: maxBytes + truncateOnByteLimit camelCase', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'tr.txt')
  fs.writeFileSync(fp, 'short\nlines\nhere\n', 'utf8')
  const r = (await readFileInRangeTool.execute(
    {
      filePath: fp,
      maxBytes: 12,
      truncateOnByteLimit: true,
    },
    {},
  )) as { truncatedByBytes: boolean; content: string }
  assert.equal(r.truncatedByBytes, true)
  assert.ok(r.content.length > 0)
  fs.rmSync(dir, { recursive: true })
})

test('readFileInRangeTool.execute: AbortSignal already aborted', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'ab.txt')
  fs.writeFileSync(fp, 'a\n', 'utf8')
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(
    () => readFileInRangeTool.execute({ file_path: fp }, { signal: ac.signal }),
    (e: unknown) =>
      !!e && ((e as Error).name === 'AbortError' || (e as { code?: string }).code === 'ABORT_ERR'),
  )
  fs.rmSync(dir, { recursive: true })
})
