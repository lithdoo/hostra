import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseResizeControlMessage,
  RESIZE_COLS_MAX,
  RESIZE_COLS_MIN,
  RESIZE_ROWS_MAX,
  RESIZE_ROWS_MIN,
} from '../src/client-control-message.js';

test('parseResizeControlMessage accepts valid payload and clamps', () => {
  const r = parseResizeControlMessage(
    JSON.stringify({ type: 'resize', cols: 120, rows: 40 }),
  );
  assert.deepEqual(r, { cols: 120, rows: 40 });
  assert.deepEqual(
    parseResizeControlMessage(
      JSON.stringify({ type: 'resize', cols: 9999, rows: 9999 }),
    ),
    { cols: RESIZE_COLS_MAX, rows: RESIZE_ROWS_MAX },
  );
  assert.deepEqual(
    parseResizeControlMessage(
      JSON.stringify({ type: 'resize', cols: 1, rows: 0 }),
    ),
    null,
  );
  assert.deepEqual(
    parseResizeControlMessage(
      JSON.stringify({ type: 'resize', cols: RESIZE_COLS_MIN, rows: RESIZE_ROWS_MIN }),
    ),
    { cols: RESIZE_COLS_MIN, rows: RESIZE_ROWS_MIN },
  );
});

test('parseResizeControlMessage rejects wrong type or shape', () => {
  assert.equal(parseResizeControlMessage(''), null);
  assert.equal(parseResizeControlMessage('not json'), null);
  assert.equal(parseResizeControlMessage('{"type":"resize"}'), null);
  assert.equal(
    parseResizeControlMessage(JSON.stringify({ type: 'other', cols: 80, rows: 24 })),
    null,
  );
  assert.equal(
    parseResizeControlMessage(
      JSON.stringify({ type: 'resize', cols: '80', rows: 24 }),
    ),
    null,
  );
  assert.equal(
    parseResizeControlMessage(
      JSON.stringify({ type: 'resize', cols: 80.5, rows: 24 }),
    ),
    null,
  );
});

test('parseResizeControlMessage ignores oversized control string', () => {
  const big = ' '.repeat(300);
  assert.equal(parseResizeControlMessage(`{${big}}`), null);
});
