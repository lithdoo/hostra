import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandlers } from '../src/handlers.js';
import type { IFVState, IFVWsConnection } from '../src/connection.js';

function createMockConnection(state: IFVState): IFVWsConnection {
  return {
    targetDirFileUrl: undefined,
    async changeTargetDir(targetDirFileUrl: string): Promise<IFVState> {
      this.targetDirFileUrl = targetDirFileUrl;
      return state;
    },
    async clearTargetDir(): Promise<IFVState> {
      this.targetDirFileUrl = undefined;
      return { fileList: [], targetDir: undefined };
    },
    async getState(): Promise<IFVState> {
      return state;
    },
  };
}

test('fv.changeTargetDir validates params and calls connection', async () => {
  const state: IFVState = { fileList: [], targetDir: undefined };
  const conn = createMockConnection(state);
  const handlers = createHandlers(conn);

  await assert.rejects(
    async () => handlers['fv.changeTargetDir']?.(undefined, 1),
    /Invalid params: expected object/,
  );

  await assert.rejects(
    async () => handlers['fv.changeTargetDir']?.({ targetDirFileUrl: '' }, 1),
    /targetDirFileUrl must be a non-empty string/,
  );

  const result = await handlers['fv.changeTargetDir']?.({ targetDirFileUrl: 'file:///tmp/demo' }, 1);
  assert.deepEqual(result, state);
  assert.equal(conn.targetDirFileUrl, 'file:///tmp/demo');
});

test('fv.clearTargetDir and fv.getState delegate correctly', async () => {
  const state: IFVState = { fileList: [{ kind: 'file', name: 'a.txt', fileUrl: 'file:///a.txt', hidden: false }], targetDir: undefined };
  const conn = createMockConnection(state);
  const handlers = createHandlers(conn);

  const current = await handlers['fv.getState']?.({}, 1);
  assert.deepEqual(current, state);

  const cleared = await handlers['fv.clearTargetDir']?.({}, 2);
  assert.deepEqual(cleared, { fileList: [], targetDir: undefined });
  assert.equal(conn.targetDirFileUrl, undefined);
});
