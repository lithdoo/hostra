const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const rpcPort = Number(process.env.HOSTRA_RPC_PORT || 9333);
const rpcToken = process.env.HOSTRA_RPC_TOKEN || '';
const pagePort = 4174;
const fvWsPort = 8081;
const lithdooLabDir = process.env.LITHDOO_LAB_DIR || path.resolve(__dirname, '../../..');

const fvCli = path.resolve(lithdooLabDir, 'web-components/file-view-ws-server/dist/cli.js');
const fileViewDist = path.resolve(lithdooLabDir, 'web-components/file-view-component/dist');
const indexHtml = path.join(__dirname, 'index.html');
const demoDir = path.join(__dirname, 'demo-files');
const demoDirFileUrl = pathToFileURL(demoDir).href;

if (!fs.existsSync(fvCli)) {
  console.error('[hostra-file-view] Missing file-view-ws-server build:', fvCli);
  process.exit(1);
}
if (!fs.existsSync(path.join(fileViewDist, 'file-view-component.js'))) {
  console.error('[hostra-file-view] Missing file-view-component build:', fileViewDist);
  process.exit(1);
}

const fvProc = spawn(process.execPath, [fvCli], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: String(fvWsPort),
    HOST: '127.0.0.1'
  },
  windowsHide: true
});

const staticServer = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/' || url === '/index.html') {
    const raw = fs.readFileSync(indexHtml, 'utf8');
    const html = raw.replaceAll('__FILE_VIEW_DEMO_DIR__', demoDirFileUrl);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (url.startsWith('/file-view/')) {
    const relative = url.slice('/file-view/'.length);
    const filePath = path.join(fileViewDist, relative);
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
  console.log('[hostra-file-view] demo dir file URL:', demoDirFileUrl);
  console.log('[hostra-file-view] static server:', `http://127.0.0.1:${pagePort}`);
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
        title: 'hostra file-view example',
        width: 1100,
        height: 760,
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
        console.error('[hostra-file-view] openWindow error:', msg.error);
      } else {
        console.log('[hostra-file-view] openWindow success, windowId:', msg.result);
      }
    }
  } catch (err) {
    console.error('[hostra-file-view] parse ws message error:', err);
  }
});

ws.on('error', (err) => {
  console.error('[hostra-file-view] ws error:', err);
});

const cleanup = () => {
  try { ws.close(); } catch {}
  try { staticServer.close(); } catch {}
  if (!fvProc.killed) {
    try { fvProc.kill('SIGTERM'); } catch {}
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

fvProc.on('close', (code) => {
  console.log('[hostra-file-view] file-view-ws-server exited with code:', code);
});
