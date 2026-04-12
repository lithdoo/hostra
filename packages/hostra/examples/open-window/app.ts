const token = process.env.ELECHER_RPC_TOKEN || '';
const wsUrl = token
  ? `ws://localhost:9333?token=${encodeURIComponent(token)}`
  : 'ws://localhost:9333';
const ws = new WebSocket(wsUrl);

ws.onopen = () => {
  console.log('[RPC] Connected');

  const request = {
    jsonrpc: '2.0',
    method: 'openWindow',
    params: {
      title: 'Demo Window',
      width: 800,
      height: 600,
      loadUrl: './index.html',
      devTool: true
    },
    id: 1
  };

  console.log('[RPC] Sending:', JSON.stringify(request,null,2));
  ws.send(JSON.stringify(request));
};

ws.onmessage = (event) => {
  // console.log('[RPC] Raw:', event.data);
  const response = JSON.parse(event.data);
  // console.log('[RPC] Response:', response);
};

ws.onerror = (error) => {
  console.error('[RPC] Error:', error);
};

ws.onclose = () => {
  console.log('[RPC] Disconnected');
};
