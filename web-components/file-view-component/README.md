# @web-editor/file-view-component

与 [`@web-editor/file-view-ws-server`](../file-view-ws-server/README.md) 配合使用的 **Web Component**（`<file-view>`）。在浏览器中通过 **WebSocket + JSON-RPC 2.0** 调用 `fv.changeTargetDir` / `fv.clearTargetDir` / `fv.getState`，并处理服务端通知 `fv.onFileChange`、`fv.onTargetDirChange`，在元素上维护 **`currentState`**。`<file-view>` **本身不渲染**目录列表；可选子包 **`@web-editor/file-view-component/icons`** 提供顶栏 + 图标平铺视图。按 `fileUrl` 拉取二进制请使用服务端同口的 **`POST /file/blob`**（由页面或其它模块自行请求）。

---

## 属性

| 属性 | 说明 |
|------|------|
| `url` | `file-view-ws-server` 的 **WebSocket JSON-RPC** 地址，例如 `ws://127.0.0.1:8081/rpc`（见服务端 README「默认端点」）。 |
| `target` | 绑定监听目录：作为 **`targetDirFileUrl`** 传给 `fv.changeTargetDir`（建议 `file:///...`）。属性为空或缺失时，在已连接状态下会调用 **`fv.clearTargetDir`**。 |
| `auto-reconnect-timeout` | **自动重连**：属性为空、缺失或无法解析为 **非负数字** 时，断线后**不**自动重连。为数字时单位为 **毫秒**（两次建立 WebSocket 之间的间隔，`0` 表示尽快重连）。仅在 **非主动** 断开（网络中断、对端关闭等）时生效；变更 `url`、从文档移除元素、组件内部主动关闭连接时不会按此定时重连，并会清除已安排的定时器。 |

---

## 自定义事件（`bubbles: true`，`composed: true`）

| 事件 | `detail` |
|------|-----------|
| `fv-connection-change` | `{ status: 'connecting' \| 'open' \| 'closed' \| 'error'; error?: string }` |
| `fv-state-changed` | `{ state: IFVState }` |
| `fv-file-change` | `{ type: 'add' \| 'remove' \| 'update'; file: FVFile \| FVDirectory }` |
| `fv-selection-changed` | `{ fileUrls: readonly string[] }` — 本地选中集变化（与 JSON-RPC 无关）；`fileUrls` 顺序与当前 `state.fileList` 中项的出现顺序一致。 |

`fv.onTargetDirChange` 会触发 **`fv-state-changed`**（全量 `state`）。`fv.onFileChange` 会触发 **`fv-file-change`**，并在本地合并 `fileList` 后再触发 **`fv-state-changed`**。合并或全量更新后，若当前 `fileList` 不再包含某些已选 `fileUrl`，组件会裁剪选中并可能触发 **`fv-selection-changed`**。

---

## 编程式 API（`FileViewElement`）

| 成员 | 说明 |
|------|------|
| `currentState` | 最近一次同步后的快照（`undefined` 表示尚未成功拉取）；每次读取返回 **克隆**，避免外部改动内部引用。 |
| `selectedFileUrls` | 当前选中的 `fileUrl` 列表（只读快照）；顺序与 `currentState.fileList` 中对应项的出现顺序一致；尚无 `currentState` 时为 `[]`。 |
| `setSelectedFileUrls(urls)` | 替换本地选中集；仅保留出现在 **`currentState.fileList`** 中的 URL，其余忽略；`[]` 表示清空；变更时派发 **`fv-selection-changed`**（不调用 RPC）。 |
| `getRemoteState()` | 调用 `fv.getState` 并更新 `currentState`。 |
| `setTargetDir(fileUrl)` | 调用 `fv.changeTargetDir`；**不会**自动写回 `target` 属性。 |
| `clearTargetDir()` | 调用 `fv.clearTargetDir`。 |

JSON-RPC 业务错误会以 **`FvJsonRpcError`**（`code` / `message` / `data`）形式从上述 `Promise` 拒绝；连接失败由 **`fv-connection-change`** 的 `status: 'error'` 反映。

---

## 与 JSON-RPC 的对应关系

与 [file-view-ws-server README「File-View JSON-RPC 接口设计」](../file-view-ws-server/README.md) 一致：

- 请求：`fv.changeTargetDir`、`fv.clearTargetDir`、`fv.getState`
- 通知：`fv.onFileChange`、`fv.onTargetDirChange`

本包另导出 **`FvJsonRpcSession`**，可在非 DOM 场景单独使用（零运行时依赖，仅浏览器内置 `WebSocket`）。

---

## 可选：图标平铺视图（`src/ui`）

在已使用 `<file-view>` 同步 `IFVState` 的前提下，若需要**顶栏（当前目录名 + `fileUrl`）**与**子项图标网格**，可额外加载 **`./icons`** 子入口及其 **CSS**（不加载则无任何视图代码进入页面）。

| 产物 | 用途 |
|------|------|
| `dist/file-view-component-icons.js` | `mountFileViewIcons` 与类型再导出 |
| `dist/file-view-component-icons.css` | 顶栏 / 网格布局样式 |

### 行为说明

- 监听 `<file-view>` 的 **`fv-state-changed`** 与 **`fv-selection-changed`**，用 `detail.state` / `fileView.selectedFileUrls` 重绘。
- **单击**格子：更新 **`fileView.selectedFileUrls`**（`Ctrl` 或 `Cmd` + 单击为**多选**切换当前项）。
- **右键**（`contextmenu`）在格子上：若该项**已在选中**中，**不改变**选中；若**未在选中**中，无修饰键时为**仅选中该项**（替换原多选）；按住 **`Ctrl` 或 `Cmd`** 时为**不清空、把该项加入**当前选中。不在 `grid` 空白处挂监听，**点到网格空白**的左/右键**不改变**选中。
- **目录**格子：**双击**打开子目录（调用 **`fileView.setTargetDir(dir.fileUrl)`**，不写回 `target` 属性）；键盘 **Enter** / **Space** 与双击同效（便于无障碍）。
- **`showParentNav: true`** 且能解析出父级 `file://` URL 时，顶栏显示 **Up**，点击后 `setTargetDir(父路径)`。
- 缩略图与 **`POST /file/blob`** 仍不在本 UI 模块内（与上文一致）。

### 页面示例

```html
<link rel="stylesheet" href="/path/to/dist/file-view-component-icons.css" />

<file-view
  id="fv"
  url="ws://127.0.0.1:8081/rpc"
  target="file:///D:/your/project"
></file-view>
<div id="fv-icons-root"></div>

<script type="module">
  import '/path/to/dist/file-view-component.js';
  import { mountFileViewIcons } from '/path/to/dist/file-view-component-icons.js';

  const fv = document.getElementById('fv');
  const root = document.getElementById('fv-icons-root');
  const handle = mountFileViewIcons({ root, fileView: fv, showParentNav: true });
  // handle.update();  // 可选：在首帧事件前强制与 currentState 对齐
  // handle.dispose(); // 卸载监听并清空 root
</script>
```

### npm 用法

```ts
import type { FileViewElement } from '@web-editor/file-view-component';
import '@web-editor/file-view-component/file-view-component-icons.css';
import { mountFileViewIcons } from '@web-editor/file-view-component/icons';

const fv = document.querySelector('file-view') as FileViewElement;
const root = document.getElementById('fv-icons-root') as HTMLElement;
mountFileViewIcons({ root, fileView: fv });
```

（`./icons` 子路径的类型声明由 `tsc` 生成在 `dist/ui/icons-entry.d.ts`。）

---

## 技术栈

- TypeScript
- Vite（library 模式，**双 ESM 入口**：核心 + icons）

---

## 目录结构（`src/`）

```
src/
├── index.ts
├── component/
│   └── file-view.ts       # `<file-view>`：属性、生命周期、状态与事件
├── rpc/
│   └── fv-json-rpc-session.ts
├── ui/
│   ├── file-view-icons.css
│   ├── icons-model.ts
│   ├── icons-dom.ts
│   ├── mount-file-view-icons.ts
│   └── icons-entry.ts     # 子入口：icons 包 + CSS side-effect
├── vite-env.d.ts
└── types/
    └── fv-models.ts       # 与 ws-server 对齐的数据形状（类型复制）

test/
├── fake-web-socket.ts     # Vitest 用 WebSocket 桩
├── fv-json-rpc-session.test.ts
├── file-view-element.test.ts
└── mount-file-view-icons.test.ts
```

---

## 构建与产物

```bash
cd web-components/file-view-component
npm install
npm run build
```

产物在 **`dist/`**：

| 文件 | 用途 |
|------|------|
| `file-view-component.js` | ESM 主入口（`<file-view>` + RPC 客户端） |
| `file-view-component-icons.js` | 可选 UI：`mountFileViewIcons` |
| `file-view-component-icons.css` | 可选 UI 样式 |
| `index.d.ts` / `ui/*.d.ts` 等 | 类型声明（`tsc --emitDeclarationOnly`） |

```bash
npm run typecheck   # 仅类型检查
npm run dev         # vite build --watch
npm test            # Vitest（happy-dom + FakeWebSocket）
```

---

## 在页面中使用

加载模块后会**自动**执行 `customElements.define('file-view', ...)`。

```html
<script type="module" src="/path/to/dist/file-view-component.js"></script>

<file-view
  url="ws://127.0.0.1:8081/rpc"
  target="file:///D:/your/project"
  auto-reconnect-timeout="3000"
></file-view>
```

```js
const el = document.querySelector('file-view');
el.addEventListener('fv-state-changed', (e) => {
  console.log(e.detail.state);
});
```

### 作为 npm 包（ESM）

```ts
import {
  defineFileViewElement,
  FileViewElement,
  FvJsonRpcSession,
  type FvSelectionChangedDetail,
  type IFVState,
} from '@web-editor/file-view-component';
```

也可调用 **`defineFileViewElement('my-file-view')`** 使用自定义标签名。

---

## 重连与错误

- 未设置 **`auto-reconnect-timeout`**（或值为空、无效）时，断线后**不会**自动重连；可监听 **`fv-connection-change`**（`status: 'closed'` / `'error'`）自行处理。
- 设置为 **毫秒数** 后，在 **意外** 断开 WebSocket 时会在该间隔后再次尝试连接（仍使用当前 `url` / `target`）。变更 `url`、从文档移除元素、或组件内部主动关闭连接时**不会**走该自动重连（并会清除已安排的定时器）。

---

## 许可证

以仓库根目录 **LICENSE** 为准。
