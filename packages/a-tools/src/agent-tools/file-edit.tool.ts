import { editTextFile, type EditTextFileResult } from '../libs/edit-text-file'
import type { AgentToolDefinition, AgentToolExecuteOptions } from './types'

const DESCRIPTION = `Edit a file by replacing an exact string with another. For **existing** files, the file must have been read first (full read, not a line slice) and the same readFileState map must be passed. To create a new file, set old_string to the empty string. Path can be absolute, relative to cwd, or use ~ for home.`

const PARAMETERS: AgentToolDefinition['parameters'] = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file_path: {
      type: 'string',
      description: 'Path to the file to edit (absolute, relative, or ~).',
    },
    old_string: {
      type: 'string',
      description: 'Text to find and replace. Use empty string to create a new file.',
    },
    new_string: { type: 'string', description: 'Replacement text.' },
    replace_all: {
      type: 'boolean',
      description: 'If true, replace every occurrence of old_string.',
    },
  },
  required: ['file_path', 'old_string', 'new_string'],
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool args must be a JSON object')
  }
  return value as Record<string, unknown>
}

function parseBoolean(v: unknown): boolean | undefined {
  if (v === undefined) {
    return undefined
  }
  if (typeof v === 'boolean') {
    return v
  }
  if (v === 'true') {
    return true
  }
  if (v === 'false') {
    return false
  }
  return undefined
}

/**
 * Claude `Edit` tool — string replace with read-state guards.
 */
export const fileEditTool: AgentToolDefinition<EditTextFileResult> = {
  name: 'Edit',
  description: DESCRIPTION,
  parameters: PARAMETERS,
  async execute(
    args: unknown,
    options?: AgentToolExecuteOptions,
  ): Promise<EditTextFileResult> {
    const o = expectRecord(args)
    const filePath =
      (typeof o.file_path === 'string' && o.file_path) ||
      (typeof o.filePath === 'string' && o.filePath) ||
      ''
    if (!filePath) {
      throw new Error('Missing file_path (or filePath)')
    }
    if (typeof o.old_string !== 'string') {
      throw new Error('Missing old_string')
    }
    if (typeof o.new_string !== 'string') {
      throw new Error('Missing new_string')
    }
    const replaceAll = parseBoolean(o.replace_all) ?? false

    const readFileState = options?.readFileState
    if (!readFileState) {
      throw new Error(
        'fileEditTool.execute requires options.readFileState (shared with read_file results)',
      )
    }

    return editTextFile(
      filePath,
      {
        old_string: o.old_string,
        new_string: o.new_string,
        replace_all: replaceAll,
      },
      {
        readFileState,
        cwd: options?.cwd,
        signal: options?.signal,
      },
    )
  },
}
