import { CommandTerminalElement } from './component/command-terminal.js';

const DEFAULT_TAG = 'command-terminal';

/**
 * Registers the custom element. Safe to call multiple times.
 */
export function defineCommandTerminalElement(
  tagName: string = DEFAULT_TAG,
): void {
  const ctor = CommandTerminalElement;
  if (customElements.get(tagName) === undefined) {
    customElements.define(tagName, ctor);
  }
}

export { CommandTerminalElement };
export {
  buildTerminalWebSocketUrl,
  type BuildTerminalWebSocketUrlOptions,
} from './terminal/build-terminal-ws-url.js';

defineCommandTerminalElement(DEFAULT_TAG);
