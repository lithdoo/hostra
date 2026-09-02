const ws = require('ws');

const LOOPBACK_HOST = '127.0.0.1';

function normalizeArguments(portOrOptions, legacyOptions) {
  if (typeof portOrOptions === 'object' && portOrOptions !== null) {
    return portOrOptions;
  }

  return {
    ...legacyOptions,
    port: portOrOptions
  };
}

function createRpcServer(portOrOptions = 9333, legacyOptions = {}) {
  const options = normalizeArguments(portOrOptions, legacyOptions);
  const host = options.host || LOOPBACK_HOST;
  const port = options.port ?? 9333;
  const requiredToken = options.token || '';
  const methods = options.methods || {};

  return new Promise((resolve, reject) => {
    const wss = new ws.WebSocketServer({ host, port });
    let settled = false;

    const safeSend = (client, message) => {
      if (client.readyState !== ws.OPEN) return;
      try {
        client.send(message);
      } catch (error) {
        console.warn('[JsonRpcServer] Failed to send WebSocket message:', error.message);
      }
    };

    const rejectStartup = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    wss.once('error', rejectStartup);

    wss.once('listening', () => {
      if (settled) return;
      settled = true;
      wss.off('error', rejectStartup);

      const address = wss.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      let closed = false;

      const notify = (method, params) => {
        const message = JSON.stringify({ jsonrpc: '2.0', method, params });
        for (const client of wss.clients) {
          safeSend(client, message);
        }
      };

      const rpcServer = {
        host,
        port: actualPort,
        endpoint: `ws://${host}:${actualPort}`,
        wss,
        notify,
        close() {
          if (closed) return Promise.resolve();
          closed = true;

          return new Promise((closeResolve) => {
            wss.close(() => closeResolve());
            for (const client of wss.clients) {
              client.terminate();
            }
          });
        }
      };

      console.log(`[JsonRpcServer] Started on ${rpcServer.endpoint}`);
      resolve(rpcServer);
    });

    wss.on('connection', (clientWs, req) => {
      if (requiredToken) {
        let providedToken = '';
        try {
          const requestUrl = new URL(req.url || '/', `ws://${host}:${port}`);
          providedToken = requestUrl.searchParams.get('token') || '';
        } catch (error) {
          providedToken = '';
        }

        if (providedToken !== requiredToken) {
          console.warn('[JsonRpcServer] Unauthorized RPC connection rejected');
          clientWs.close(1008, 'Unauthorized');
          return;
        }
      }

      clientWs.on('message', async (data) => {
        let request;
        try {
          request = JSON.parse(data.toString());
        } catch (error) {
          safeSend(clientWs, JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: `Parse error: ${error.message}` },
            id: null
          }));
          return;
        }

        if (!request.method) return;

        const method = methods[request.method];
        if (!method) {
          if (request.id !== undefined) {
            safeSend(clientWs, JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              error: { code: -32601, message: `Method not found: ${request.method}` }
            }));
          }
          return;
        }

        try {
          const result = await method(request.params || {});
          if (request.id !== undefined) {
            safeSend(clientWs, JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
          }
        } catch (error) {
          if (request.id !== undefined) {
            safeSend(clientWs, JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              error: {
                code: error.code || -32603,
                message: error.message || String(error)
              }
            }));
          }
        }
      });
    });
  });
}

module.exports = { createRpcServer, LOOPBACK_HOST };
