import { writeTextFile, type WriteTextFileResult } from '../libs/write-file'
import type { AgentToolDefinition, AgentToolExecuteOptions } from './types'

const DESCRIPTION = `Write a text file in full. For **existing** files, the file must have been read first (full read, not a line slice) and the same readFileState map must be passed in execute options. New files can be created without a prior read. Path can be absolute, relative to cwd, or use ~ for home.`

const PARAMETERS: AgentToolDefinition['parameters'] = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file_path: {
      type: 'string',
      description: 'Path to the file to write (absolute, relative, or ~).',
    },
    content: { type: 'string', description: 'Full new file content.' },
  },
  required: ['file_path', 'content'],
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool args must be a JSON object')
  }
  return value as Record<string, unknown>
}

/**
 * Claude `Write` tool — full-file write with read-state guards. Register with your agent;
 * call `execute(args, { readFileState, cwd, signal })` with the same `readFileState` you use for reads.
 */
export const fileWriteTool: AgentToolDefinition<WriteTextFileResult> = {
  name: 'Write',
  description: DESCRIPTION,
  parameters: PARAMETERS,
  async execute(
    args: unknown,
    options?: AgentToolExecuteOptions,
  ): Promise<WriteTextFileResult> {
    const o = expectRecord(args)
    const filePath =
      (typeof o.file_path === 'string' && o.file_path) ||
      (typeof o.filePath === 'string' && o.filePath) ||
      ''
    if (!filePath) {
      throw new Error('Missing file_path (or filePath)')
    }
    const content = typeof o.content === 'string' ? o.content : undefined
    if (content === undefined) {
      throw new Error('Missing content')
    }
    const readFileState = options?.readFileState
    if (!readFileState) {
      throw new Error(
        'fileWriteTool.execute requires options.readFileState (shared with read_file results)',
      )
    }
    return writeTextFile(filePath, content, {
      readFileState,
      cwd: options?.cwd,
      signal: options?.signal,
    })
  },
}
