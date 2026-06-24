# hostra-command-terminal

通过 `hostra` 打开一个窗口，展示 [`web-command-component`](../../web-components/web-command-component) 的 `<command-terminal>`，并由本机子进程运行 [`command-ws-server`](../../web-components/command-ws-server) 提供 PTY WebSocket。

## 运行前准备

在 hostra 仓库根目录下，确保两个包已构建：

```bash
cd web-components/command-ws-server && npm install && npm run build
cd ../web-command-component && npm install && npm run build
```

## 启动示例（Windows）

```bat
run-example.bat
```

脚本会：

1. 同步 `.env`
2. 在 `examples` 层安装依赖（如缺失）
3. 启动 `npx --prefix ".." hostra`

## 端口说明

| 用途 | 端口 |
|------|------|
| 静态页面（本示例 `app.js`） | `4174` |
| 终端 WebSocket（`command-ws-server`） | `8082` |
| Hostra RPC | `9333`（见 `.env`，可与其它 hostra 示例共用，但通常同时只跑一个） |

浏览器中 `<command-terminal>` 的 `ws-url` 为 `ws://127.0.0.1:8082/terminal`，与 `app.js` 里 spawn 的 `PORT` / `HOST` 一致。

## 仅调试静态页与终端（不经过 Hostra）

在已构建依赖的前提下：

```bash
cd examples/hostra-command-terminal
node app.js
```

若未运行 Hostra，RPC WebSocket 会报错，但静态服务仍可在 `http://127.0.0.1:4174` 打开；可在本机浏览器手动访问该地址测试终端。
