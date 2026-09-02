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
Hostra CLI / Bootstrap
scripts/hostra.js
   |
   | spawn
   v
Electron Main Process
   |
   +-- Host Runtime
   |    +-- BrowserWindow ownership
   |    +-- HOSTRA_SUBCMD ownership
   |    +-- shutdown ownership
   |    +-- Host state / lifecycle facts
   |
   +-- Hostra RPC / WebSocket
   |
   +-- CDP endpoint
        |
        v
   Renderer / WebContents
```

CLI 层负责配置读取、Electron binary 定位和进程启动；Electron Main 才是 Hostra 运行期事实的 authority。

Hostra 应明确分成三个 plane：

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

## 2. 设计原则

### 2.1 Hostra 只声明自己拥有的物理事实

Hostra 可以负责：

- Electron process；
- `BrowserWindow` 的创建、关闭和物理存在性；
- `HOSTRA_SUBCMD` 子进程的启动与物理生命周期；
- Host shutdown；
- Host RPC；
- RPC/CDP endpoint discovery；
- Host-level diagnostics；
- Host-level lifecycle events。

Hostra 不负责：

- 页面是否业务 ready；
- DOM 状态；
- navigation / load / console / network / JS exception 等 Renderer/Page 事实；
- click/type/evaluate/screenshot 等自动化 API；
- 上层业务协议。

Renderer/WebContents 内部发生了什么，以 CDP 为标准入口。

### 2.2 生命周期事实属于 Host Runtime，不属于 WebSocket

WebSocket 只是 transport adapter。

```text
HostRuntime
   |
   +-- WindowManager
   +-- SubprocessSupervisor
   +-- HostState
   +-- EventBus / sequence
           |
           v
      HostRpcServer
           |
           v
       WebSocket clients
```

例如：

```text
BrowserWindow closes
   -> WindowManager updates state
   -> HostRuntime emits window.closed
   -> EventBus assigns seq
   -> WebSocket adapter broadcasts notification
```

不要让 `rpc-server.js` 本身成为 Host 生命周期事实源。

### 2.3 Renderer 事实只走 CDP

引入 CDP 后，Hostra RPC 不再规划：

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

同时定义：

```env
HOSTRA_RPC_PORT=0
HOSTRA_CDP_PORT=0
```

语义均为：请求动态端口，由运行时选择可用端口，并通过 Bootstrap Plane 报告最终 endpoint。

### 3.1 RPC 随机端口

`HOSTRA_RPC_PORT=0` 时，WebSocket server 应让 OS 分配端口。

Hostra 必须等待 server 真正进入 listening 状态后读取实际端口，再声明 ready。

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

## 4. Bootstrap Plane

运行期 lifecycle event 走 WebSocket，但 endpoint discovery 不能依赖 WebSocket 本身。

当：

```text
HOSTRA_RPC_PORT=0
```

调用方在启动前不知道 WS 地址，因此 `hostra.ready` 必须通过独立 bootstrap path 传递。

推荐：

```text
Hostra CLI
   |
   | private bootstrap IPC / pipe
   v
Electron Main
```

内部 bootstrap IPC 不作为公开 Hostra API，不增加 `HOSTRA_EVENT_PIPE`、`HOSTRA_CONTROL_FD` 等用户配置，也不要求 `HOSTRA_SUBCMD` 继承特殊 fd。

规则：

```text
Bootstrap discovery
  -> private CLI <-> Electron Main IPC / pipe
  -> structured stdout for external parent

Runtime lifecycle
  -> WebSocket JSON-RPC notifications
```

## 5. Lifecycle Event 基础模型

第一版 lifecycle contract 采用：

```text
Snapshot + ordered best-effort Events
```

事件不持久化、不重放；客户端重连后重新读取 snapshot。

### 5.1 公共事件 Envelope

运行期生命周期事件统一使用 JSON-RPC Notification：

```json
{
  "jsonrpc": "2.0",
  "method": "hostra.event",
  "params": {
    "eventVersion": 1,
    "sessionId": "019c...",
    "seq": 17,
    "timestamp": "2026-09-02T02:41:12.345Z",
    "type": "window.created",
    "data": {
      "windowId": "main",
      "webContentsId": 3
    }
  }
}
```

公共字段：

| 字段 | 语义 |
|---|---|
| `eventVersion` | lifecycle event schema 版本，第一版固定为 `1` |
| `sessionId` | 每次 Electron Host 启动生成一个新的 session identity |
| `seq` | 当前 session 内严格单调递增的事件序号 |
| `timestamp` | UTC ISO-8601 时间，仅用于诊断 |
| `type` | lifecycle event type |
| `data` | 事件特定 payload |

事件排序与一致性依赖：

```text
sessionId + seq
```

不依赖 `timestamp`。

### 5.2 `sessionId`

每次 Hostra Electron Main 启动生成新的 `sessionId`。

用途：

- 区分 Hostra restart；
- 避免 PID 复用造成歧义；
- 明确 `seq` 只在当前 session 内有效。

`sessionId` 不需要跨启动持久化。

### 5.3 `seq`

每个 session 内从一个固定初值开始严格单调递增。

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

## 6. Bootstrap Event：`hostra.ready`

`hostra.ready` 属于 Bootstrap Plane，不属于 WS lifecycle stream 的首次发现机制。

推荐结构：

```json
{
  "eventVersion": 1,
  "sessionId": "019c...",
  "seq": 1,
  "type": "hostra.ready",
  "data": {
    "pid": 12345,
    "rpcEndpoint": "ws://127.0.0.1:43817",
    "cdpEndpoint": "http://127.0.0.1:45122"
  }
}
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
- Host Runtime 已可以接受控制。

必须明确：

```text
hostra.ready
!= subprocess.started
!= application.ready
!= page.loaded
```

CLI 对外可输出稳定的 structured record，例如：

```text
[hostra:event] {"eventVersion":1,"sessionId":"...","seq":1,"type":"hostra.ready","data":{...}}
```

## 7. 稳定 WS Lifecycle Events

第一版稳定公共 contract 建议只冻结 6 个运行期事件：

```text
host.shuttingDown
window.created
window.closed
subprocess.started
subprocess.spawnFailed
subprocess.exited
```

### 7.1 `window.created`

语义：Hostra-owned `BrowserWindow` 已成功创建并进入 Host Runtime registry。

```json
{
  "type": "window.created",
  "data": {
    "windowId": "main",
    "webContentsId": 3
  }
}
```

字段：

- `windowId`: Hostra window identity；
- `webContentsId`: Electron `webContents.id`，用于诊断和 CDP target correlation。

不在事件里复制 `title`、`url`、`width`、`height` 等可查询 metadata，也不携带 Renderer/Page 状态。

### 7.2 `window.closed`

语义：该 Hostra-owned `BrowserWindow` 已关闭并从 Host Runtime registry 移除。

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

不公开完整 command、argv、env 或 spawn options，避免泄漏敏感配置和绑定 Node 内部实现。

### 7.4 `subprocess.spawnFailed`

语义：Hostra 尝试启动 `HOSTRA_SUBCMD`，但没有得到一个成功进入 running 状态的 subprocess。

```json
{
  "type": "subprocess.spawnFailed",
  "data": {
    "error": {
      "code": "ENOENT",
      "message": "spawn node ENOENT"
    }
  }
}
```

稳定字段仅包括：

- `error.code`；
- `error.message`。

不公开 stack、完整 Node error object、env 或 spawn options。

### 7.5 `subprocess.exited`

语义：之前成功启动的 `HOSTRA_SUBCMD` 已退出。

正常退出：

```json
{
  "type": "subprocess.exited",
  "data": {
    "pid": 23456,
    "exitCode": 0,
    "signal": null,
    "terminationRequested": false
  }
}
```

被终止：

```json
{
  "type": "subprocess.exited",
  "data": {
    "pid": 23456,
    "exitCode": null,
    "signal": "SIGTERM",
    "terminationRequested": true
  }
}
```

字段：

- `pid`: subprocess PID；
- `exitCode`: 正常退出码，若由 signal 终止则为 `null`；
- `signal`: 终止 signal，否则为 `null`；
- `terminationRequested`: 在退出事实发生前，Hostra 是否已经进入针对该 subprocess 的 termination 流程。

`terminationRequested` 用于区分自然退出与 Hostra 主动 shutdown convergence。

下面这些只作为 Supervisor diagnostic，不冻结为公共 lifecycle event：

```text
subprocess.starting
subprocess.terminateRequested
subprocess.forceKillRequested
```

### 7.6 `host.shuttingDown`

语义：Host Runtime 已进入 shutdown 状态，后续可能关闭 window、终止 subprocess、关闭 RPC 并退出 Electron process。

```json
{
  "type": "host.shuttingDown",
  "data": {
    "reason": "signal",
    "signal": "SIGTERM"
  }
}
```

建议第一版 `reason` 枚举保持很小：

```text
signal
subprocess-exited
window-all-closed
startup-failure
requested
internal-error
```

当 `reason = signal` 时可附带：

```text
signal
```

如果 shutdown 由 subprocess 退出触发，不重复复制 subprocess exit details；顺序由 `seq` 表达：

```text
21 subprocess.exited
22 host.shuttingDown { reason: "subprocess-exited" }
```

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

## 9. Snapshot + Events

事件不能代替当前状态查询，因为客户端可能在 Hostra 已经运行后才连接。

正式模型：

```text
Snapshot
+
ordered best-effort Events
```

### 9.1 `getHostState()`

建议新增：

```text
getHostState()
```

示例：

```json
{
  "sessionId": "019c...",
  "seq": 27,
  "host": {
    "state": "running",
    "pid": 12345,
    "platform": "win32",
    "arch": "x64",
    "electronVersion": "..."
  },
  "rpcEndpoint": "ws://127.0.0.1:43817",
  "cdpEndpoint": "http://127.0.0.1:45122",
  "subprocess": {
    "configured": true,
    "state": "running",
    "pid": 23456
  },
  "windows": [
    {
      "windowId": "main",
      "webContentsId": 3,
      "title": "Example",
      "url": "http://127.0.0.1:4174/"
    }
  ]
}
```

要求：

- 不返回 RPC token；
- 不返回完整环境变量；
- 不返回 subprocess command/argv/env；
- snapshot 的 `seq` 表示该状态与事件流对齐到哪个 sequence point。

### 9.2 客户端对齐算法

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

## 11. Window 与 CDP Target 关联

Hostra RPC 只提供足够的 Host-level correlation 信息，不代理 CDP。

建议 `getHostState()` / `getAllWindows()` 至少返回：

```text
windowId
webContentsId
```

可额外包含当前 `title` / `url` 作为诊断 metadata。

推荐关系：

```text
Hostra windowId
    -> webContentsId / URL / title
    -> CDP enumerate targets
    -> tooling resolves target
```

初版不增加：

```text
getCdpTargetId(windowId)
attachCdp(windowId)
evaluateInWindow(windowId, script)
```

如果未来 `webContentsId` 无法稳定用于 target correlation，再单独设计最小映射能力。

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

## 13. 自动化 Qualification

Hostra 自身至少应覆盖：

### 13.1 Bootstrap / endpoint

```text
spawn Hostra
-> RPC port=0
-> optional CDP port=0
-> receive hostra.ready
-> endpoints contain actual assigned ports
-> RPC/CDP can connect
```

### 13.2 Lifecycle ordering

验证：

```text
window.created
window.closed
subprocess.started
subprocess.exited
host.shuttingDown
```

事件拥有相同 `sessionId`，`seq` 严格单调递增。

### 13.3 Snapshot alignment

验证：

```text
connect WS
-> buffer events
-> getHostState
-> reconcile by seq
```

结果与 Host Runtime 实际状态一致。

### 13.4 CDP

```text
Hostra boots
-> CDP enabled
-> create local BrowserWindow
-> enumerate target
-> correlate target
-> evaluate/read known fixture marker
```

目标是验证 Hostra 的 CDP endpoint 与 target correlation，不测试 CDP 协议本身。

### 13.5 Subprocess shutdown convergence

验证正常退出、Hostra shutdown 后 graceful termination，以及必要时 force-kill fallback；force-kill 细节作为 diagnostics 验证，不要求成为公共 lifecycle event。

## 14. 建议实施顺序

### Phase A — Endpoint Discovery

1. `HOSTRA_RPC_PORT=0`；
2. `HOSTRA_CDP_PORT` 与可 qualification 的动态端口；
3. CLI <-> Electron Main private bootstrap IPC；
4. `hostra.ready` structured record；
5. pinned Electron version。

### Phase B — Host Runtime Facts

6. 引入 `HostRuntime` state ownership；
7. Window registry 从 RPC transport 中抽离；
8. SubprocessSupervisor；
9. session-local `sessionId` / `seq`；
10. EventBus。

### Phase C — Public Lifecycle Contract

11. `window.created` / `window.closed`；
12. `subprocess.started` / `spawnFailed` / `exited`；
13. `host.shuttingDown`；
14. `getHostState()`；
15. WS ordered best-effort notification semantics。

### Phase D — Qualification

16. endpoint discovery smoke；
17. lifecycle ordering tests；
18. snapshot/event reconciliation tests；
19. CDP target correlation smoke；
20. subprocess shutdown convergence tests。

## 15. 第一版完成标准

Hostra 可认为具备 Endpoint Discovery + Lifecycle Observability baseline，当以下链路稳定通过：

```text
spawn Hostra
-> private bootstrap IPC reports ready
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

- 生命周期事实由 Host Runtime 拥有，而不是 WebSocket transport；
- runtime lifecycle 统一走 WS JSON-RPC Notification；
- bootstrap endpoint discovery 走 private IPC / pipe；
- lifecycle events 有 `eventVersion + sessionId + seq + timestamp + type + data`；
- 事件 ordered / best-effort / non-persistent / non-replayable；
- reconnect 通过 `getHostState()` 恢复；
- Renderer/Page 事实只通过 CDP；
- Hostra 不代理 CDP；
- 相同 Hostra version 默认使用相同 Electron version。
