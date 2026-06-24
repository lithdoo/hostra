# @web-editor/web-command-component

`<command-terminal>` 自定义元素：在 **open Shadow DOM** 内嵌 **xterm.js**，通过 **WebSocket** 连接 [`@web-editor/command-ws-server`](../command-ws-server)。**PTY 输出 → 浏览器** 为 **binary** 帧；键盘输入由 **`xterm-addon-attach`** 以 **binary** 发送。终端 **行列变化**时，会额外发送 **text** JSON：`{ "type": "resize", "cols": number, "rows": number }`（与 `command-ws-server` 协议一致，`requestAnimationFrame` 节流）。

## 构建

```bash
cd web-components/web-command-component
npm install
npm run build
```

## 属性

| 属性 | 说明 |
|------|------|
| `ws-url` | WebSocket 地址（如 `ws://127.0.0.1:8082/terminal`）。变更会 **重连**。 |
| `token` | 可选；作为查询参数 `token` 发送（与 `upgradeToken` 配套）。变更会 **重连**。 |
| `work-dir-url` | 可选；**完整** `file:` URL（如 `file:///C:/repo`）。仅在 **新建连接** 时生效；**单独修改不会重连**，需调用 **`reconnect()`** 或修改 **`ws-url`**。 |
| `disconnect-message` | 可选；连接失败或 **异常断线** 时遮罩上的主文案（未设置则用内置默认中文）。 |
| `reconnect-label` | 可选；遮罩上「重新连接」按钮文字（未设置则显示 **重新连接**）。 |

服务端对应查询参数为 **`workDir`**（由 `buildTerminalWebSocketUrl` 单次 `encodeURIComponent` 编码）。工作目录白名单见 **`COMMAND_WS_ALLOWED_ROOTS`**（`command-ws-server` README）。

## 连接遮罩

建立连接过程中（`#boot` 至 WebSocket `open` 成功前），Shadow DOM 内会显示 **loading** 遮罩，避免在半成品状态下操作 xterm。连接成功后遮罩隐藏。

若 **打开失败**（超时、`error` 等）或 **运行中异常断线**（非组件主动 `dispose` / `reconnect` 导致的关闭），遮罩会显示说明文案与 **重新连接** 按钮；点击按钮与调用 **`reconnect()`** 等价。主动重连（改 `ws-url` / `token`、`reconnect()`）会先进入 loading，不会出现「先闪断线再 loading」的误报。

`disconnect-message` / `reconnect-label` 为读取时 `getAttribute`（未列入 `observedAttributes`）；若需在运行时改文案，请改属性后调用 **`reconnect()`** 或重新挂载元素。

## 方法

- **`reconnect()`**：断开当前 WebSocket 与终端，按当前属性重新连接（用于在修改 `work-dir-url` 后生效）。与断线遮罩上的 **重新连接** 按钮行为一致。

## 事件（`composed: true`）

- **`command-terminal-error`**：`detail.message` 为错误说明（如连接超时）。
- **`command-terminal-close`**：WebSocket 关闭时派发。

## 编程式 API

```ts
import {
  defineCommandTerminalElement,
  buildTerminalWebSocketUrl,
} from '@web-editor/web-command-component';

defineCommandTerminalElement();

const url = buildTerminalWebSocketUrl({
  baseWsUrl: 'ws://127.0.0.1:8082/terminal',
  token: 'secret',
  workDirUrl: 'file:///C:/my/repo',
});
```

## 示例页面

见子模块示例 [`hostra/examples/hostra-command-terminal`](../../hostra/examples/hostra-command-terminal)。需先 **`npm run build`** 本包与 **`command-ws-server`**，再用本地静态 HTTP 打开（避免 `file://` 限制 WebSocket）。

## 测试

```bash
npm test
```
