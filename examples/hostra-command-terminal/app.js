const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const rpcPort = Number(process.env.HOSTRA_RPC_PORT || 9333);
const rpcToken = process.env.HOSTRA_RPC_TOKEN || '';
const pagePort = 4174;
const commandWsPort = 8082;
const hostraRepoDir = process.env.HOSTRA_REPO_DIR || path.resolve(__dirname, '../..');

const commandCli = path.resolve(
  hostraRepoDir,
  'web-components/command-ws-server/dist/cli.js',
);
const webCommandDist = path.resolve(
  hostraRepoDir,
  'web-components/web-command-component/dist',
);
const indexHtml = path.join(__dirname, 'index.html');

if (!fs.existsSync(commandCli)) {
  console.error('[hostra-command-terminal] Missing command-ws-server build:', commandCli);
  process.exit(1);
}
if (!fs.existsSync(path.join(webCommandDist, 'web-command-component.js'))) {
  console.error(
    '[hostra-command-terminal] Missing web-command-component build:',
    webCommandDist,
  );
  process.exit(1);
}

const commandProc = spawn(process.execPath, [commandCli], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: String(commandWsPort),
    HOST: '127.0.0.1',
  },
  windowsHide: true,
});

const staticServer = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/' || url === '/index.html') {
    const html = fs.readFileSync(indexHtml, 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (url.startsWith('/web-command/')) {
    const relative = url.slice('/web-command/'.length);
    const filePath = path.join(webCommandDist, relative);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const contentType =
        ext === '.js'
          ? 'text/javascript; charset=utf-8'
          : ext === '.css'
            ? 'text/css; charset=utf-8'
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
  console.log(
    '[hostra-command-terminal] static server:',
    `http://127.0.0.1:${pagePort}`,
  );
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
        title: 'hostra command terminal example',
        width: 1200,
        height: 800,
        devTool: true,
        loadUrl: `http://127.0.0.1:${pagePort}`,
      },
    }),
  );
});

ws.on('message', (raw) => {
  try {
    const msg = JSON.parse(raw.toString());
    if (msg.id === 1) {
      if (msg.error) {
        console.error('[hostra-command-terminal] openWindow error:', msg.error);
      } else {
        console.log(
          '[hostra-command-terminal] openWindow success, windowId:',
          msg.result,
        );
      }
    }
  } catch (err) {
    console.error('[hostra-command-terminal] parse ws message error:', err);
  }
});

ws.on('error', (err) => {
  console.error('[hostra-command-terminal] ws error:', err);
});

const cleanup = () => {
  try {
    ws.close();
  } catch {}
  try {
    staticServer.close();
  } catch {}
  if (!commandProc.killed) {
    try {
      commandProc.kill('SIGTERM');
    } catch {}
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

commandProc.on('close', (code) => {
  console.log('[hostra-command-terminal] command-ws-server exited with code:', code);
});
