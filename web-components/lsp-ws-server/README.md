# @web-editor/lsp-ws-server

在 **Node.js** 上提供 **HTTP + WebSocket** 服务，将浏览器发来的 **LSP（JSON-RPC）** 与本地以 **stdio** 运行的官方语言服务器进程桥接。可与 **`@web-editor/component`** 或其它任意 LSP WebSocket 客户端配合使用。

---

## 功能概览

| 能力 | 说明 |
|------|------|
| 多客户端 | 每个 WebSocket 连接独立 **会话**：独立子进程、独立临时工作区目录 |
| 语言路由 | 由升级 URL 的查询参数 **`language`**（或 `lang`）选择启动哪种语言服务器 |
| URI 桥接 | 将客户端常见的 **`file:///workspace/...`** 与主机上 **临时目录** 做双向改写，避免 Windows 上 `C:\workspace` 等无效路径 |
| 健康检查 | `GET /` 与 `GET /health` 返回纯文本提示 |

---

## 技术栈

- **TypeScript**、**Node.js**（建议 ≥ 20，与 `vscode-ws-jsonrpc` 声明一致）
- **ws**：WebSocket 服务端
- **vscode-ws-jsonrpc**：`createWebSocketConnection`、`createServerProcess`、`forward` 模式下的非对称封装
- **vscode-jsonrpc**：stdio 上的 LSP 分帧
- 语言服务器通过 **npm 包** 安装（见下表）

---

## 支持的语言与进程

| `language` 参数（示例） | 依赖包 | 启动方式（概要） |
|-------------------------|--------|------------------|
| `typescript` / `ts` | `typescript-language-server` | `node …/lib/cli.mjs --stdio` |
| `json` / `jsonc` | `vscode-langservers-extracted` | `node …/json-language-server/.../jsonServerMain.js --stdio` |
| `markdown` / `md` | 同上 | `node …/markdown-language-server/.../main.js --stdio` |
| `toml` | `@taplo/cli` | `node …/dist/cli.js lsp stdio` |

未识别的 `language` 会拒绝 WebSocket 升级（HTTP 400 或关闭码 4000，视路径而定）。

**TypeScript 会话**会在临时目录下写入最小 **`tsconfig.json`**，便于 `typescript-language-server` / tsserver 建立项目上下文。

---

## 目录结构（`src/`）

```
src/
├── cli.ts                 # 可执行入口：读 PORT / HOST，监听 SIGINT/SIGTERM
├── index.ts               # 库导出：createLspWsServer 等
├── server.ts              # HTTP 服务、/lsp 升级、健康路由
├── lsp-session.ts         # 单连接：mkdtemp、非对称转发、关闭时删目录
├── asymmetric-forward.ts  # 客户端↔服务端不同 message map（URI 双向改写）
├── lsp-uri-bridge.ts      # JSON-RPC 消息内 file: URI 深度替换
├── session-tsconfig.ts    # 会话内 tsconfig.json
├── language-spawn.ts      # language → spawn 命令解析（白名单）
└── ws-socket-adapter.ts   # `ws` 的 WebSocket → vscode-ws-jsonrpc IWebSocket
```

---

## 安装与运行

```bash
cd packages/lsp-ws-server
npm install
npm run build
npm start
```

开发时可直接跑 TypeScript（无需先 build）：

```bash
npm run dev
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8080` | HTTP 与 WebSocket 监听端口 |
| `HOST` | `0.0.0.0` | 绑定地址 |

示例（PowerShell）：

```powershell
$env:PORT=3000; npm start
```

### CLI 包名

`package.json` 中 **`bin.lsp-ws-server`** 指向 `dist/cli.js`；全局 `npm link` 或 `npx` 后可用命令名 **`lsp-ws-server`**（需先 `npm run build`）。

---

## WebSocket 协议约定

1. 客户端应对 **`/lsp`**（默认）发起 **WebSocket** 升级（与 `createLspWsServer` 的 `pathname` 一致时可改）。
2. 查询串必须包含 **`language`**（或 **`lang`**），例如：  
   `ws://127.0.0.1:8080/lsp?language=typescript`
3. 链路上为 **JSON-RPC 2.0** 消息（与 VS Code / monaco-languageclient 一致），由 **vscode-ws-jsonrpc** 与 **stdio** 上的 **StreamMessageReader/Writer** 对接。

**`@web-editor/component`** 会在 `lsp-url` 上自动附加 `language`，与上述约定对齐。

---

## URI 桥接（Windows / 虚拟 workspace）

浏览器端 Monaco 常使用 **`file:///workspace/...`**。在 Windows 上，若直接交给本机上的 **typescript-language-server**，可能被解析为 **`C:\workspace`** 等不存在的路径，导致 `initialize` 或 `didOpen` 失败。

本服务为**每个连接**：

1. `fs.mkdtempSync` 在系统临时目录下创建唯一文件夹 `sessionRoot`；
2. 对 **客户端 → 语言服务器** 的消息：将 `file:///workspace/...` 等映射为 `sessionRoot` 下的 **真实 file URI**；
3. 对 **语言服务器 → 客户端** 的消息：再映射回 **`file:///workspace/...`**，保证编辑器与 LSP 的 URI 一致；
4. 连接关闭时 **`rmSync(sessionRoot, { recursive: true })`**。

因此：**不要在生产环境把该服务暴露给不可信客户端而不做鉴权**，临时目录中可能短暂存在用户编辑内容。

---

## 编程式 API

```ts
import { createLspWsServer } from '@web-editor/lsp-ws-server';

const server = createLspWsServer({
  port: 8080,
  host: '127.0.0.1',
  pathname: '/lsp',
  languageQueryParam: 'language',
});

await server.listen();
// …
await server.close();
```

### `createLspWsServer(options)`

| 选项 | 说明 |
|------|------|
| `port` | 必填，TCP 端口 |
| `host` | 可选，默认 `0.0.0.0` |
| `pathname` | WebSocket 路径，默认 `/lsp` |
| `languageQueryParam` | 查询参数名，默认 `language` |
| `logger` | 可选，`info` / `warn` / `error` |

返回对象的 **`listen()`** / **`close()`** 为 Promise，便于嵌入其它进程或测试。

---

## 安全与运维建议

- **鉴权**：生产环境应对 WebSocket 做 token / cookie / 反向代理层校验。
- **资源**：每个会话一个子进程 + 临时目录，应对 **最大连接数** 与 **进程泄漏**（异常断开时子进程应随连接关闭而被终止，如有异常需监控）。
- **命令注入**：`language` 仅映射到固定白名单命令，勿改为任意用户输入拼接 shell。

---

## 故障排查

| 现象 | 排查方向 |
|------|-----------|
| 升级失败 / 400 | 是否缺少 `language` 查询参数；路径是否为 `/lsp` |
| TS 初始化 ENOENT | 是否未使用本服务的 URI 桥接；客户端是否仍直连未改写的路径 |
| 子进程立刻退出 | 本机 Node 版本、依赖是否安装完整；查看 stderr（`createServerProcess` 会打印部分日志） |

---

## 与同仓库前端的联调

在 monorepo 根目录可参考：

- `npm run start:lsp` / `npm run start:lsp:3000`
- `demos/minimal/index.html`、`start-demo.bat`

确保 **先 `npm run build`** 本包，再启动服务。

---

## 许可证

以仓库根目录 **LICENSE** 为准（若未单独声明，则与 monorepo 一致）。
