# Hostra E2E Host 与调试能力草案

> Status: Draft  
> Scope: 将 Hostra 收敛为可确定启动、可观测、可调试的真实 Electron E2E Host。  
> Out of scope: 并行 Hostra 实例、自动端口分配、业务协议、DOM 自动化 RPC、Playwright/Puppeteer wrapper。

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

这些能力已经足以让 Hostra 承担真实桌面 E2E 的 physical host，但当前仍偏向手工运行工具：缺少确定性的 ready signal、Host/Window/子进程生命周期观测、标准 Renderer 调试入口、自动化 smoke test，以及稳定的 Electron 版本基线。

本草案的目标是在不引入业务语义的前提下，把 Hostra 收敛成一个 deterministic、observable、debuggable 的 Desktop E2E Host。

---

## 2. 设计原则

### 2.1 Hostra 只拥有 Host-level 物理事实

Hostra 可以负责：

- Electron process；
- `BrowserWindow` 的创建、关闭和物理存在性；
- Host RPC；
- Chromium DevTools Protocol（CDP）入口；
- `HOSTRA_SUBCMD` 子进程的启动与物理生命周期；
- Host-level diagnostics；
- Host-level readiness / shutdown events。

Hostra 不负责：

- 业务应用 ready 语义；
- 页面业务状态；
- DOM selector、click、type、evaluate、screenshot 等自动化 API；
- 网络/Console/Runtime/Page 等 Chromium 调试语义；
- 上层业务协议或运行时协议。

页面与 Renderer 层的观测和自动化应直接使用 CDP 或建立在 CDP 之上的标准工具。

### 2.2 控制平面与调试平面分离

Hostra 应明确区分两个入口：

```text
Hostra RPC
  = Host / Window / child-process physical lifecycle

CDP
  = Renderer / WebContents introspection and automation
```

Hostra RPC 不重新包装 CDP 已经提供的 Page/Runtime/DOM/Network/Input 等能力。

### 2.3 CDP 成为 Renderer 事实的唯一标准入口

引入 CDP 后，不再在 Hostra RPC 中重复实现以下能力：

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

这样避免形成两套 Renderer 事实源：

```text
Electron event -> Hostra translated event
Chromium event -> CDP event
```

Renderer/WebContents 内部发生了什么，以 CDP 为准；Hostra 只声明自己实际拥有的物理资源是否存在。

### 2.4 调试能力默认关闭

CDP 是诊断/测试能力，不应默认暴露。

只有显式配置 `HOSTRA_CDP_PORT` 时才启用，并且应限制为 loopback 使用。正常用户运行不应因为 Hostra 存在而自动开启 remote debugging。

---

## 3. 建议配置

保留现有配置，并增加 CDP 与 Electron version 配置：

```env
HOSTRA_APP_NAME=my-app
HOSTRA_RPC_PORT=9333
HOSTRA_RPC_TOKEN=replace-with-token
HOSTRA_SUBCMD=node ./app.js
HOSTRA_CONFIG_DIR=.
HOSTRA_USER_DATA_DIR=./user-data

# Optional. Disabled when unset.
HOSTRA_CDP_PORT=9222

# Optional override. Default comes from the Hostra package pinned version.
HOSTRA_ELECTRON_VERSION=...
```

### 3.1 `HOSTRA_CDP_PORT`

语义：

- 未设置：不启用 Chromium remote debugging；
- 设置为有效端口：Electron 启动前增加 Chromium remote debugging switch；
- Hostra 不承诺该端口对非 loopback 地址可达；
- 测试或诊断工具可以通过 CDP 枚举并连接 Hostra 内的 Renderer/WebContents target。

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

初版避免额外总开关造成配置组合歧义。`HOSTRA_CDP_PORT` 本身即可作为显式 opt-in。

未来如果出现多种 debug capability，再考虑统一 debug policy。

---

## 4. Hostra Ready Contract

### 4.1 问题

自动化程序不应依赖：

```text
spawn Hostra
sleep 1000
try connect
```

这类时间猜测容易造成 flaky。

### 4.2 Ready 的定义

`hostra.ready` 至少表示：

1. Electron `app.whenReady()` 已完成；
2. Hostra RPC 已进入可接受连接状态；
3. 如果启用 CDP，其启动配置已经生效；
4. Hostra 已完成自身初始化；
5. 如果配置了 `HOSTRA_SUBCMD`，其启动动作已经进入可执行阶段。

必须明确：

```text
hostra.ready
!=
subprocess.ready
!=
application.ready
```

Hostra 只能声明自己拥有的事实。

### 4.3 机器可解析 stdout record

建议 Hostra ready 后输出稳定的结构化 record：

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

普通人类日志可以保留，但自动化程序应依赖结构化 record，而不是解析自然语言日志。

建议固定前缀：

```text
[hostra:event] {"type":"hostra.ready",...}
```

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
- 不返回任意业务敏感配置；
- 只暴露 Hostra 自身需要诊断的物理事实。

---

## 6. Window 物理生命周期

### 6.1 Hostra 只跟踪 BrowserWindow 物理事实

Hostra 自己创建和拥有 `BrowserWindow`，因此以下事实属于 Hostra：

```text
window.created
window.closed
```

但下面这些 Renderer/Page 事实不再由 Hostra RPC 建模：

```text
dom-ready
did-finish-load
did-fail-load
navigation
network failure
JavaScript exception
console output
DOM state
```

这些统一交给 CDP。

### 6.2 保留并扩展 `getAllWindows()`

不新增复杂 `getWindowState()`；优先扩展现有 `getAllWindows()`，返回用于 Host-level 定位和 CDP target 关联的最小信息：

```json
[
  {
    "windowId": "main",
    "webContentsId": 3,
    "title": "Example",
    "url": "http://127.0.0.1:4174/"
  }
]
```

字段语义：

- `windowId`: Hostra 自己的稳定 window identity；
- `webContentsId`: Electron `webContents.id`，用于诊断与 target correlation；
- `title`: Hostra 创建窗口时的 Host-level metadata；
- `url`: 当前可观察 URL，可作为诊断信息，不作为页面 ready 判断依据。

### 6.3 `openWindow()` 返回值

现有只返回 `windowId` 的行为可以保持兼容，也可以在后续 major/minor contract 演进中返回：

```json
{
  "windowId": "main",
  "webContentsId": 3
}
```

如果需要保持完全兼容，则通过 `getAllWindows()` 获取 `webContentsId` 即可。

### 6.4 Window events

建议只广播：

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
    "type": "window.created",
    "windowId": "main",
    "webContentsId": 3
  }
}
```

Hostra 不广播 `window.loaded` 等 Renderer/Page 事件。

---

## 7. CDP Target 关联

### 7.1 目标

自动化工具通常先通过 Hostra RPC 知道要操作哪个 Hostra window，再通过 CDP 操作对应 Renderer。

因此 Hostra 需要提供足够的关联信息，但不应该维护第二套 CDP target registry。

推荐关系：

```text
Hostra windowId
    -> webContentsId / URL / title
    -> CDP enumerate targets
    -> automation tool resolves target
```

### 7.2 不建议 Hostra 主动代理 CDP

初版不增加：

```text
getCdpTargetId(windowId)
attachCdp(windowId)
evaluateInWindow(windowId, script)
```

原因：

- CDP target lifecycle 属于 Chromium；
- Hostra 不应成为 CDP proxy；
- 标准工具已经具备 target discovery 与 attach 能力；
- 避免 Hostra 绑定某一 CDP client/tool 的行为模型。

如果未来 `webContentsId` 无法稳定用于 target correlation，再单独设计最小映射能力。

---

## 8. Subprocess 生命周期可观测性

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

启动示例：

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

退出示例：

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

Hostra 不解释子进程为什么退出，也不把业务错误映射为 Hostra 自己的错误类别。

---

## 9. Host Shutdown 可观测性

建议增加：

```text
host.shuttingDown
host.rpcClosing
```

`hostra.ready` 之后发生 shutdown 时，控制客户端应能观察到 shutdown 已开始，而不是只看到 socket 突然断开。

进程退出后自然无法发送最终 RPC event，因此不需要虚构 `host.exited`。最终 exit code 应由父级进程从 Hostra process handle 观察。

---

## 10. CDP 的职责边界

启用 `HOSTRA_CDP_PORT` 后，标准 CDP client、Playwright、Puppeteer 或其它工具可以承担 Renderer/WebContents 层能力，例如：

- target enumeration；
- JavaScript evaluation；
- DOM inspection；
- console capture；
- network inspection；
- Page lifecycle；
- navigation diagnostics；
- input dispatch；
- screenshot。

Hostra RPC 不增加以下方法：

```text
querySelector
click
type
evaluate
screenshot
waitForSelector
getNetworkRequests
waitWindowReady
```

这些都不属于 Hostra 的 Host-level contract。

### 10.1 `devTools` 与 CDP 不应视为同一概念

`openWindow({ devTool: ... })` 控制窗口对本地 DevTools UI 的配置。

`HOSTRA_CDP_PORT` 控制整个 Electron instance 的 remote debugging capability。

两者独立建模，不应让 window-level `devTool` 成为 E2E 是否可调试的隐式开关。

对于 `devTools: false` 与 remote CDP target 的实际 Electron 行为，应增加真实 smoke test 固化，而不是依赖假设。

---

## 11. Electron 版本确定性

### 11.1 当前风险

Hostra 当前安装阶段获取 `electron/latest`，导致同一个 Hostra 版本在不同安装时间可能得到不同 Electron 版本。

这会造成：

```text
Hostra code 没变
测试代码没变
Electron implicit version 变了
结果发生变化
```

### 11.2 建议

Hostra release 应固定一个默认 Electron version。

例如在 package metadata 中维护：

```json
{
  "hostra": {
    "electronVersion": "<pinned-version>"
  }
}
```

`download-electron.js` 默认读取 package 中固定版本，而不是查询 `electron/latest`。

允许显式 override：

```env
HOSTRA_ELECTRON_VERSION=<version>
```

优先级：

```text
explicit HOSTRA_ELECTRON_VERSION
    > package pinned Electron version
```

不再存在默认 `latest` fallback。

一个可重复的 Hostra 环境至少应该能描述为：

```text
Hostra version
+ Electron version
+ host OS/arch
```

---

## 12. Automated Smoke / E2E Tests

Hostra 自身应增加最小自动化测试，不测试上层业务。

### 12.1 Unit tests

覆盖：

- `.env` parsing；
- config priority；
- command parsing；
- endpoint/config validation；
- Host event serialization；
- Electron version resolution。

### 12.2 RPC integration tests

覆盖：

- token accepted/rejected；
- invalid JSON；
- method not found；
- `getHostInfo`；
- window registry semantics；
- `getAllWindows()` metadata；
- event notification serialization。

如果 BrowserWindow 依赖 Electron runtime，则不强行在纯 Node 层模拟全部行为。

### 12.3 Real Electron smoke test

至少覆盖：

```text
Hostra boots
-> emits hostra.ready
-> RPC accepts connection
-> getHostInfo succeeds
-> openWindow(local fixture)
-> window.created
-> getAllWindows exposes windowId + webContentsId
-> closeWindow
-> window.closed
-> Hostra shuts down cleanly
```

注意：不通过 Hostra RPC 判断页面是否 `loaded`；页面生命周期由 CDP smoke test 验证。

### 12.4 Subprocess smoke test

覆盖：

```text
Hostra
-> spawn fixture child
-> subprocess.started
-> child exits 0
-> subprocess.exited
-> Hostra exits
```

以及：

```text
Hostra shutdown
-> SIGTERM child
-> grace period
-> necessary SIGKILL fallback
```

### 12.5 CDP smoke test

启用 `HOSTRA_CDP_PORT`：

```text
Hostra boots
-> open local fixture window
-> connect CDP
-> enumerate renderer target
-> correlate target with Hostra window
-> observe page lifecycle via CDP
-> evaluate simple expression / read page marker
-> disconnect
```

目标不是测试 CDP 本身，而是证明：

1. Hostra 正确开启了 Electron remote debugging；
2. Renderer target 可以被标准工具访问；
3. Hostra window 与 CDP target 可以可靠关联；
4. Hostra 不需要复制 Renderer lifecycle API。

Linux CI 如需要显示服务，可使用 Xvfb；不要因为 CI 环境而把真实 Electron smoke test退化成纯 mock。

---

## 13. 建议实施顺序

### Phase A — Deterministic Host

1. 固定默认 Electron version；
2. 增加 `HOSTRA_CDP_PORT`；
3. 增加 `hostra.ready` structured stdout record；
4. 增加 `getHostInfo()`。

### Phase B — Host-level Observability

5. `getAllWindows()` 增加 `webContentsId` 等最小关联信息；
6. 增加 `window.created` / `window.closed` notifications；
7. 增加 `subprocess.*` notifications；
8. 增加 `host.shuttingDown` / `host.rpcClosing` notifications。

### Phase C — Qualification

9. Node-level unit/integration tests；
10. Real Electron smoke test；
11. CDP target correlation + Page lifecycle smoke test；
12. subprocess shutdown/escalation test；
13. CI qualification on supported desktop environments。

---

## 14. 初步完成标准

Hostra 可以被认为具备 E2E Host baseline，当以下链路可自动重复通过：

```text
spawn Hostra
-> receive hostra.ready
-> connect Hostra RPC
-> inspect getHostInfo
-> create BrowserWindow
-> observe window.created
-> correlate Hostra window with CDP target
-> inspect Renderer/Page through CDP
-> close BrowserWindow
-> observe window.closed
-> observe subprocess lifecycle
-> trigger shutdown
-> child-process lifecycle converges
-> Hostra exits with expected code
```

并且：

- 相同 Hostra 版本默认使用相同 Electron 版本；
- 自动化不依赖固定 sleep；
- 自动化不依赖解析自然语言日志；
- Hostra RPC 不承载 Renderer/Page 自动化语义；
- Renderer/Page lifecycle 以 CDP 为唯一标准入口；
- CDP 默认关闭；
- Hostra 只维护 Host-level authority 和物理事实。

---

## 15. 非目标

本轮明确不做：

- 多 Hostra 实例并行隔离；
- 自动分配 RPC/CDP 端口；
- Playwright/Puppeteer wrapper；
- DOM/query/click/type API；
- screenshot RPC；
- Hostra 自己的 Page lifecycle RPC；
- 业务应用 ready protocol；
- 业务专用 RPC；
- subprocess restart / crash recovery policy；
- Electron sandbox policy redesign；
- CDP proxy。

---

## 16. Open Questions

在进入实现前，需要用真实 Electron smoke test确认以下细节：

1. `devTools: false` 时 remote CDP target 的可访问行为；
2. `webContentsId` 与 CDP target 的最佳稳定关联方式；
3. Hostra ready record 应由 Electron main process 直接输出，还是由外层 `hostra.js` 转发并标准化；
4. `hostra.ready` 与 `HOSTRA_SUBCMD` spawn 的精确时序；
5. RPC closing event 在 shutdown 路径中可保证到什么程度；
6. Electron pinned version 在 package metadata 中的最终存放位置和发布流程。
