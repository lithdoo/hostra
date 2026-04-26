import type { FileReadStateMap } from '../libs/file-read-state'

/**
 * Minimal tool shape for host agent runtimes: consumers import each `*Tool`
 * and register with their own registry (OpenAI / Anthropic / custom).
 */
export type JsonObjectSchema = Record<string, unknown>

export type AgentToolExecuteOptions = {
  signal?: AbortSignal
  /** Required by the Write tool: host must pass the same map as for read_file. */
  readFileState?: FileReadStateMap
  /** Used to resolve relative `file_path` in read/write tools. */
  cwd?: string
}

export type AgentToolDefinition<TResult = unknown> = {
  /** Stable id for the provider (e.g. `read_file`). */
  name: string
  /** Shown to the model in tool definitions. */
  description: string
  /**
   * JSON Schema for `type: "object"` tool parameters (OpenAI/Anthropic-compatible
   * subset). Keep `additionalProperties: false` when the runtime supports it.
   */
  parameters: JsonObjectSchema
  /**
   * `args` is the parsed JSON the model sent; validate then call implementation.
   */
  execute: (args: unknown, options?: AgentToolExecuteOptions) => Promise<TResult>
}