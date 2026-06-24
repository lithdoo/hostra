const WebSocket = require('ws');

const port = Number(process.env.HOSTRA_RPC_PORT || 9333);
const token = process.env.HOSTRA_RPC_TOKEN || '';
const wsUrl = token
  ? `ws://localhost:${port}?token=${encodeURIComponent(token)}`
  : `ws://localhost:${port}`;

const targetUrl = 'https://chatgpt.com';

const ws = new WebSocket(wsUrl);

ws.on('open', () => {
  console.log('[hostra-open-web] connected:', wsUrl);
  ws.send(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'openWindow',
      params: {
        title: 'hostra open web example',
        width: 1000,
        height: 700,
        loadUrl: targetUrl
      }
    })
  );
});

ws.on('message', (raw) => {
  try {
    const msg = JSON.parse(raw.toString());
    if (msg.id === 1) {
      if (msg.error) {
        console.error('[hostra-open-web] openWindow error:', msg.error);
        process.exit(1);
      }
      console.log('[hostra-open-web] openWindow success, windowId:', msg.result);
    }
  } catch (err) {
    console.error('[hostra-open-web] bad JSON message:', err);
  }
});

ws.on('close', () => {
  console.log('[hostra-open-web] ws closed');
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('[hostra-open-web] ws error:', err);
  process.exit(1);
});
