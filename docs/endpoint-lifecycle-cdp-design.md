# Hostra Endpoint Discovery、Lifecycle Observability 与 CDP 设计

> Status: **Frozen / Ready for Implementation**  
> Frozen: **2026-09-02**  
> Scope: Hostra 的 endpoint discovery、Host 生命周期可观测性、CDP 调试入口、Electron 版本确定性，以及对应的最小 qualification。  
> Contract rule: 本文冻结第一版公共语义；实现可以调整内部 helper 与文件内组织，但不得改变本文定义的可观察行为。

## 1. 定位与边界

Hostra 是本地 Desktop Host Runtime，不是业务应用框架，也不是浏览器自动化框架。

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

职责分成三个 plane：

```text
Bootstrap Plane
  = 启动 Electron、发现最终 endpoint、报告 hostra.ready

Host Control Plane
  = Host / Window / child-process physical lifecycle
  = Hostra RPC over WebSocket

Renderer Debug Plane
  = Renderer / WebContents / Page / DOM / Runtime / Network / Input
  = Chromium DevTools Protocol (CDP)
```

这些 plane 只是职责边界，不要求对应独立模块、类或抽象层。

Hostra 只声明自己拥有的物理事实。Hostra 不提供页面业务 ready、DOM、navigation/load、console/network、JS exception、click/type/evaluate/screenshot 等 Renderer/Page 语义；这些全部由 CDP 或建立在 CDP 之上的标准工具负责。

## 2. 第一版实现形态

第一版保持现有文件结构：

```text
scripts/hostra.js
  = CLI / env / spawn Electron / exit forwarding

main.js
  = Host state authority
  = window / subprocess / session / seq / shutdown
  = hostra.ready structured stdout

rpc-server.js
  = WebSocket listen / auth / JSON-RPC dispatch
  = lifecycle notification broadcast

scripts/download-electron.js
  = deterministic Electron installation

CDP
  = Electron / Chromium native capability
```

第一版不新增下列架构层：

```text
host-runtime.js
window-manager.js
subprocess-supervisor.js
event-bus.js
bootstrap-channel.js
lifecycle-store.js
protocol-version.js
```

Window registry、subprocess state、shutdown state 从 RPC transport 移到 `main.js`。`rpc-server.js` 不拥有 lifecycle facts。

只有当真实复杂度、独立测试或复用需求出现后，才允许从上述职责中抽离新模块。

## 3. 运行状态与唯一事实源

Electron Main 是运行期唯一事实源。第一版可以直接维护一个小型状态对象：

```js
const state = {
  sessionId: crypto.randomUUID(),
  seq: 0,
  shuttingDown: false,
  shutdownReason: null,
  subprocess: null,
  windows: new Map()
};
```

公共 lifecycle sequence 从 `0` 开始；只有 WS runtime lifecycle event 会递增 `seq`。`hostra.ready` 不参与 runtime `seq`。

## 4. Public Configuration

### 4.1 RPC

```text
HOSTRA_RPC_PORT unset
  -> 9333

HOSTRA_RPC_PORT = positive integer
  -> 使用指定固定端口

HOSTRA_RPC_PORT = 0
  -> 由 OS 分配 ephemeral port
```

RPC server 必须显式绑定：

```text
127.0.0.1
```

最终 endpoint 统一表达为：

```text
ws://127.0.0.1:<actual-port>
```

固定 RPC 端口 bind 失败属于 startup failure。

`HOSTRA_RPC_TOKEN` 语义保持现状；token 不出现在 `hostra.ready`、snapshot 或 lifecycle event 中。

### 4.2 CDP

```text
HOSTRA_CDP_PORT unset
  -> CDP disabled

HOSTRA_CDP_PORT = positive integer
  -> 使用指定固定端口

HOSTRA_CDP_PORT = 0
  -> Chromium 选择 ephemeral port
```

Hostra 使用 Electron/Chromium 原生 `--remote-debugging-port`，不实现 CDP proxy。

最终 endpoint 统一表达为：

```text
http://127.0.0.1:<actual-port>
```

固定 CDP 端口在启动前必须确认 `127.0.0.1:<port>` 当前可绑定；已被占用时直接 startup failure，不得把已有进程的 `/json/version` 误认为当前 Hostra 的 CDP endpoint。

Hostra 在声明 ready 前必须验证自己的 `/json/version` 可访问。

### 4.3 Electron version

第一版默认 Electron baseline 固定为：

```text
44.1.1
```

source of truth 放在 `packages/hostra/package.json`：

```json
{
  "hostra": {
    "electronVersion": "44.1.1"
  }
}
```

下载脚本读取该固定版本，不再查询 `electron/latest`。

允许安装期显式 override：

```text
HOSTRA_ELECTRON_VERSION=<exact-version>
```

优先级：

```text
HOSTRA_ELECTRON_VERSION
  > package.json hostra.electronVersion
```

该变量只影响 Electron 安装；运行时不会自动切换已安装 binary。默认路径不存在 `latest` fallback。

## 5. CDP 动态端口发现

当 `HOSTRA_CDP_PORT=0`：

1. Hostra 在 Electron ready 前设置 `--remote-debugging-port=0`；
2. Hostra 使用当前 Electron `userData` 目录中的 `DevToolsActivePort` 作为唯一动态端口发现来源；
3. 启动前删除同目录中的 stale `DevToolsActivePort`；
4. `app.whenReady()` 后等待新的 `DevToolsActivePort`；
5. 第一行解析为实际 port；
6. Hostra 请求 `http://127.0.0.1:<port>/json/version` 进行可用性验证；
7. 验证成功后才允许进入 `hostra.ready`。

固定 CDP 端口同样必须通过 `/json/version` 验证。

CDP endpoint discovery 的内部等待上限固定为 **10 秒**。超时属于 startup failure：写 stderr，Hostra 以 non-zero exit 结束，不输出 `hostra.ready`。

第一版不冻结 `webContentsId -> CDP target` 映射，也不增加：

```text
getCdpTargetId(windowId)
attachCdp(windowId)
evaluateInWindow(windowId, script)
```

CDP qualification 只要求能够枚举 Renderer target 并对 fixture 执行已知 marker。

## 6. 冻结启动顺序

Hostra 启动顺序固定为：

```text
Electron Main starts
-> apply userData path
-> preflight fixed CDP port when configured
-> configure CDP switch when enabled
-> app.whenReady()
-> bind RPC on 127.0.0.1
-> wait RPC listening
-> resolve actual RPC port
-> resolve and verify actual CDP endpoint when enabled
-> write effective HOSTRA_RPC_PORT / HOSTRA_CDP_PORT back to process.env
-> emit structured stdout hostra.ready
-> start HOSTRA_SUBCMD when configured
-> emit subprocess.started or subprocess.spawnFailed
```

动态端口必须在 child spawn 前回写环境：

```text
input HOSTRA_RPC_PORT=0
-> actual RPC port = 43817
-> process.env.HOSTRA_RPC_PORT = "43817"
-> HOSTRA_SUBCMD inherits "43817"
```

CDP 同理。CDP 未启用时不新增有效 `HOSTRA_CDP_PORT`。

`hostra.ready` 与 subprocess readiness 明确分离：

```text
hostra.ready
!= subprocess.started
!= application.ready
!= page.loaded
```

### 6.1 Startup failure invariant

在 `hostra.ready` 之前发生以下任一情况时：

```text
app.whenReady failure
fixed CDP port already occupied
RPC bind/listen failure
CDP endpoint discovery/verification failure
```

Hostra 必须：

```text
write diagnostic to stderr
-> do not emit hostra.ready
-> do not spawn HOSTRA_SUBCMD
-> exit non-zero
```

startup failure 不进入 runtime lifecycle stream。

## 7. `hostra.ready`

`hostra.ready` 由 Electron Main 直接写 structured stdout；CLI 当前继承 stdout/stderr，因此不引入 private pipe、IPC protocol 或 control fd。

固定输出形态：

```text
[hostra:event] {"sessionId":"019c...","type":"hostra.ready","data":{"pid":12345,"rpcEndpoint":"ws://127.0.0.1:43817","cdpEndpoint":"http://127.0.0.1:45122"}}
```

CDP disabled：

```json
{
  "cdpEndpoint": null
}
```

每个 Electron Main session 最多输出一次 `hostra.ready`。

## 8. Runtime Lifecycle Event Contract

运行期生命周期事件使用现有 WebSocket JSON-RPC Notification：

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

第一版 envelope 只包含：

```text
sessionId
seq
type
data
```

不增加 `eventVersion`；Hostra package major version 是 breaking contract 的版本边界。

不增加公共 timestamp；时间只属于 diagnostics/logging。

事件 transport 语义固定为：

```text
ordered
best-effort
non-persistent
non-replayable
```

同一个 WebSocket connection 上按 `seq` 顺序发送。断线重连后 Hostra 不重放旧事件，客户端重新读取 snapshot。

## 9. State / Event 一致性不变量

所有代表状态变化的 lifecycle event 必须遵守：

```text
1. 同步提交 state mutation
2. ++state.seq
3. 构造该 seq 的 event
4. broadcast notification
```

在同一个 Electron Main event-loop turn 内，state mutation 与 seq allocation 之间不得存在可观察的异步间隙。

因此：

> `getHostState().seq = N` 表示 snapshot 已包含所有 `seq <= N` 的状态变化。

`getHostState()` 必须在一个同步读取段内复制 `seq` 与 lifecycle state，不在构造 snapshot 的中途等待异步操作。

notification broadcast 失败不会回滚 state 或 seq。

非持久化事实事件（例如 `subprocess.spawnFailed`）可能不会体现在后续 snapshot 中；snapshot 用于恢复**当前状态**，不是恢复历史。

## 10. 冻结 Lifecycle Events

第一版只冻结 6 个 runtime lifecycle event。

### 10.1 `window.created`

触发点：`BrowserWindow` 已创建成功，并已经加入 Hostra window registry。

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

```text
windowId
webContentsId
```

`webContentsId` 只是 Electron diagnostic identity；第一版不承诺它可以直接映射 CDP target。

### 10.2 `window.closed`

触发点：Electron `BrowserWindow` 的 `closed` 事实已经发生，并且 registry 已经移除该 window。

```json
{
  "type": "window.closed",
  "data": {
    "windowId": "main",
    "webContentsId": 3
  }
}
```

`closeWindow()` 只发起 `win.close()`；不得提前从 registry 删除，也不得提前发送 `window.closed`。最终关闭事实只有 `closed` handler 可以提交。

`closeWindow()` 返回 `true` 仅表示关闭请求已被接受，不表示窗口已经物理关闭。真实关闭以 `window.closed` 或后续 snapshot 为准。

第一版不定义 window close reason taxonomy。

### 10.3 `subprocess.started`

触发点：Node ChildProcess 已触发成功的 `spawn` event。

```json
{
  "type": "subprocess.started",
  "data": {
    "pid": 23456
  }
}
```

在 `spawn` event 前，公开 snapshot 中 `subprocess` 仍为 `null`。

### 10.4 `subprocess.spawnFailed`

触发点：ChildProcess 在成功 `spawn` 前触发 `error`。

```json
{
  "type": "subprocess.spawnFailed",
  "data": {
    "code": "ENOENT",
    "message": "spawn node ENOENT"
  }
}
```

该事件之后 Hostra 必须进入：

```text
host.shuttingDown { reason: "error" }
```

不公开 stack、env、argv、spawn options 或完整 Node error object。

成功 `spawn` 后发生的 ChildProcess `error` 不再定义为 `spawnFailed`；它作为 diagnostics/error path 处理，并进入 first-wins `shutdown("error")`。

### 10.5 `subprocess.exited`

触发点：之前成功 `spawn` 的 ChildProcess 触发 `exit`。

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

signal termination：

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

提交事件前先将公开 `subprocess` state 置为 `null`。

如果 Hostra 当时尚未进入 shutdown，subprocess exit 随后触发：

```text
host.shuttingDown { reason: "subprocess-exited" }
```

不增加 `terminationRequested`；主动 shutdown 与自然退出由事件顺序表达。

### 10.6 `host.shuttingDown`

Hostra runtime shutdown 是 first-wins、idempotent transition。

第一次调用 shutdown：

```text
state.shuttingDown = true
state.shutdownReason = reason
-> seq++
-> host.shuttingDown
```

后续任何 shutdown request 不覆盖 reason，不重复发送 `host.shuttingDown`。

稳定 reason 只有：

```text
signal
subprocess-exited
window-all-closed
error
```

signal 示例：

```json
{
  "type": "host.shuttingDown",
  "data": {
    "reason": "signal",
    "signal": "SIGTERM"
  }
}
```

其它 reason 只携带 `reason`。

`window-all-closed` 仅在该 Electron platform 的现有 Hostra policy 确实因此退出时触发；macOS 保持现有“不因 window-all-closed 自动退出”的行为。

## 11. 明确不提供的 Runtime Events

第一版不提供：

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

- RPC close 是 transport fact，不是 Host lifecycle API；
- process 真正退出由父进程句柄观察；
- Renderer/Page lifecycle 属于 CDP；
- Supervisor 内部动作属于 diagnostics。

## 12. `getHostState()` Lifecycle Snapshot

新增 RPC：

```text
getHostState()
```

第一版固定 schema：

```json
{
  "sessionId": "019c...",
  "seq": 27,
  "host": {
    "state": "running",
    "pid": 12345
  },
  "subprocess": {
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

`host.state` 只有：

```text
running
shutting-down
```

没有当前成功运行的 `HOSTRA_SUBCMD` 时：

```json
{
  "subprocess": null
}
```

snapshot 只表达当前 mutable lifecycle state，不表达历史，也不扩张成 `getEverythingAboutHostra()`。

以下信息不重复放入 snapshot：

```text
platform
arch
electronVersion
app paths
rpcEndpoint
cdpEndpoint
window title/url/size
```

这些继续由现有专门 RPC、`getAllWindows()` 或 `hostra.ready` 提供。

### 12.1 Snapshot / Event 对齐

客户端需要无缝开始观察时：

```text
connect WS
-> begin buffering hostra.event
-> call getHostState()
-> receive snapshot.seq = N
-> discard buffered events with seq <= N
-> apply buffered/new events with seq > N in order
```

如果 `sessionId` 改变，客户端必须丢弃旧 session 的 sequence context，并重新读取 snapshot。

Hostra 不实现 replay log、subscribe-from-seq 或 event persistence。

## 13. Shutdown Convergence

Host Control Plane 在 shutdown convergence 完成前保持可用；RPC 是最后关闭的 **control-plane transport**。CDP 不由 Hostra 单独关闭，它随 Electron process 结束。

冻结 shutdown 顺序：

```text
first shutdown request
-> commit shutting-down state
-> emit host.shuttingDown
-> reject creation of new Hostra-owned resources
-> request all BrowserWindow close
-> request subprocess SIGTERM when present
-> observe window.closed / subprocess.exited
-> after all Hostra-owned windows and subprocess have converged
-> close RPC
-> app.quit()
```

一旦 `host.state = shutting-down`：

- `openWindow()` 必须拒绝，使用现有 `-32602` 类错误，message 固定为 `Host is shutting down`；
- `closeWindow()` 对仍存在的 window 继续允许；
- `getVersion/getPlatform/getArch/getAppPath/getAllWindows/getHostState` 等只读 RPC 继续允许，直到 RPC transport 关闭；
- 不允许创建新的 Hostra-owned runtime resource。

为了避免 renderer 或 child process 阻止 Hostra 永久退出，内部 grace period 固定为：

```text
1000 ms
```

在 grace period 后仍未收敛：

```text
remaining BrowserWindow -> destroy()
remaining subprocess    -> SIGKILL
```

这些 force-convergence 动作只写 diagnostics，不增加公共 lifecycle event。

当 window registry 为空且 `subprocess === null` 时，shutdown convergence 完成，可以立即关闭 RPC 并退出，无需等待 grace timer；已启动的 grace timer 必须取消。

最终 Hostra process exit 与 exit code 由 `scripts/hostra.js` 的 Electron child process handle / Hostra 的外部父进程观察，不通过 WS 发送 `host.exited`。

## 14. Existing RPC Compatibility

本轮改造必须保持现有 RPC source compatibility：

```text
getVersion
getPlatform
getArch
getAppPath
openWindow
closeWindow
getAllWindows
```

具体要求：

- `openWindow()` 第一版继续返回原有 `windowId: string`；
- `closeWindow()` 继续返回布尔 `true`，其含义固定为“关闭请求已接受”；
- `getAllWindows()` 保留现有字段，并 additive 增加 `webContentsId`；
- RPC token 鉴权方式保持不变；
- 默认 RPC port 继续是 `9333`。

新增公共能力只有：

```text
HOSTRA_RPC_PORT=0
HOSTRA_CDP_PORT
HOSTRA_CDP_PORT=0
HOSTRA_ELECTRON_VERSION (install-time)
hostra.ready structured stdout
hostra.event notifications
getHostState()
```

## 15. Non-goals / Deferred

本轮明确不做：

```text
多 Hostra instance 并行隔离
自动生成独立 userData / instance namespace
CDP proxy
Playwright/Puppeteer wrapper
DOM automation RPC
业务 application.ready protocol
window -> CDP target 精确映射 contract
event persistence / replay
public shutdown RPC
复杂 lifecycle reason taxonomy
额外 manager / supervisor / event-bus 架构层
```

现有 single-instance policy 不因本轮改造而改变。

## 16. Qualification Matrix

冻结设计实现完成后必须覆盖以下真实行为。

### 16.1 Deterministic Electron

```text
install same Hostra version twice
-> default Electron version identical
-> equals package pinned version
```

安装期 `HOSTRA_ELECTRON_VERSION` override 单独验证。

### 16.2 RPC endpoint

```text
RPC fixed port
RPC port=0
```

两种场景均验证：

```text
bind 127.0.0.1
-> actual endpoint reported
-> RPC accepts authenticated/unauthenticated connection according to existing token policy
```

固定端口已占用时必须 startup failure。

### 16.3 CDP endpoint

覆盖：

```text
CDP unset
CDP fixed port
CDP port=0
```

固定端口已被其它进程占用时必须 startup failure，且不得误认已有 `/json/version`。

动态端口场景验证：

```text
stale DevToolsActivePort removed
-> new DevToolsActivePort discovered
-> /json/version reachable
-> hostra.ready contains actual port
```

### 16.4 Ready and child env

```text
hostra.ready emitted exactly once
-> RPC/CDP already usable
-> HOSTRA_SUBCMD starts afterwards
-> child sees actual resolved HOSTRA_RPC_PORT
-> child sees actual resolved HOSTRA_CDP_PORT when enabled
```

同时验证 startup failure：不输出 ready、不启动 child、non-zero exit。

不允许使用固定 sleep 判断 ready。

### 16.5 Window lifecycle

```text
openWindow
-> registry contains window
-> window.created

closeWindow
-> close request accepted
-> BrowserWindow closed
-> registry removed
-> window.closed
```

验证 `closeWindow()` 不提前提交 closed fact。

### 16.6 Subprocess lifecycle

覆盖：

```text
successful spawn -> subprocess.started
spawn failure -> subprocess.spawnFailed -> host.shuttingDown(error)
natural exit -> subprocess.exited -> host.shuttingDown(subprocess-exited)
post-spawn child error -> host.shuttingDown(error)
```

### 16.7 Snapshot alignment

验证：

```text
connect WS
-> buffer events
-> getHostState
-> reconcile by seq
-> reconstructed current state equals Electron Main state
```

同时验证 reconnect 与新的 `sessionId`。

### 16.8 Shutdown convergence

覆盖：

```text
signal shutdown
window-all-closed shutdown where applicable
subprocess-exited shutdown
error shutdown
```

并验证：

```text
host.shuttingDown emitted once
-> openWindow rejected after shutdown transition
-> read-only RPC remains available during convergence
-> window.closed / subprocess.exited remain observable while RPC is open
-> graceful convergence
-> 1000ms force fallback when needed
-> RPC closes after resources converge
-> parent observes final Hostra exit
```

### 16.9 CDP smoke

```text
Hostra boots with CDP
-> open fixture BrowserWindow
-> enumerate Renderer target
-> evaluate/read known fixture marker
```

不测试 CDP 协议本身，不测试多窗口 target mapping。

### 16.10 Compatibility

现有 example/RPC client 必须继续使用原有 `openWindow/closeWindow/getAllWindows` contract 工作，不要求适配新 lifecycle API 才能运行。

## 17. Implementation Mapping

实现工作只需要落在四个现有文件和测试：

### `packages/hostra/scripts/hostra.js`

- 保持 `.env` / shell priority；
- 继续 spawn 已安装 Electron with inherited stdio；
- 继续转发 Electron exit code。

### `packages/hostra/main.js`

- 生成 `sessionId`；
- 拥有 `seq / windows / subprocess / shutdown` state；
- 配置和发现 CDP；
- 等待 RPC listening；
- 回写 resolved endpoint env；
- 输出 `hostra.ready`；
- 管理 window/subprocess lifecycle；
- first-wins shutdown 与 convergence。

### `packages/hostra/rpc-server.js`

- RPC 显式 bind `127.0.0.1`；
- 支持 port `0` 并暴露实际 listening port；
- 接受由 `main.js` 提供的方法实现；
- 提供 `notify(method, params)` broadcast；
- 不再拥有 window registry 或 Host lifecycle state。

### `packages/hostra/scripts/download-electron.js`

- 删除 `electron/latest` 查询；
- 从 package metadata 读取 pinned version；
- 支持安装期显式 exact-version override。

内部 helper 的命名与文件内拆分属于 implementation detail，不需要新增架构层。

## 18. Frozen Acceptance Criteria

以下链路全部稳定通过后，本设计闭环完成：

```text
install Hostra
-> deterministic Electron version
-> spawn Hostra
-> resolve RPC/CDP endpoints
-> stdout hostra.ready
-> child receives resolved endpoint env
-> connect Hostra RPC
-> getHostState
-> open/close BrowserWindow with ordered lifecycle facts
-> observe subprocess lifecycle
-> reconcile snapshot + events by sessionId/seq
-> connect CDP and inspect fixture Renderer
-> trigger shutdown
-> observe one host.shuttingDown
-> reject new resource creation
-> observe remaining window/subprocess convergence while RPC is alive
-> RPC closes after control-plane convergence
-> parent observes final Hostra process exit
```

同时满足：

- Electron Main 是唯一 runtime fact authority；
- lifecycle state 只有一份；
- WebSocket 只是 runtime control transport；
- stdout 只承担 bootstrap discovery；
- CDP 原样使用，不被 Hostra 二次包装；
- snapshot 表达当前状态，event 表达实时变化，不做历史存储；
- 第一版不预建 manager/supervisor/event-bus 等抽象；
- 现有 RPC contract 保持兼容；
- 实现者不需要再对本文范围内的关键语义做 A/B 架构选择。
