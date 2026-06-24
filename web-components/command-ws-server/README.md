# @web-editor/command-ws-server



在 **Node.js** 上提供 **HTTP + WebSocket** 服务，将浏览器中 **xterm.js** 等终端客户端与本地 **`node-pty`** 伪终端桥接（每连接一个 PTY 会话）。可与同仓库中的终端 Web Component 或其它任意 WebSocket 终端客户端配合使用。



---



## 功能概览



| 能力 | 说明 |

|------|------|

| 健康检查 | `GET /` 与 `GET /health`（含查询串，仅按 pathname 判断）返回纯文本 `command-ws-server ok` |

| WebSocket + PTY | 对默认路径 **`/terminal`** 升级 WebSocket；每连接 **`node-pty.spawn`** 一个 shell（Windows 默认 `powershell.exe -NoLogo`，Unix 默认 `$SHELL` 或 `/bin/bash`） |

| 终端 I/O | **服务端 → 客户端**：以 **binary** WebSocket 帧发送 UTF-8 字节；**客户端 → 服务端**：**binary**（及非 resize 的 **text**）写入 PTY；另支持 **text** JSON **`{ "type": "resize", "cols", "rows" }`** 调用 **`pty.resize`**（见下文协议） |

| 运维钩子 | 可选 **`maxConnections`**（超额返回 HTTP 503）、**`idleTimeoutMs`**（无双向流量时关闭会话）、**`upgradeToken`**（查询参数鉴权最小实现） |

| 工作目录 | 可选查询 **`workDir`**（与 `@web-editor/web-command-component` 的 **`work-dir-url`** 属性对应，值为 **单次 `encodeURIComponent` 后的完整 `file:` URL**）。**无 `workDir` 时** PTY 的 `cwd` 为 **`defaultSessionCwd ?? cwd ?? os.homedir()`**（不再默认 `process.cwd()`）。**有 `workDir` 时** 经 **`COMMAND_WS_ALLOWED_ROOTS`** 校验，非法返回 **HTTP 400**。 |

| 关闭 | **`close()`** 先 `terminate` 所有 WebSocket，再 `wss.close`，最后关闭 HTTP 服务器 |



---



## 技术栈



- **TypeScript**、**Node.js**（建议 ≥ 20，与仓库其它 `@web-editor/*` 包一致）

- **ws**：WebSocket 服务端（`noServer` + `http` `upgrade`）

- **node-pty**：本地伪终端



**Windows**：`node-pty` 含原生模块，`npm install` 通常需要本机已安装 **Visual Studio Build Tools**（含「使用 C++ 的桌面开发」）或等价 MSVC 工具链。在部分环境下 ConPTY 辅助进程可能向 stderr 打印 `AttachConsole` 相关警告，一般不影响会话。



---



## 目录结构（`src/`）



```

src/

├── cli.ts               # 可执行入口：读 PORT / HOST，监听 SIGINT/SIGTERM

├── index.ts             # 库导出

├── server.ts                 # HTTP、健康检查、WebSocket 升级、连接策略

├── terminal-path-policy.ts   # `workDir` query：`file:` 解析与允许根校验

├── client-control-message.ts # 客户端 text 控制帧（如 resize）解析

└── terminal-session.ts       # PTY spawn、ws↔pty 桥接、空闲超时、对称 teardown

```



---



## 安装与运行



```bash

cd web-components/command-ws-server

npm install

npm run build

npm start

```



```bash

npm test

```



开发时可直接跑 TypeScript（无需先 build）：



```bash

npm run dev

```



### 环境变量



| 变量 | 默认值 | 说明 |

|------|--------|------|

| `PORT` | `8082` | HTTP 与 WebSocket 监听端口 |

| `HOST` | `0.0.0.0` | 绑定地址 |

| `COMMAND_WS_ALLOWED_ROOTS` | （未设置） | 逗号或分号分隔的绝对路径列表，用于校验 **`workDir`** 解析后的目录必须落在这些根之下；未设置时仅允许 **`process.cwd()`** 树下（启动时会 **warn**） |



示例（PowerShell）：



```powershell

$env:PORT=3000; npm start

```



### CLI 包名



`package.json` 中 **`bin.command-ws-server`** 指向 `dist/cli.js`；全局 `npm link` 或 `npx` 后可用命令名 **`command-ws-server`**（需先 `npm run build`）。



---



## WebSocket 协议约定



1. 客户端对 **`/terminal`**（默认，可由 `createCommandWsServer({ pathname })` 修改）发起 **WebSocket** 升级，方法为 **GET**，且需带标准 **`Upgrade: websocket`** 头。

2. 升级成功后，服务端启动一个 PTY，并将 **PTY `onData`** 输出以 **binary** 帧推送到客户端；客户端发来的 **binary** 帧（以及非 resize 的 **text**）会 **`pty.write`**。

3. **初始终端行列**由服务端 `defaultCols` / `defaultRows`（默认 80×24）决定。客户端可在连接后发送 **UTF-8 文本** 控制帧调整 PTY 尺寸（**非 binary** 帧，单行 JSON）：

   ```json
   { "type": "resize", "cols": 120, "rows": 40 }
   ```

   - `cols` / `rows` 必须为 JSON **number**（不能是字符串），且为**有限整数**；服务端会 **clamp** 到 **`cols` 2–512、`rows` 1–256**（与 [`client-control-message.ts`](src/client-control-message.ts) 常量一致）。
   - 与 **键盘输入**分离：`@web-editor/web-command-component` 使用 **`xterm-addon-attach`** 时，键盘通常为 **binary** 帧；resize 使用 **`ws.send(JSON.stringify(...))` 文本帧** 即可。
   - **升级顺序**：若先升级客户端、后升级服务端，旧服务端可能把 JSON 文本 **`write` 进 shell**，用户可能短暂看到一行 JSON；建议 **先升级服务端** 或同时发布。

4. **鉴权（可选）**：若配置了 **`upgradeToken`**，则升级 URL 必须包含查询参数 **`token`**（名可由 **`authQueryParam`** 修改），且值与 `upgradeToken` 完全一致，否则返回 **HTTP 400** 并拒绝升级。生产环境仍建议配合反向代理做更强鉴权。

5. **工作目录 `workDir`（可选）**：与浏览器自定义元素属性 **`work-dir-url`**（`file:` URL 字符串）对应；在建立 WebSocket 时作为查询参数传递，例如 **`workDir=${encodeURIComponent(workDirUrl)}`**（**只编码一次**整段 URL）。服务端 **`decodeURIComponent`** 后解析为 **`file:`** 路径，**必须为已存在的目录**且落在 **`COMMAND_WS_ALLOWED_ROOTS`** 下，否则 **HTTP 400**。**不**带 `workDir` 时，PTY 起始目录为 **`defaultSessionCwd ?? cwd ?? os.homedir()`**；**`COMMAND_WS_ALLOWED_ROOTS` 不约束**该默认目录。

6. **校验顺序**：先 **`upgradeToken`**（若启用），再解析 **`workDir`**（若存在），再 **`maxConnections`**，避免无效路径在已满负载时仍被解析。



**客户端**：可使用 **`xterm-addon-attach`** 或等价逻辑，将 `WebSocket` 实例交给 xterm（注意与 binary 发送方式一致），或与 **`@web-editor/web-command-component`** 对齐。



示例 URL：



- `ws://127.0.0.1:8082/terminal`

- `ws://127.0.0.1:8082/terminal?token=your-secret`（在设置了 `upgradeToken: 'your-secret'` 时）

- `ws://127.0.0.1:8082/terminal?workDir=file%3A%2F%2F%2FC%3A%2FUsers%2Fme%2Frepo`（`workDir` 为 **单次编码**后的 `file:///C:/Users/me/repo`；需满足 **`COMMAND_WS_ALLOWED_ROOTS`**）



---



## 编程式 API



```ts

import { createCommandWsServer } from '@web-editor/command-ws-server';



const server = createCommandWsServer({

  port: 8082,

  host: '127.0.0.1',

  pathname: '/terminal',

  maxConnections: 16,

  idleTimeoutMs: 600_000,

});



await server.listen();

// …

await server.close();

```



### `createCommandWsServer(options)`



| 选项 | 说明 |

|------|------|

| `port` | 必填，TCP 端口 |

| `host` | 可选，默认 `0.0.0.0` |

| `pathname` | WebSocket 路径，默认 `/terminal` |

| `defaultSessionCwd` | 可选；当升级 URL **没有** `workDir` 参数时，用作 PTY `cwd`，否则下一项 |

| `cwd` | 可选；**遗留别名**：等价于在未设置 `defaultSessionCwd` 时参与 **`defaultSessionCwd ?? cwd ?? os.homedir()`** |

| `shell` / `shellArgs` | 可选，**仅服务端配置**的可执行文件与参数；不设则使用平台默认 shell |

| `defaultCols` / `defaultRows` | 初始列行，默认 `80` / `24` |

| `maxConnections` | 可选；当前已建立会话数达到上限时拒绝升级（**503**） |

| `idleTimeoutMs` | 可选；超过该毫秒数无 PTY→socket 且 socket→PTY 活动时关闭会话 |

| `upgradeToken` | 可选；若设置则必须携带匹配的查询参数（见上） |

| `authQueryParam` | 可选，默认 `token` |

| `logger` | 可选，`info` / `warn` / `error` |



返回对象包含 **`httpServer`**、**`wss`**（`WebSocketServer`），以及 **`listen()`** / **`close()`**（均为 Promise）。



---



## 安全与运维建议



- **鉴权**：终端能力等价于在服务器上执行 shell 命令；对外暴露前必须在反向代理或应用层做 **强鉴权** 与 **来源限制**。`upgradeToken` 仅为最小示例钩子。

- **资源**：每连接一个 PTY 与子进程，应配置 **`maxConnections`**、**`idleTimeoutMs`**，并监控 **进程泄漏**。

- **命令注入**：**不要**将来把 `shell` / `shellArgs` 暴露给不可信客户端或 URL；若扩展配置，应 **白名单** 或严格校验。

- **`workDir` 与 `COMMAND_WS_ALLOWED_ROOTS`**：仅信任来自已鉴权客户端或内网的 `workDir`；生产环境务必配置 **`COMMAND_WS_ALLOWED_ROOTS`**，勿依赖默认的「仅 `process.cwd()`」策略。



---



## 故障排查



| 现象 | 排查方向 |

|------|-----------|

| `npm install` 失败（node-gyp / MSBuild） | Windows 是否安装 VS Build Tools；Node 版本是否与预编译二进制匹配 |

| 端口占用 | 修改 `PORT` 或结束占用进程 |

| WebSocket 升级失败 | 路径是否为 `pathname`；若启用 token，查询参数是否匹配 |

| 升级 503 | 是否达到 `maxConnections` |

| 升级 400（`workDir`） | 非 `file:`、解码失败、`fileURLToPath` 失败、路径不存在、非目录、或不在 **`COMMAND_WS_ALLOWED_ROOTS`** 下 |

| 无输出 | shell 是否在目标 `cwd` 下可用；Windows 控制台编码可尝试 UTF-8 / `chcp 65001` |



---



## 与同仓库前端的联调



1. 在本目录执行 **`npm run build`**。

2. **`npm start`**（或 `npm run dev`），记下端口（默认 **8082**）。

3. 前端创建 **`new WebSocket('ws://127.0.0.1:8082/terminal')`**（若启用 token 则附加 **`?token=…`**；若使用 **`work-dir-url`** 则附加 **`&workDir=…`**），与 **xterm.js** 或 **`@web-editor/web-command-component`** 绑定。

4. 终端 Web Component 与示例 HTML 路径确定后，可在此补充具体仓库路径。



---



## 许可证



以仓库根目录 **LICENSE** 为准（若未单独声明，则与 monorepo 一致）。

