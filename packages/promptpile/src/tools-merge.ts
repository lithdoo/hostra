import { searchToolsOpenAiDefinitions } from '@agent-tool-lite/search';
import type { ToolDefinition } from './types';

function toolFunctionName(t: ToolDefinition): string | undefined {
  const fn = (t as { function?: unknown }).function;
  if (!fn || typeof fn !== 'object' || Array.isArray(fn)) {
    return undefined;
  }
  const name = (fn as { name?: unknown }).name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

/** Appends `@agent-tool-lite/search` Glob + Grep definitions when the same `function.name` is not already present. */
export function mergeSearchToolsPack(tools: ToolDefinition[] | undefined): ToolDefinition[] | undefined {
  const extra = searchToolsOpenAiDefinitions() as ToolDefinition[];
  const base = tools ?? [];
  const existing = new Set(
    base.map(toolFunctionName).filter((n): n is string => Boolean(n)),
  );
  const appended = extra.filter(def => {
    const n = toolFunctionName(def);
    return n ? !existing.has(n) : false;
  });
  const merged = [...base, ...appended];
  return merged.length > 0 ? merged : undefined;
}
