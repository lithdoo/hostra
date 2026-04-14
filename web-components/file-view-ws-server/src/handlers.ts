import type { JsonRpcHandlerMap } from './jsonrpc.js';

export function createHandlers(): JsonRpcHandlerMap {
  return {
    'rpc.ping': () => ({ ok: true }),
  };
}
