# Hostra Endpoint Discovery、Lifecycle Observability 与 CDP 草案

> Status: Draft  
> Scope: 将 Hostra 收敛为一个可确定启动、可发现 endpoint、可观测 Host 生命周期、可通过标准 CDP 调试 Renderer 的本地 Electron Host。  
> Out of scope: 业务协议、DOM 自动化 RPC、Playwright/Puppeteer wrapper、CDP proxy、Renderer/Page 生命周期翻译层。

## 1. Hostra 的整体定位

Hostra 本质上是一个本地 Desktop Host Runtime，而不是业务应用框架，也不是浏览器自动化框架。

当前启动关系可以抽象为：

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

因此 Hostra 应明确分成三个 plane：

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

三个 plane 应保持职责单一，不互相复制语义。

---

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

推荐内部结构：

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

这样避免出现两套 Renderer 事实源：

```text
Electron event -> Hostra translated event
Chromium event -> CDP event
```

Hostra 只负责 Window 是否存在；Window 内部发生什么由 CDP 观察。

---

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

`HOSTRA_RPC_PORT=0` 时，WebSocket server 应直接让 OS 分配端口。

Hostra 必须等待 server 真正进入 listening 状态后读取实际端口；不能在 `new WebSocketServer(...)` 后立即假设 endpoint 已 ready。

例如最终得到：

```text
ws://127.0.0.1:43817
```

### 3.2 CDP 随机端口

`HOSTRA_CDP_PORT=0` 表示请求 Chromium remote debugging 的动态端口。

实现细节不作为公开 contract 固定，但必须满足：

- 使用当前 pinned Electron 版本真实验证；
- 能可靠得到最终实际端口；
- 最终 endpoint 必须通过 Bootstrap Plane 返回；
- 不依赖调用方猜测或扫描端口。

Chromium 支持 `--remote-debugging-port=0` 的动态端口行为，但 Electron 官方文档只明确承诺 `--remote-debugging-port=<port>`，因此 Hostra 应将 `port=0` 作为自身经过 smoke test qualification 的能力，而不是未经验证地假设所有 Electron 版本都一致。

如 pinned Electron 的 `port=0` 行为或 endpoint discovery 不可靠，Hostra 可以采用其它内部实现，但公开语义仍保持：

```text
HOSTRA_CDP_PORT=0
=> Hostra chooses a usable CDP port
=> caller receives final cdpEndpoint
```

### 3.3 固定端口与随机端口的 contract

```text
PORT unset
  -> 使用默认值或关闭该能力（按具体配置定义）

PORT = positive integer
  -> 请求固定端口

PORT = 0
  -> 请求动态端口
```

CDP 未配置时仍默认关闭。

---

## 4. Bootstrap Plane：为什么需要内部管道

运行期 lifecycle event 应走 WebSocket，但 endpoint discovery 不能依赖 WebSocket 本身。

特别是：

```text
HOSTRA_RPC_PORT=0
```

此时调用方在 Hostra 启动前不知道 WS 地址，因此 `hostra.ready` 不能只通过 WS 发送。

推荐：

```text
Hostra CLI
   |
   | private bootstrap IPC / pipe
   v
Electron Main
```

Electron Main 在自身初始化完成后向 CLI 返回：

```json
{
  "type": "ready",
  "pid": 12345,
  "rpcEndpoint": "ws://127.0.0.1:43817",
  "cdpEndpoint": "http://127.0.0.1:45122"
}
```

CLI 再向调用方输出稳定、机器可解析的 record：

```text
[hostra:event] {"type":"hostra.ready","pid":12345,"rpcEndpoint":"ws://127.0.0.1:43817","cdpEndpoint":"http://127.0.0.1:45122"}
```

因此规则是：

```text
Bootstrap discovery
  -> private CLI <-> Electron Main IPC / pipe
  -> structured stdout for external parent

Runtime lifecycle
  -> WebSocket JSON-RPC notifications
```

### 4.1 私有 IPC 不成为公开 Hostra API

不要增加类似：

```text
HOSTRA_EVENT_PIPE
HOSTRA_CONTROL_FD
```

也不要要求 `HOSTRA_SUBCMD` 继承某个特殊 fd。

内部通道只解决 CLI 与 Electron Main 之间的 bootstrap/control 问题。

具体实现可以优先评估 Node child-process IPC channel；如 Electron 跨平台行为需要其它 private pipe，实现方式可以替换，但不影响公开 contract。

---

## 5. `hostra.ready` Contract

`hostra.ready` 是 Bootstrap Plane 的事件，不属于运行期 WS lifecycle stream。

它至少表示：

1. Electron Main 已完成 Hostra 自身初始化；
2. Hostra RPC 已真实进入 listening 状态；
3. 最终 `rpcEndpoint` 已确定；
4. 如果启用 CDP，最终 `cdpEndpoint` 已确定并可用于连接；
5. Host Runtime 已可以接受后续控制；
6. 如果配置 `HOSTRA_SUBCMD`，其启动动作可以在此之后按既定顺序进行或已进入明确启动阶段。

必须区分：

```text
hostra.ready
!= subprocess.started
!= application.ready
!= page.loaded
```

Hostra 只声明自己的 ready。

---

## 6. Host Control Plane：生命周期事件统一走 WebSocket

Hostra 已经有 localhost WebSocket JSON-RPC，因此公开生命周期事件应直接复用同一个 control plane。

推荐使用 JSON-RPC Notification：

```json
{
  "jsonrpc": "2.0",
  "method": "hostra.event",
  "params": {
    "seq": 17,
    "type": "window.created",
    "windowId": "main",
    "webContentsId": 3
  }
}
```

不带 `id`，表示 notification。

### 6.1 为什么不用公开 pipe 发送生命周期事件

公开 pipe 会绑定父子进程 topology，并引入：

- fd inheritance；
- Windows pipe 差异；
- Node child-process 假设；
- 一个 parent/child 通道难以服务多个观察客户端；
- 与已有 WS RPC 形成第二套公开 transport。

WebSocket 则已经具备：

- 本地跨语言访问；
- 多客户端；
- JSON framing；
- 现有 token 鉴权；
- command 与 notification 可共用同一连接。

因此：

```text
公开 runtime control / lifecycle = WS
内部 bootstrap discovery = private pipe / IPC
```

---

## 7. Lifecycle Event Contract

第一版稳定 contract 建议只保留真正的资源状态变化。

### 7.1 Host

```text
host.shuttingDown
```

不建议冻结：

```text
host.rpcClosing
host.exited
```

原因：

- WS close 本身已经表示 transport 消失；
- `host.rpcClosing` 存在明显 close race，价值有限；
- 进程真正退出后无法再通过自身 RPC 发送 `host.exited`；
- 最终 exit code 应由 Hostra 的父进程句柄观察。

### 7.2 Window

```text
window.created
window.closed
```

示例：

```json
{
  "jsonrpc": "2.0",
  "method": "hostra.event",
  "params": {
    "seq": 18,
    "type": "window.created",
    "windowId": "main",
    "webContentsId": 3
  }
}
```

关闭：

```json
{
  "jsonrpc": "2.0",
  "method": "hostra.event",
  "params": {
    "seq": 19,
    "type": "window.closed",
    "windowId": "main"
  }
}
```

不发送 Renderer/Page lifecycle event。

### 7.3 Subprocess

稳定 contract 建议：

```text
subprocess.started
subprocess.spawnFailed
subprocess.exited
```

启动：

```json
{
  "jsonrpc": "2.0",
  "method": "hostra.event",
  "params": {
    "seq": 20,
    "type": "subprocess.started",
    "pid": 23456
  }
}
```

退出：

```json
{
  "jsonrpc": "2.0",
  "method": "hostra.event",
  "params": {
    "seq": 21,
    "type": "subprocess.exited",
    "pid": 23456,
    "code": 0,
    "signal": null
  }
}
```

下面这些更适合作为 Supervisor diagnostic，而不是第一版稳定 lifecycle contract：

```text
subprocess.starting
subprocess.terminateRequested
subprocess.forceKillRequested
```

它们可以保留 structured log，但暂不要求外部客户端依赖。

---

## 8. Event Sequence

每个 Hostra session 维护单调递增的：

```text
seq
```

例如：

```text
17 window.created
18 subprocess.started
19 window.closed
20 subprocess.exited
21 host.shuttingDown
```

`seq` 的作用：

- 明确事件发生顺序；
- 便于自动化断言；
- 便于诊断丢失或重连后的 observation gap；
- 不要求跨 Hostra process 持久化。

建议所有 WS lifecycle notification 都带 `seq`。

---

## 9. Snapshot + Events 模型

Lifecycle event 不能代替当前状态查询。

一个客户端可能在 Hostra 已经运行后才连接，此时它已经错过：

```text
window.created
subprocess.started
```

因此推荐正式采用：

```text
Snapshot
+
Events
```

### 9.1 推荐 `getHostState()`

可以将现有零散查询逐步收敛为：

```text
getHostState()
```

示例：

```json
{
  "seq": 27,
  "host": {
    "state": "running",
    "pid": 12345,
    "platform": "win32",
    "arch": "x64",
    "electronVersion": "...",
    "rpcEndpoint": "ws://127.0.0.1:43817",
    "cdpEndpoint": "http://127.0.0.1:45122"
  },
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

客户端流程：

```text
connect WS
-> getHostState() returns seq=27
-> observe seq=28,29,30...
```

这样连接较晚的客户端仍然可以先获得一致 snapshot，再继续追踪事件。

### 9.2 与现有 API 的兼容

现有：

```text
getVersion
getPlatform
getArch
getAppPath
getAllWindows
```

可以继续保留。

`getHostState()` 是面向 observability 的聚合 snapshot，不要求立即删除旧 RPC。

---

## 10. Window 与 CDP Target 关联

Hostra Window identity 与 CDP target identity 是不同概念。

Hostra 应提供最小关联信息：

```text
windowId
webContentsId
current URL / title (diagnostic metadata)
```

推荐关系：

```text
Hostra RPC
  -> getHostState()/getAllWindows()
  -> windowId + webContentsId + URL/title

CDP client
  -> enumerate targets
  -> resolve target
  -> 后续 Renderer 操作全部走 CDP
```

Hostra 不增加：

```text
getCdpTargetId(windowId)
attachCdp(windowId)
evaluateInWindow(windowId, script)
```

除非未来证明标准 target correlation 不足，再单独设计最小映射能力。

---

## 11. CDP Debug Plane

启用 CDP 后，标准 CDP client、Playwright、Puppeteer 或其它工具可以承担：

- target enumeration；
- JavaScript evaluation；
- DOM inspection；
- Page lifecycle；
- navigation diagnostics；
- console capture；
- network inspection；
- input dispatch；
- screenshot。

Hostra 不代理这些操作。

### 11.1 `devTools` 与 CDP 独立

`openWindow({ devTool: ... })` 控制窗口的本地 DevTools UI 能力。

`HOSTRA_CDP_PORT` 控制 Electron instance 的 remote debugging capability。

两者应独立建模。

对于 `devTools: false` 与 remote CDP target 的实际行为，应在 Hostra 当前 pinned Electron 上做真实 smoke test 固化。

---

## 12. Electron 版本确定性

Hostra release 应固定默认 Electron version，而不是安装时查询 `electron/latest`。

可以保留显式 override：

```env
HOSTRA_ELECTRON_VERSION=<version>
```

规则：

```text
explicit HOSTRA_ELECTRON_VERSION
  > package pinned Electron version
```

不再有默认 `latest` fallback。

原因不仅是测试稳定性，也因为以下 Hostra 能力都依赖 Electron/Chromium 的具体行为：

- CDP dynamic port；
- target discovery；
- `DevToolsActivePort` 等实现细节；
- BrowserWindow/WebContents 行为。

因此这些能力应针对 pinned Electron 版本 qualification。

---

## 13. 建议的实现结构调整

当前 `rpc-server.js` 同时承担 transport 和 Window registry。随着 lifecycle observability 加入，建议逐步拆分：

```text
main.js
  |
  v
HostRuntime
  |
  +-- WindowManager
  |    +-- open
  |    +-- close
  |    +-- registry
  |
  +-- SubprocessSupervisor
  |    +-- spawn
  |    +-- exit observation
  |    +-- shutdown convergence
  |
  +-- HostEventBus
  |    +-- seq
  |    +-- lifecycle facts
  |
  +-- HostState snapshot
  |
  +-- RpcServer adapter
```

RPC server 只负责：

- connection/auth；
- JSON-RPC decode/encode；
- method dispatch；
- event broadcast。

它不直接拥有 Window/Subprocess state。

---

## 14. Automated Qualification

### 14.1 Bootstrap / endpoint test

固定端口：

```text
spawn Hostra
-> receive structured hostra.ready
-> endpoints equal requested fixed ports
```

随机端口：

```text
HOSTRA_RPC_PORT=0
HOSTRA_CDP_PORT=0
-> spawn Hostra
-> receive hostra.ready
-> rpcEndpoint has actual non-zero port
-> cdpEndpoint has actual non-zero port
-> both endpoints connect successfully
```

### 14.2 Lifecycle WS test

```text
connect RPC
-> getHostState snapshot
-> openWindow
-> observe window.created seq=N
-> closeWindow
-> observe window.closed seq=N+1
```

### 14.3 Subprocess lifecycle test

```text
Hostra with fixture child
-> subprocess.started
-> child exits
-> subprocess.exited
```

并验证异常 spawn -> `subprocess.spawnFailed`。

### 14.4 CDP smoke test

```text
Hostra boots with CDP enabled
-> open local fixture window
-> connect cdpEndpoint
-> enumerate target
-> correlate target with Hostra window
-> evaluate/read a simple page marker
```

Hostra smoke test只证明 CDP endpoint 和 target correlation 可用，不测试 CDP 本身。

### 14.5 Shutdown test

```text
running Hostra
-> trigger shutdown
-> observe host.shuttingDown
-> WS eventually closes
-> parent observes final process exit code
```

---

## 15. 非目标

本轮不做：

- Hostra 自己的 DOM/query/click/type/evaluate/screenshot RPC；
- CDP proxy；
- Playwright/Puppeteer wrapper；
- Renderer/Page lifecycle translation；
- 业务 application ready protocol；
- 对外公开 IPC pipe；
- fd-based public event channel；
- lifecycle event 持久化；
- event replay log；
- 多进程分布式 event bus。

随机端口属于本轮 endpoint discovery scope，但不等于解决完整的多实例并行隔离问题；例如 single-instance policy、userData isolation 等仍可另行设计。

---

## 16. 建议实施顺序

### Phase A — Endpoint Discovery

1. RPC server 支持 `HOSTRA_RPC_PORT=0`；
2. CDP 支持 `HOSTRA_CDP_PORT=0`；
3. CLI <-> Electron Main private bootstrap IPC；
4. `hostra.ready` structured stdout；
5. 固定默认 Electron version；
6. fixed/random endpoint smoke tests。

### Phase B — Host Runtime Model

7. 从 RPC transport 中抽离 Window registry；
8. 建立 SubprocessSupervisor；
9. 建立 HostEventBus + monotonic `seq`；
10. 建立 HostState snapshot。

### Phase C — Public Observability

11. `getHostState()`；
12. `window.created` / `window.closed`；
13. `subprocess.started` / `spawnFailed` / `exited`；
14. `host.shuttingDown`；
15. lifecycle WS tests。

### Phase D — CDP Qualification

16. Window `webContentsId` 暴露；
17. CDP target correlation test；
18. real Electron CDP smoke test；
19. supported desktop CI qualification。

---

## 17. 完成标准

Hostra 可以认为完成这一轮改造，当以下链路稳定成立：

```text
spawn Hostra
-> private bootstrap IPC completes
-> receive hostra.ready with actual endpoints
-> connect Hostra RPC
-> getHostState snapshot
-> observe ordered Host/Window/Subprocess lifecycle notifications
-> connect CDP directly for Renderer diagnostics
-> shutdown
-> observe host.shuttingDown
-> WS closes
-> parent observes Hostra process exit
```

并且：

- `RPC_PORT=0` 和 `CDP_PORT=0` 都能可靠发现最终 endpoint；
- lifecycle event 只走公开 WebSocket control plane；
- private pipe/IPC 只服务 bootstrap discovery；
- lifecycle event 带 session-local monotonic `seq`；
- snapshot 与 event 能组成一致 observation 模型；
- Renderer/Page 事实不被 Hostra RPC 重复建模；
- Hostra RPC transport 不再拥有核心 lifecycle state；
- 相同 Hostra 版本默认使用相同 Electron 版本；
- CDP 默认关闭，只有显式配置时启用。
