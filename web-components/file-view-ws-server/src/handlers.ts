import type { JsonRpcHandlerMap } from './jsonrpc.js';
import type { IFVWsConnection } from './connection.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseTargetDirFileUrl(params: unknown): string {
  if (!isObject(params)) {
    throw new Error('Invalid params: expected object');
  }
  const raw = params.targetDirFileUrl;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('Invalid params: targetDirFileUrl must be a non-empty string');
  }
  return raw;
}

export function createHandlers(connection: IFVWsConnection): JsonRpcHandlerMap {
  return {
    'rpc.ping': () => ({ ok: true }),
    'fv.changeTargetDir': (params) => {
      const targetDirFileUrl = parseTargetDirFileUrl(params);
      return connection.changeTargetDir(targetDirFileUrl);
    },
    'fv.clearTargetDir': () => connection.clearTargetDir(),
    'fv.getState': () => connection.getState(),
  };
}
