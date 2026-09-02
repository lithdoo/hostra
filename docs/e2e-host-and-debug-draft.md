# Hostra Endpoint Discovery、Lifecycle Observability 与 CDP 草案

> Status: Draft  
> Scope: 将 Hostra 收敛为一个可确定启动、可发现 endpoint、可观测 Host 生命周期、可通过标准 CDP 调试 Renderer 的本地 Electron Host。  
> Out of scope: 业务协议、DOM 自动化 RPC、Playwright/Puppeteer wrapper、CDP proxy、Renderer/Page 生命周期翻译层。

## 1. Hostra 的整体定位

Hostra 本质上是一个本地 Desktop Host Runtime，而不是业务应用框架，也不是浏览器自动化框架。

```text
npx hostra
   |
   v
Hostra CLI
scripts/hostra.js
   |
   | spawn
   v
Electron Main
main.js
   |
   +-- Host lifecycle authority
   |    +-- BrowserWindow state
   |    +-- HOSTRA_SUBCMD state
   |    +-- shutdown state
   |    +-- sessionId / seq
   |
   +-- Hostra RPC / WebSocket
   |
   +-- CDP endpoint
        |
        v
   Renderer / WebContents
```

CLI 负责配置读取、Electron binary 定位、启动 Electron 和转发最终进程退出；Electron Main 是 Hostra 运行期事实的唯一 authority。

为了说明职责，可以把 Hostra 分成三个 plane：

```text
Bootstrap Plane
  = 启动 Electron、发现最终 endpoint、向调用方报告 ready

Host Control Plane
  = Host / Window / child-process physical lifecycle
  = Hostra RPC over WebSocket

Renderer Debug Plane
  = Renderer / WebContents / Page / DOM / Runtime / Network / Input
  = Chromium DevTools Protocol (CDP)
```

这些 plane 是职责边界，不要求对应独立代码模块、类或抽象层。

## 2. 设计原则

### 2.1 Hostra 只声明自己拥有的物理事实

Hostra 可以负责：

- Electron process；
- `BrowserWindow` 的创建、关闭和物理存在性；
- `HOSTRA_SUBCMD` 子进程的启动与物理生命周期；
- Host shutdown；
- Host RPC；
- RPC/CDP endpoint discovery；
- Host-level lifecycle events；
- Host-level diagnostics。

Hostra 不负责：

- 页面是否业务 ready；
- DOM 状态；
- navigation / load / console / network / JS exception 等 Renderer/Page 事实；
- click/type/evaluate/screenshot 等自动化 API；
- 上层业务协议。

Renderer/WebContents 内部发生了什么，以 CDP 为标准入口。

### 2.2 一份状态，一个事实源

Electron Main 直接拥有 Hostra 的可变运行状态。

第一版不要求引入 `HostRuntime`、`WindowManager`、`SubprocessSupervisor`、`EventBus` 等实体化抽象。

可以直接由 `main.js` 管理类似状态：

```js
const state = {
  sessionId,
  seq: 0,
  shuttingDown: false,
  subprocess: null,
  windows: new Map()
};
```

并通过少量函数完成：

```text
openWindow()
closeWindow()
startSubprocess()
shutdown()
getHostState()
emitLifecycle()
```

只有当某一职责因为真实复杂度、独立测试或复用需要而自然长大时，再抽离模块。

### 2.3 WebSocket 只是 transport

`rpc-server.js` 只负责：

- WebSocket listen；
- token 鉴权；
- JSON-RPC parsing / dispatch；
- response；
- lifecycle notification broadcast；
- close。

Window registry、subprocess state、shutdown state 不应继续由 RPC transport 自己拥有。

### 2.4 Renderer 事实只走 CDP

Hostra RPC 不规划：

```text
window.domReady
window.loaded
window.loadFailed
waitWindowReady()
complex getWindowState()
querySelector()
click()
type()
evaluate()
screenshot()
network inspection
console capture
```

Hostra 只负责 Window 是否存在；Window 内部发生什么由 CDP 观察。

## 3. Endpoint 配置与随机端口

建议支持：

```env
HOSTRA_RPC_PORT=9333
HOSTRA_CDP_PORT=9222
```

并定义：

```env
HOSTRA_RPC_PORT=0
HOSTRA_CDP_PORT=0
```

语义均为：请求动态端口，由运行时选择可用端口，并在 `hostra.ready` 中报告最终 endpoint。

### 3.1 RPC 随机端口

`HOSTRA_RPC_PORT=0` 时，WebSocket server 让 OS 分配端口。

Hostra 必须等待 server 真实进入 listening 状态后读取实际端口，再声明 ready。

### 3.2 CDP 随机端口

`HOSTRA_CDP_PORT=0` 表示请求动态 CDP 端口。

公开 contract 只要求：

```text
HOSTRA_CDP_PORT=0
=> Hostra chooses a usable CDP port
=> caller receives final cdpEndpoint
```

具体实现必须针对 Hostra pinned Electron version 做真实 smoke qualification。

CDP 未配置时默认关闭。

## 4. Bootstrap Plane：直接使用 structured stdout

当前 CLI 启动 Electron 时已经使用继承 stdout/stderr 的方式，因此 endpoint discovery 不需要额外 private IPC、pipe 或 control fd。

推荐链路：

```text
Hostra CLI
   |
   | spawn Electron with inherited stdio
   v
Electron Main
   |
   | after RPC/CDP endpoints are known
   v
structured stdout: hostra.ready
   |
   v
external parent / automation
```

不新增：

```text
HOSTRA_EVENT_PIPE
HOSTRA_CONTROL_FD
private bootstrap protocol
```

Bootstrap Plane 只是职责概念，不需要新的传输层。

## 5. `hostra.ready`

`hostra.ready` 通过 Electron Main 的 structured stdout 输出。

推荐格式：

```text
[hostra:event] {"sessionId":"019c...","seq":1,"type":"hostra.ready","data":{"pid":12345,"rpcEndpoint":"ws://127.0.0.1:43817","cdpEndpoint":"http://127.0.0.1:45122"}}
```

未启用 CDP 时：

```json
{
  "cdpEndpoint": null
}
```

`hostra.ready` 只表示：

- Electron Main 已完成 Hostra 自身初始化；
- RPC 已真实进入 listening 状态；
- 最终 `rpcEndpoint` 已确定；
- 如果启用 CDP，最终 `cdpEndpoint` 已确定并可连接；
- Hostra 已可以接受后续控制。

必须明确：

```text
hostra.ready
!= subprocess.started
!= application.ready
!= page.loaded
```

startup failure 如果发生在 ready 之前，应通过 stderr + non-zero process exit 表达，不强行映射为运行期 lifecycle event。

## 6. Lifecycle Event 基础模型

第一版采用：

```text
Snapshot + ordered best-effort Events
```

事件：

- 不持久化；
- 不重放；
- 不作为 event store；
- 客户端断线重连后重新读取 snapshot。

### 6.1 公共事件 Envelope

运行期事件统一使用 JSON-RPC Notification：

```json
{
  "jsonrpc": "2.0",
  "method": "hostra.event",
  "params": {
    "sessionId": "019c...",
    "seq": 17,
    "type": "window.created",
    "data": {
      "windowId": "main",
      "webContentsId": 3
    }
  }
}
```

第一版公共字段只保留：

| 字段 | 语义 |
|---|---|
| `sessionId` | 每次 Electron Main 启动生成一个新的 session identity |
| `seq` | 当前 session 内严格单调递增的事件序号 |
| `type` | lifecycle event type |
| `data` | 事件特定 payload |

不增加 `eventVersion`。Hostra package major version 本身作为 breaking contract 的版本边界。

不增加公共 `timestamp`。事件顺序只由 `sessionId + seq` 定义；时间戳属于 diagnostics/logging。

### 6.2 `sessionId`

每次 Electron Main 启动生成新的 `sessionId`。

用途：

- 区分 Hostra restart；
- 避免 PID 复用造成歧义；
- 明确 `seq` 只在当前 session 内有效。

不需要跨启动持久化。

### 6.3 `seq`

每个 session 内严格单调递增。

例如：

```text
17 window.created
18 subprocess.started
19 window.closed
20 subprocess.exited
21 host.shuttingDown
```

用途：

- 明确事件先后；
- 自动化断言；
- 发现 observation gap；
- 将 snapshot 与后续 events 对齐。

第一版可以由一个非常小的函数统一完成：

```js
function emitLifecycle(type, data) {
  const event = {
    sessionId: state.sessionId,
    seq: ++state.seq,
    type,
    data
  };
  rpcServer?.notify('hostra.event', event);
  return event;
}
```

不需要独立 EventBus。

## 7. 稳定 WS Lifecycle Events

第一版稳定公共 contract 只冻结 6 个运行期事件：

```text
host.shuttingDown
window.created
window.closed
subprocess.started
subprocess.spawnFailed
subprocess.exited
```

### 7.1 `window.created`

语义：Hostra-owned `BrowserWindow` 已成功创建并进入 Hostra 当前 window registry。

```json
{
  "type": "window.created",
  "data": {
    "windowId": "main",
    "webContentsId": 3
  }
}
```

稳定字段：

- `windowId`：Hostra window identity；
- `webContentsId`：Electron `webContents.id`，作为 Host-level diagnostic identity。

第一版不承诺 `webContentsId` 可以稳定映射到某个 CDP target。

不在事件里复制 `title`、`url`、`width`、`height` 等可查询 metadata，也不携带 Renderer/Page 状态。

### 7.2 `window.closed`

语义：该 Hostra-owned `BrowserWindow` 已关闭并从当前 registry 移除。

```json
{
  "type": "window.closed",
  "data": {
    "windowId": "main",
    "webContentsId": 3
  }
}
```

第一版不定义 window close reason taxonomy。

### 7.3 `subprocess.started`

语义：`HOSTRA_SUBCMD` 已成功 spawn，并有可观察 PID。

```json
{
  "type": "subprocess.started",
  "data": {
    "pid": 23456
  }
}
```

不公开完整 command、argv、env 或 spawn options。

### 7.4 `subprocess.spawnFailed`

语义：Hostra 尝试启动 `HOSTRA_SUBCMD`，但没有得到一个成功进入 running 状态的 subprocess。

```json
{
  "type": "subprocess.spawnFailed",
  "data": {
    "code": "ENOENT",
    "message": "spawn node ENOENT"
  }
}
```

稳定字段只包括：

- `code`；
- `message`。

不公开 stack、完整 Node error object、env 或 spawn options。

### 7.5 `subprocess.exited`

语义：之前成功启动的 `HOSTRA_SUBCMD` 已退出。

```json
{
  "type": "subprocess.exited",
  "data": {
    "pid": 23456,
    "exitCode": 0,
    "signal": null
  }
}
```

被 signal 终止：

```json
{
  "type": "subprocess.exited",
  "data": {
    "pid": 23456,
    "exitCode": null,
    "signal": "SIGTERM"
  }
}
```

不增加 `terminationRequested`。主动 shutdown 与自然退出的区别由事件顺序表达：

```text
Hostra 主动 shutdown:
  host.shuttingDown
  -> subprocess.exited

subprocess 自然退出并触发 Hostra shutdown:
  subprocess.exited
  -> host.shuttingDown { reason: "subprocess-exited" }
```

### 7.6 `host.shuttingDown`

语义：Hostra 已进入 shutdown 状态，后续可能关闭 window、终止 subprocess、关闭 RPC 并退出 Electron process。

```json
{
  "type": "host.shuttingDown",
  "data": {
    "reason": "signal",
    "signal": "SIGTERM"
  }
}
```

第一版 `reason` 保持很小：

```text
signal
subprocess-exited
window-all-closed
requested
error
```

当 `reason = signal` 时可附带：

```text
signal
```

如果 shutdown 由 subprocess 退出触发，不重复复制 subprocess exit details；顺序由 `seq` 表达。

## 8. 明确不提供的 Lifecycle Events

第一版不冻结：

```text
host.rpcClosing
host.exited
window.domReady
window.loaded
window.loadFailed
subprocess.starting
subprocess.terminateRequested
subprocess.forceKillRequested
```

原因：

- `host.rpcClosing` 与 transport close 存在天然 race，收益有限；
- Hostra 真正退出后无法再通过自身 RPC 可靠发送 `host.exited`；
- 最终 process exit code 应由父进程句柄观察；
- Renderer/Page lifecycle 属于 CDP；
- Supervisor 内部动作属于 diagnostics，不应过早冻结成公共 protocol。

## 9. `getHostState()`：只做 lifecycle snapshot

事件不能代替当前状态查询，因为客户端可能在 Hostra 已经运行后才连接。

正式模型：

```text
Snapshot
+
ordered best-effort Events
```

建议新增：

```text
getHostState()
```

第一版只返回与 lifecycle events 对齐的可变状态：

```json
{
  "sessionId": "019c...",
  "seq": 27,
  "host": {
    "state": "running",
    "pid": 12345
  },
  "subprocess": {
    "state": "running",
    "pid": 23456
  },
  "windows": [
    {
      "windowId": "main",
      "webContentsId": 3
    }
  ]
}
```

不把 `getHostState()` 扩张成 `getEverythingAboutHostra()`。

下面这些继续由现有专门 RPC 或 `hostra.ready` 提供，不重复塞进 snapshot：

```text
platform
arch
electronVersion
app paths
rpcEndpoint
cdpEndpoint
window title/url/size
```

要求：

- snapshot 的 `seq` 表示该状态与事件流对齐到哪个 sequence point；
- 不返回 RPC token；
- 不返回完整环境变量；
- 不返回 subprocess command/argv/env。

### 9.1 客户端对齐算法

推荐客户端：

```text
connect WS
-> begin buffering hostra.event
-> call getHostState()
-> receive snapshot.seq = N
-> discard buffered events with seq <= N
-> apply buffered/new events with seq > N in order
```

这样无需 event persistence、replay log 或 subscribe-from-seq。

## 10. Transport Delivery Semantics

WS lifecycle events 定义为：

```text
ordered
best-effort
non-persistent
non-replayable
```

同一个 WebSocket connection 上必须保持 `seq` 发送顺序。

客户端断线重连后：

- Hostra 不重放断线期间 events；
- 客户端重新调用 `getHostState()`；
- 新 session 使用新的 `sessionId`；
- 若检测到 `sessionId` 变化，应视为 Hostra 已重启并丢弃旧 session 的 sequence context。

## 11. CDP 边界

Hostra 只负责开放 CDP endpoint，不代理 CDP。

启用 CDP 后，标准 CDP client、Playwright、Puppeteer 或其它工具可以负责：

- target enumeration；
- JavaScript evaluation；
- DOM inspection；
- console capture；
- network inspection；
- Page lifecycle；
- navigation diagnostics；
- input dispatch；
- screenshot。

初版不增加：

```text
getCdpTargetId(windowId)
attachCdp(windowId)
evaluateInWindow(windowId, script)
```

也不冻结 `webContentsId -> CDP target` 映射 contract。

第一版 CDP qualification 只验证：

```text
Hostra boots
-> CDP enabled
-> create fixture BrowserWindow
-> connect CDP
-> enumerate renderer target
-> evaluate/read known fixture marker
```

多窗口精确 target correlation 等出现真实需求后再单独设计最小机制。

## 12. Electron 版本确定性

Hostra release 应固定默认 Electron version，而不是安装时查询 `electron/latest`。

可以允许显式 override：

```env
HOSTRA_ELECTRON_VERSION=<version>
```

优先级：

```text
explicit HOSTRA_ELECTRON_VERSION
    > package pinned Electron version
```

不保留默认 `latest` fallback。

## 13. 实现形态

第一版优先保持现有文件结构，不新增不必要模块：

```text
scripts/hostra.js
  = CLI / env / spawn Electron / exit forwarding

main.js
  = Host state authority
  = window / subprocess / seq / session / shutdown
  = structured hostra.ready

rpc-server.js
  = WebSocket / auth / JSON-RPC dispatch / notification broadcast

CDP
  = Electron / Chromium native capability
```

第一版明确不要求新增：

```text
host-runtime.js
window-manager.js
subprocess-supervisor.js
event-bus.js
bootstrap-channel.js
lifecycle-store.js
protocol-version.js
```

只有真实复杂度出现后再抽离。

## 14. 自动化 Qualification

Hostra 自身至少覆盖：

### 14.1 Endpoint discovery

```text
spawn Hostra
-> RPC port=0
-> optional CDP port=0
-> receive hostra.ready from stdout
-> endpoints contain actual assigned ports
-> RPC/CDP can connect
```

### 14.2 Lifecycle ordering

验证：

```text
window.created
window.closed
subprocess.started
subprocess.exited
host.shuttingDown
```

事件拥有相同 `sessionId`，`seq` 严格单调递增。

### 14.3 Snapshot alignment

验证：

```text
connect WS
-> buffer events
-> getHostState
-> reconcile by seq
```

结果与 Electron Main 当前真实状态一致。

### 14.4 CDP

```text
Hostra boots
-> CDP enabled
-> create local BrowserWindow
-> enumerate target
-> evaluate/read known fixture marker
```

目标是验证 Hostra 的 CDP endpoint 可用，不测试 CDP 协议本身，也不在第一版冻结多窗口 target mapping。

### 14.5 Subprocess shutdown convergence

验证：

- subprocess 正常退出；
- subprocess spawn failure；
- Hostra shutdown 后 graceful termination；
- 必要时 force-kill fallback；
- 最终 Hostra process exit 由父进程句柄观察。

force-kill 细节属于 diagnostics，不要求成为公共 lifecycle event。

## 15. 建议实施顺序

### Phase A — Deterministic bootstrap

1. pinned Electron version；
2. `HOSTRA_RPC_PORT=0`；
3. `HOSTRA_CDP_PORT` 与动态端口 qualification；
4. `hostra.ready` structured stdout。

### Phase B — State ownership

5. Window registry 从 `rpc-server.js` 移到 `main.js`；
6. subprocess state 统一放在 `main.js`；
7. `sessionId` / `seq`；
8. `emitLifecycle()`；
9. `rpc-server.js` 增加 notification broadcast，但不拥有 lifecycle facts。

### Phase C — Public lifecycle contract

10. `window.created` / `window.closed`；
11. `subprocess.started` / `spawnFailed` / `exited`；
12. `host.shuttingDown`；
13. `getHostState()`；
14. ordered best-effort notification semantics。

### Phase D — Qualification

15. endpoint discovery smoke；
16. lifecycle ordering tests；
17. snapshot/event reconciliation tests；
18. CDP smoke；
19. subprocess shutdown convergence tests。

## 16. 第一版完成标准

Hostra 可认为具备 Endpoint Discovery + Lifecycle Observability baseline，当以下链路稳定通过：

```text
spawn Hostra
-> stdout reports hostra.ready
-> caller receives actual RPC/CDP endpoints
-> connect Hostra RPC
-> getHostState snapshot
-> create/close BrowserWindow and observe ordered events
-> start/exit subprocess and observe ordered events
-> enter shutdown and observe host.shuttingDown
-> connect CDP and inspect Renderer target
-> parent observes final Hostra process exit
```

并满足：

- Electron Main 是运行期事实的唯一 authority；
- `rpc-server.js` 只是 transport；
- Bootstrap 不新增私有 IPC/pipe protocol；
- lifecycle event envelope 只有 `sessionId + seq + type + data`；
- 事件 ordered / best-effort / non-persistent / non-replayable；
- reconnect 通过 `getHostState()` 恢复；
- `getHostState()` 只返回 lifecycle mutable state；
- Renderer/Page 事实只通过 CDP；
- Hostra 不代理 CDP；
- 第一版不冻结 CDP target mapping；
- 相同 Hostra version 默认使用相同 Electron version；
- 第一版不为尚未出现的复杂度预建额外抽象层。
