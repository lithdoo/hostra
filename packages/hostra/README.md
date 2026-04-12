# hostra

一个基于 Electron 的本地桌面运行壳。  
安装后会下载本机平台 Electron，并在运行时启动本地 WebSocket JSON-RPC 服务，供业务进程调用。

## 变更说明

当前版本仅支持 `.env` 配置，不再支持 `app.toml`。  
环境变量前缀统一为 `ELECHER_`。

## 快速开始

1. 安装：

```bash
npm i hostra
```

从本仓库根目录本地安装时：

```bash
npm i ./packages/hostra
```

`npm pack` 发布的包体不包含 `electron_bin`；安装后会通过 `postinstall` 按当前平台下载 Electron。

2. 在运行目录创建 `.env`：

```env
ELECHER_APP_NAME=my-electron-app
ELECHER_RPC_PORT=9333
ELECHER_RPC_TOKEN=replace-with-strong-token
ELECHER_SUBCMD=node ./app.js
ELECHER_CONFIG_DIR=.
```

3. 启动：

```bash
npx hostra
```

## 配置项

- `ELECHER_APP_NAME`：应用名（可选）。
- `ELECHER_RPC_PORT`：RPC 端口（默认 `9333`）。
- `ELECHER_RPC_TOKEN`：RPC 鉴权令牌（可选，设置后客户端必须携带 token）。
- `ELECHER_SUBCMD`：子进程命令（可选，子进程退出后应用退出）。
- `ELECHER_CONFIG_DIR`：配置目录（默认 `process.cwd()`，用于相对路径解析）。
- `ELECHER_MIRROR`：Electron 下载镜像（安装时使用）。

## 配置优先级

运行时优先级（高 -> 低）：

1. Shell 中已存在环境变量
2. `.env`
3. 默认值

`.env` 只会补充缺失变量，不覆盖 shell 中已存在的同名变量。

## 子进程环境变量继承

启动子进程时会使用继承环境（`...process.env`），因此 `.env` 加载到主进程的变量会一并传给子进程。  
也就是说，你在 `.env` 中的 `ELECHER_*` 或其他业务变量，子进程都能直接读取。

## RPC 连接与鉴权

服务地址：

```text
ws://localhost:<ELECHER_RPC_PORT>
```

启用 token 后：

```text
ws://localhost:<ELECHER_RPC_PORT>?token=<ELECHER_RPC_TOKEN>
```

未配置 `ELECHER_RPC_TOKEN` 时保持兼容：不做 token 校验。  
配置后若 token 错误，连接会被拒绝（`1008 Unauthorized`）。

## JSON-RPC 协议

在已建立的 WebSocket 连接上，每条消息为**单行 JSON 文本**（JSON-RPC 2.0 形态）。

**请求：**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "方法名",
  "params": {}
}
```

- `params` 可省略，服务端会按 `{}` 处理。
- 若整条消息不是合法 JSON，会收到解析错误响应（见下文错误码）。
- 若 JSON 合法但**没有** `method` 字段，当前实现**不会**返回任何响应。

**成功响应：**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": …
}
```

**失败响应：**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": { "code": -32601, "message": "…" }
}
```

## 错误码

| code | 含义 |
|------|------|
| `-32601` | 方法不存在（`Method not found: …`） |
| `-32602` | 无效参数或业务条件不满足（如 `closeWindow` 时窗口不存在） |
| `-32603` | 方法执行内部错误（或由方法抛出的其它 `code`） |
| `-32700` | 请求体 JSON 解析失败（`Parse error: …`，`id` 为 `null`） |

## RPC 方法说明

以下 `method` 字符串与 [`rpc-server.js`](rpc-server.js) 中注册名一致（区分大小写）。

### `getVersion`

返回当前 Electron 版本号。

| 项目 | 说明 |
|------|------|
| `params` | 无要求，可 `{}` 或省略 |
| `result` | 字符串，等同 `process.versions.electron` |

**示例请求：**

```json
{ "jsonrpc": "2.0", "id": 1, "method": "getVersion" }
```

### `getPlatform`

返回 Node/Electron 进程所在操作系统平台标识。

| 项目 | 说明 |
|------|------|
| `params` | 无要求 |
| `result` | 字符串，等同 `process.platform`（如 `win32`、`darwin`、`linux`） |

### `getArch`

返回 CPU 架构标识。

| 项目 | 说明 |
|------|------|
| `params` | 无要求 |
| `result` | 字符串，等同 `process.arch` |

### `getAppPath`

返回 Electron `app.getPath(name)` 对应路径。

| 项目 | 说明 |
|------|------|
| `params` | **必填** `name`：字符串，为 Electron 支持的 path 名称（如 `userData`、`home`、`temp` 等） |
| `result` | 字符串，绝对路径 |
| 错误 | `name` 非法或底层抛错时，一般为 `-32603` |

**示例请求：**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "getAppPath",
  "params": { "name": "userData" }
}
```

### `openWindow`

创建一个新 `BrowserWindow`，并返回窗口 ID。

| 项目 | 说明 |
|------|------|
| `params.id` | 可选，自定义窗口 ID；若传入且已存在同 ID 窗口会报错 |
| `params.title` | 可选，窗口标题；默认 `"Electron"` |
| `params.width` | 可选，宽度像素；默认 `800` |
| `params.height` | 可选，高度像素；默认 `600` |
| `params.loadUrl` | 可选，要加载的地址 |
| `params.devTool` | 可选，是否允许打开开发者工具；默认 `false` |
| `result` | 字符串，最终窗口 ID：有 `params.id` 则返回该值；无 `params.id` 则返回随机生成 ID |
| 错误 | 当 `params.id` 与已存在窗口冲突时：`code` `-32602`，`message` 形如 `Window id already exists: ...` |

**`loadUrl` 解析规则：**

- 以 `http://`、`https://`、`file://` 开头：原样传给 `loadURL`。
- 其它非空字符串：视为相对 `ELECHER_CONFIG_DIR` 的本地路径，先 `path.resolve`，再转为 `file://…` 加载。
- 省略或空：不调用 `loadURL`，得到空白窗口。

**示例请求：**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "openWindow",
  "params": {
    "title": "Demo",
    "width": 800,
    "height": 600,
    "loadUrl": "./index.html",
    "devTool": true
  }
}
```

### `closeWindow`

关闭指定 ID 的窗口并从内部列表移除。

| 项目 | 说明 |
|------|------|
| `params.windowId` | **必填**，先前 `openWindow` 返回的 ID |
| `result` | 布尔值 `true` |
| 错误 | 窗口不存在：`code` `-32602`，`message` 形如 `Window not found: …` |

**示例请求：**

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "closeWindow",
  "params": { "windowId": "window_1" }
}
```

### `getAllWindows`

列出当前仍被服务端跟踪的窗口（用户关闭窗口后会从列表中移除）。

| 项目 | 说明 |
|------|------|
| `params` | 无要求 |
| `result` | 对象数组，每项字段：`windowId`、`title`、`width`、`height`、`loadUrl`、`devTool`（均为创建时选项或默认值填充） |

**示例请求：**

```json
{ "jsonrpc": "2.0", "id": 5, "method": "getAllWindows" }
```

## 示例客户端

参考 `examples/open-window/app.ts`：

```js
const token = process.env.ELECHER_RPC_TOKEN || '';
const wsUrl = token
  ? `ws://localhost:9333?token=${encodeURIComponent(token)}`
  : 'ws://localhost:9333';
const ws = new WebSocket(wsUrl);
```

## 常见问题

- 下载失败：检查网络，必要时设置 `ELECHER_MIRROR`。
- 连接失败：确认端口、进程是否运行、token 是否正确。
- 相对路径打不开：确认 `ELECHER_CONFIG_DIR` 指向正确目录。
- 子进程命令异常：当前命令解析为 `split(' ')`，复杂引号/带空格路径需要额外注意。

## 许可证

ISC
