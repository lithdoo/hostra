# Hostra E2E Host 与调试能力草案

> Status: Draft  
> Scope: Hostra 作为桌面应用/游戏运行时的真实 Electron Host，同时为上层项目提供稳定的 E2E 宿主、生命周期观测与 Renderer 调试入口。  
> Out of scope: 并行 Hostra 实例、业务协议、DOM 自动化 API、LoomRealm Runtime/Main 语义。

## 1. 背景

Hostra 当前已经具备以下真实物理能力：

- 启动本机 Electron；
- 提供 localhost WebSocket JSON-RPC；
- 通过 `HOSTRA_SUBCMD` 托管真实业务子进程；
- 业务子进程继承 Hostra 环境变量；
- 子进程退出时收敛 Hostra 生命周期；
- Hostra 退出时终止业务子进程；
- 创建和关闭真实 `BrowserWindow`；
- 可配置独立 `userData` 目录。

这使 Hostra 已经可以承担 E2E 的 **physical desktop host**，但目前仍偏向手工运行工具：缺少确定性的 ready signal、窗口/子进程生命周期观测、自动化 smoke test，以及稳定的 Electron 版本基线。

本草案目标是在不引入业务语义的前提下，把 Hostra 收敛成一个 deterministic、observable、debuggable 的 Desktop E2E Host。

---

## 2. 设计原则

### 2.1 Hostra 只拥有物理 Host 语义

Hostra 可以负责：

- Electron process；
- BrowserWindow / WebContents 生命周期；
- Host RPC；
- Chromium DevTools Protocol（CDP）入口；
- 业务子进程的启动与物理生命周期；
- Host-level diagnostics；
- Host-level readiness / lifecycle events。

Hostra 不负责：

- Game Package 解析；
- LoomRealm `LogicalGameBootstrap`；
- Runtime / Frame / Main authority；
- Runtime Control protocol；
- Subsystem Definition 语义；
- Renderer 业务协议；
- DOM selector、click、type、screenshot 等测试框架能力。

后者应由上层产品或 CDP/Playwright 等标准自动化工具承担。

### 2.2 控制平面与调试平面分离

Hostra 应明确区分两个入口：

```text
Hostra RPC
  = Host lifecycle / Window lifecycle / process lifecycle

CDP
  = Renderer/WebContents introspection and automation
```

Hostra RPC 不重新实现 Chromium 已经提供的调试和浏览器自动化协议。

### 2.3 调试能力默认关闭

CDP 是诊断/测试能力，不应默认暴露。

只有显式配置 `HOSTRA_CDP_PORT` 时才启用，并且应限制为 loopback 使用。生产打包或正常用户运行不应因为 Hostra 存在而自动开启远程调试端口。

---

## 3. 建议配置

保留现有配置，并增加 CDP 配置：

```env
HOSTRA_APP_NAME=my-app
HOSTRA_RPC_PORT=9333
HOSTRA_RPC_TOKEN=replace-with-token
HOSTRA_SUBCMD=node ./app.js
HOSTRA_CONFIG_DIR=.
HOSTRA_USER_DATA_DIR=./user-data

# Optional. Disabled when unset.
HOSTRA_CDP_PORT=9222
```

### 3.1 `HOSTRA_CDP_PORT`

语义：

- 未设置：不启用 Chromium remote debugging；
- 设置为有效端口：Electron 启动前增加 Chromium remote debugging switch；
- Hostra 不承诺该端口对非 loopback 地址可达；
- E2E runner 可以通过 CDP 枚举和连接 Hostra 内的 Renderer/WebContents target。

建议实现方式：在 Electron `ready` 之前执行：

```js
const cdpPort = process.env.HOSTRA_CDP_PORT;
if (cdpPort) {
  app.commandLine.appendSwitch('remote-debugging-port', String(cdpPort));
}
```

CDP 与 Hostra RPC 是独立接口：

```text
ws://127.0.0.1:<HOSTRA_RPC_PORT>
http://127.0.0.1:<HOSTRA_CDP_PORT>
```

### 3.2 不新增全局 `HOSTRA_DEBUG` 作为必要前提

初版建议避免额外总开关造成配置组合歧义。`HOSTRA_CDP_PORT` 本身即可作为显式 opt-in。

未来如果出现多种 debug capability，再考虑增加统一 debug policy。

---

## 4. Hostra Ready Contract

### 4.1 问题

E2E runner 不应依赖：

```text
spawn Hostra
sleep 1000
try connect
```

这类时间猜测容易造成 CI flaky。

### 4.2 Ready 的定义

`hostra.ready` 至少表示：

1. Electron `app.whenReady()` 已完成；
2. Hostra RPC 已进入可接受连接状态；
3. 如果启用 CDP，其配置已经在 Electron 启动前生效；
4. `HOSTRA_SUBCMD` 即将启动或已经成功进入启动阶段。

建议严格区分：

```text
hostra.ready
!=
subprocess.ready
!=
window.ready
```

Hostra 只能声明自己拥有的事实。

### 4.3 机器可解析 stdout record

建议 Hostra 在 ready 后输出一行稳定、机器可解析的 JSON：

```json
{
  "type": "hostra.ready",
  "pid": 12345,
  "rpcEndpoint": "ws://127.0.0.1:9333",
  "cdpEndpoint": "http://127.0.0.1:9222"
}
```

未启用 CDP 时：

```json
{
  "type": "hostra.ready",
  "pid": 12345,
  "rpcEndpoint": "ws://127.0.0.1:9333",
  "cdpEndpoint": null
}
```

普通人类日志可以继续保留，但 E2E runner 应只依赖结构化 record，而不是匹配自然语言日志。

建议前缀固定，例如：

```text
[hostra:event] {"type":"hostra.ready",...}
```

以便 stdout 同时保持可读性和机器解析稳定性。

---

## 5. Host Info

建议增加 RPC：

```text
getHostInfo()
```

返回 Hostra 当前物理事实：

```json
{
  "pid": 12345,
  "platform": "win32",
  "arch": "x64",
  "electronVersion": "...",
  "rpcEndpoint": "ws://127.0.0.1:9333",
  "cdpEndpoint": "http://127.0.0.1:9222",
  "configDir": "...",
  "userDataDir": "...",
  "subprocess": {
    "configured": true,
    "pid": 23456,
    "state": "running"
  }
}
```

要求：

- 不返回 RPC token；
- 不返回完整环境变量；
- 不返回任意敏感业务配置；
- 只暴露 Hostra 自身需要诊断的物理事实。

---

## 6. Window 生命周期可观测性

### 6.1 当前问题

当前 `openWindow()` 成功只表示 `BrowserWindow` 已创建，不表示目标 URL 已加载完成。

完整 E2E 需要区分：

```text
created
→ dom-ready
→ did-finish-load

或

created
→ did-fail-load

最终
→ closed
```

### 6.2 Window State

建议 Hostra 内部为每个 window 保存独立状态：

```text
creating
loading
ready
failed
closed
```

并增加：

```text
getWindowState(windowId)
```

示例：

```json
{
  "windowId": "main",
  "state": "ready",
  "url": "http://127.0.0.1:4174/",
  "lastError": null
}
```

失败示例：

```json
{
  "windowId": "main",
  "state": "failed",
  "url": "http://127.0.0.1:4174/",
  "lastError": {
    "code": -102,
    "description": "ERR_CONNECTION_REFUSED"
  }
}
```

### 6.3 Host Events

建议通过 JSON-RPC notification 向已连接的控制客户端广播 Host 事件，不带 `id`：

```json
{
  "jsonrpc": "2.0",
  "method": "hostra.event",
  "params": {
    "type": "window.loaded",
    "windowId": "main"
  }
}
```

首批事件：

```text
window.created
window.domReady
window.loaded
window.loadFailed
window.closed
```

其中：

- `window.domReady`: Electron `dom-ready`；
- `window.loaded`: 主 frame `did-finish-load`；
- `window.loadFailed`: 主 frame 的加载失败；
- `window.closed`: BrowserWindow 已关闭且从内部 registry 移除。

不要把业务页面“应用 ready”混入 `window.loaded`。应用自身 ready 应由业务/E2E protocol 定义。

### 6.4 `waitWindowReady`

可作为后续 convenience RPC，而不是第一阶段必须项。

如果实现，RPC server 必须正式支持 async method：

```text
waitWindowReady(windowId, timeoutMs)
```

语义应该只等待 Hostra-owned window loading fact，不等待业务应用状态。

---

## 7. Subprocess 生命周期可观测性

Hostra 已经负责 `HOSTRA_SUBCMD` 的物理进程生命周期，因此应该暴露这些事实。

建议事件：

```text
subprocess.starting
subprocess.started
subprocess.spawnFailed
subprocess.exited
subprocess.terminateRequested
subprocess.forceKillRequested
```

示例：

```json
{
  "jsonrpc": "2.0",
  "method": "hostra.event",
  "params": {
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
    "type": "subprocess.exited",
    "pid": 23456,
    "code": 0,
    "signal": null
  }
}
```

Hostra 不解释子进程为什么退出，也不把业务 Runtime failure 映射为 Hostra 自己的错误类别。

---

## 8. Host Shutdown 可观测性

建议增加：

```text
host.shuttingDown
host.rpcClosing
```

`hostra.ready` 之后发生 shutdown 时，控制客户端应能观察到 shutdown 已开始，而不是只看到 socket 突然断开。

注意：进程退出后自然无法再发送最终事件，因此不需要虚构 `host.exited` RPC event。最终 exit code 应由父级 E2E runner 从进程句柄观察。

---

## 9. CDP 的职责边界

启用 `HOSTRA_CDP_PORT` 后，E2E 工具可以通过标准 Chromium DevTools Protocol 完成 Renderer 层能力，例如：

- 枚举 WebContents target；
- JavaScript evaluation；
- DOM inspection；
- console capture；
- network inspection；
- input dispatch；
- screenshot；
- 与 Playwright/Puppeteer 等工具集成。

Hostra RPC 不增加以下方法：

```text
querySelector
click
type
evaluate
screenshot
waitForSelector
getNetworkRequests
```

这些都不属于 Hostra 的 Host-level contract。

### 9.1 `devTools` 与 CDP 不应视为同一概念

`openWindow({ devTool: ... })` 控制的是窗口是否允许/使用本地 DevTools UI。

`HOSTRA_CDP_PORT` 控制的是 Electron instance 的 remote debugging capability。

两者应独立建模，不应让 window-level `devTool` 选项成为 E2E 是否可调试的隐式开关。

对于 `devTools: false` 与 remote CDP target 的具体 Electron 行为，应增加真实 smoke test 固化，而不是依赖假设。

---

## 10. Electron 版本确定性

### 10.1 当前风险

Hostra 当前安装阶段获取 `electron/latest`，导致同一个 Hostra 版本在不同安装时间可能得到不同 Electron 版本。

这对 E2E 不可接受，因为测试结果将隐式依赖安装日期。

### 10.2 建议

Hostra release 应固定一个默认 Electron version。

建议来源之一：

```json
{
  "hostra": {
    "electronVersion": "<pinned-version>"
  }
}
```

`download-electron.js` 默认读取 package 中固定版本，而不是查询 `electron/latest`。

可以保留显式 override：

```env
HOSTRA_ELECTRON_VERSION=<version>
```

但规则应为：

```text
explicit HOSTRA_ELECTRON_VERSION
    > package pinned Electron version
```

不再存在默认 `latest` fallback。

这样一个 E2E 环境至少可以被完整描述为：

```text
Hostra version
+ Electron version
+ application commit/version
```

---

## 11. Automated Smoke / E2E Tests

Hostra 自身应增加最小自动化测试，不测试上层业务。

建议测试层次：

### 11.1 Unit tests

覆盖：

- `.env` parsing；
- config priority；
- command parsing；
- endpoint/config validation；
- Host event serialization。

### 11.2 RPC integration tests

覆盖：

- token accepted/rejected；
- invalid JSON；
- method not found；
- `getHostInfo`；
- window registry semantics；
- event notification serialization。

如果 BrowserWindow 依赖 Electron runtime，则不强行在纯 Node 层模拟全部行为。

### 11.3 Real Electron smoke tests

至少覆盖：

```text
Hostra boots
→ emits hostra.ready
→ RPC accepts connection
→ getHostInfo succeeds
→ openWindow(local fixture)
→ window.created
→ window.domReady
→ window.loaded
→ getWindowState == ready
→ closeWindow
→ window.closed
→ Hostra shuts down cleanly
```

### 11.4 Subprocess smoke tests

覆盖：

```text
Hostra
→ spawn fixture child
→ subprocess.started
→ child exits 0
→ subprocess.exited
→ Hostra exits
```

以及：

```text
Hostra shutdown
→ SIGTERM child
→ grace period
→ necessary SIGKILL fallback
```

### 11.5 CDP smoke test

启用 `HOSTRA_CDP_PORT`：

```text
Hostra boots
→ open local fixture window
→ connect CDP
→ enumerate target
→ evaluate simple expression / read page marker
→ disconnect
```

目标不是测试 CDP 本身，而是证明 Hostra 的 Electron 启动参数确实把 Renderer target 暴露给测试工具。

Linux CI 如需要显示服务，可使用 Xvfb；不要因为 CI 环境而把真实 Electron smoke test退化成纯 mock。

---

## 12. LoomRealm E2E 中的预期位置

Hostra 本身不依赖 LoomRealm。

LoomRealm 可以把 Hostra 作为真实 platform dependency：

```text
LoomRealm E2E Runner
    |
    | spawn
    v
Hostra / Electron
    |
    | HOSTRA_SUBCMD
    v
LoomRealm Desktop Composition Root
    |
    +-- HostraPlatform
    +-- game-launcher-hostra
    +-- Main
    +-- RuntimeHosting
    +-- Node Runner process(es)
    +-- Runtime Control
    +-- Subsystem Runtime
```

控制面：

```text
LoomRealm E2E Runner
    +-- Hostra RPC  --> physical lifecycle facts
    +-- CDP         --> Renderer diagnostics/automation
    +-- process     --> final exit code / stdout / stderr
```

M6 阶段即使没有 Renderer，也可以使用 Hostra 验证真实 process + network runtime vertical。

后续 Renderer/Data/Input/Render/Content 接入后，同一个 Hostra/CDP 基础设施可以继续用于完整 Desktop E2E。

---

## 13. 非目标

本轮明确不做：

- 多 Hostra 实例并行隔离；
- 自动分配 RPC/CDP 端口；
- Playwright wrapper；
- DOM/query/click/type API；
- screenshot RPC；
- 业务应用 ready protocol；
- LoomRealm-specific RPC；
- Runtime restart / crash recovery policy；
- Electron sandbox policy redesign。

这些能力如果未来需要，应单独设计，不应隐式进入 Hostra core。

---

## 14. 建议实施顺序

### Phase A — Deterministic Host

1. 固定默认 Electron version；
2. 增加 `HOSTRA_CDP_PORT`；
3. 增加 `hostra.ready` structured stdout record；
4. 增加 `getHostInfo()`。

### Phase B — Observable Lifecycle

5. Window state registry；
6. `getWindowState()`；
7. `window.*` notifications；
8. `subprocess.*` notifications；
9. `host.shuttingDown` notification。

### Phase C — Qualification

10. Node-level unit/integration tests；
11. Real Electron smoke test；
12. CDP smoke test；
13. subprocess shutdown/escalation test；
14. CI qualification on supported desktop environments。

`waitWindowReady()` 等 convenience API 可以在事件模型稳定后再决定是否需要。

---

## 15. 初步完成标准

Hostra 可以被认为具备 E2E Host baseline，当以下链路可自动重复通过：

```text
spawn Hostra
→ receive hostra.ready
→ connect Hostra RPC
→ inspect getHostInfo
→ create BrowserWindow
→ observe deterministic window lifecycle
→ connect CDP and inspect Renderer
→ observe subprocess lifecycle
→ request/trigger shutdown
→ child-process lifecycle converges
→ Hostra exits with expected code
```

并且：

- 相同 Hostra 版本默认使用相同 Electron 版本；
- E2E 不依赖固定 sleep；
- E2E 不依赖解析自然语言日志；
- Hostra RPC 不承载 DOM 自动化语义；
- CDP 默认关闭；
- Hostra 与上层业务 authority 保持解耦。

---

## 16. Open Questions

以下问题在实现前可通过 spike/smoke test 收敛：

1. `devTools: false` 对 remote CDP target 可见性的实际 Electron 行为；
2. `hostra.ready` 应在 `HOSTRA_SUBCMD` spawn 前还是 spawn 成功后输出；
3. Window load failure 是否只记录 main frame，还是同时暴露 subframe diagnostics；
4. RPC notification 在客户端连接较晚时是否需要 state replay，还是仅依赖 `getHostInfo/getWindowState` 做当前状态查询；
5. Electron pinned version 的 release/update policy。

建议原则：event 用于观察变化，query RPC 用于读取当前事实；不要依赖事件历史作为唯一真相源。
