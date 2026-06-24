const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const rpcPort = Number(process.env.HOSTRA_RPC_PORT || 9333);
const rpcToken = process.env.HOSTRA_RPC_TOKEN || '';
const pagePort = 4173;
const lspPort = 3001;
const hostraRepoDir = process.env.HOSTRA_REPO_DIR || path.resolve(__dirname, '../..');

const lspCli = path.resolve(hostraRepoDir, 'web-components/lsp-ws-server/dist/cli.js');
const webEditorDist = path.resolve(hostraRepoDir, 'web-components/web-editor-component/dist');
const indexHtml = path.join(__dirname, 'index.html');

if (!fs.existsSync(lspCli)) {
  console.error('[hostra-web-editor] Missing lsp-ws-server build:', lspCli);
  process.exit(1);
}
if (!fs.existsSync(path.join(webEditorDist, 'web-editor-component.js'))) {
  console.error('[hostra-web-editor] Missing web-editor-component build:', webEditorDist);
  process.exit(1);
}

const lspProc = spawn(process.execPath, [lspCli], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: String(lspPort),
    HOST: '127.0.0.1'
  },
  windowsHide: true
});

const staticServer = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/' || url === '/index.html') {
    const html = fs.readFileSync(indexHtml, 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (url.startsWith('/web-editor/')) {
    const relative = url.slice('/web-editor/'.length);
    const filePath = path.join(webEditorDist, relative);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const contentType =
        ext === '.js' ? 'text/javascript; charset=utf-8'
          : ext === '.css' ? 'text/css; charset=utf-8'
            : 'application/octet-stream';
      res.writeHead(200, { 'content-type': contentType });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

staticServer.listen(pagePort, '127.0.0.1', () => {
  console.log('[hostra-web-editor] static server:', `http://127.0.0.1:${pagePort}`);
});

const rpcWsUrl = rpcToken
  ? `ws://127.0.0.1:${rpcPort}?token=${encodeURIComponent(rpcToken)}`
  : `ws://127.0.0.1:${rpcPort}`;
const ws = new WebSocket(rpcWsUrl);

ws.on('open', () => {
  ws.send(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'openWindow',
      params: {
        title: 'hostra web editor example',
        width: 1200,
        height: 800,
        devTool: true,
        loadUrl: `http://127.0.0.1:${pagePort}`
      }
    })
  );
});

ws.on('message', (raw) => {
  try {
    const msg = JSON.parse(raw.toString());
    if (msg.id === 1) {
      if (msg.error) {
        console.error('[hostra-web-editor] openWindow error:', msg.error);
      } else {
        console.log('[hostra-web-editor] openWindow success, windowId:', msg.result);
      }
    }
  } catch (err) {
    console.error('[hostra-web-editor] parse ws message error:', err);
  }
});

ws.on('error', (err) => {
  console.error('[hostra-web-editor] ws error:', err);
});

const cleanup = () => {
  try { ws.close(); } catch {}
  try { staticServer.close(); } catch {}
  if (!lspProc.killed) {
    try { lspProc.kill('SIGTERM'); } catch {}
  }
};

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

lspProc.on('close', (code) => {
  console.log('[hostra-web-editor] lsp-ws-server exited with code:', code);
});
