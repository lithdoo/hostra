# file-view-ws-server

A minimal WebSocket JSON-RPC 2.0 server scaffold for file-view features.

## Run

```bash
npm install
npm run build
npm run start
```

Default endpoint:

- Health: `http://127.0.0.1:8081/health`
- JSON-RPC over WebSocket: `ws://127.0.0.1:8081/rpc`

You can override host/port:

```bash
HOST=0.0.0.0 PORT=8081 npm run dev
```

## Example JSON-RPC request

Send:

```json
{"jsonrpc":"2.0","id":1,"method":"rpc.ping","params":{}}
```

Receive:

```json
{"jsonrpc":"2.0","id":1,"result":{"ok":true}}
```

## Error handling

The server returns standard JSON-RPC errors:

- `-32700 Parse error`
- `-32600 Invalid Request`
- `-32601 Method not found`
- `-32603 Internal error`

## Next step

Planned methods (not implemented in this scaffold):

- `file.list`
- `file.read`
