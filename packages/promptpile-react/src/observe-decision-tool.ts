import fs from 'fs';

/** 与 `parse-observe-calls.ts`、README 约定一致；模型须调用此工具给出 `decision`。 */
export const OBSERVE_DECISION_TOOL_NAME = 'react_observe_decision';

/**
 * 写入单行 `.tools.jsonl`，条目为 **扁平** `{ name, description?, parameters? }`（与 `promptpile` `tools-loader` 一致）；
 * loader 会再包装为发给 API 的 OpenAI `tools[]` 元素。
 */
export function writeObserveToolsJsonl(absPath: string): void {
  const tool = {
    name: OBSERVE_DECISION_TOOL_NAME,
    description:
      'After observing the current context, set whether the outer ReAct loop should continue. You must call this once.',
    parameters: {
      type: 'object',
      properties: {
        decision: {
          type: 'boolean',
          description: 'true to continue the loop, false to stop'
        }
      },
      required: ['decision']
    }
  };
  fs.writeFileSync(absPath, `${JSON.stringify(tool)}\n`, 'utf8');
}
