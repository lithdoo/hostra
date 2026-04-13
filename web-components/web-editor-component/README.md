# @web-editor/component

基于 **Monaco Editor**（`@codingame/monaco-vscode-editor-api`）与 **monaco-languageclient** 的浏览器端代码编辑器，封装为原生 **Web Component**（`<code-editor>`），可通过 **WebSocket** 连接任意实现 LSP 桥接的服务端（例如同仓库的 `@web-editor/lsp-ws-server`）。

---

## 功能概览

| 能力 | 说明 |
|------|------|
| 语法高亮 | Classic 模式：`typescript` / `markdown` 使用 `@codingame/monaco-vscode-standalone-languages` 懒加载 Monarch；`json` / `toml` 使用内置 Monarch |
| LSP | 通过 `LanguageClientWrapper` + `vscode-ws-jsonrpc` 走 WebSocket，支持补全、悬停、诊断等（取决于语言服务器） |
| 框架无关 | 标准 Custom Elements，可用于 Vue / React / 原生 HTML |
| 多实例 | 每个 `<code-editor>` 独立模型与 LSP 连接；**monaco-vscode-api 全局仅初始化一次** |

---

## 技术栈

- **TypeScript**
- **Vite**（library 模式打包）
- **monaco-languageclient** 10.x（Classic + `EditorService`）
- **@codingame/monaco-vscode-***（与 monaco-languageclient 对齐的版本线，如 `^25.1.2`）
- **vscode-ws-jsonrpc**（随 monaco-languageclient 使用）

---

## 目录结构（`src/`）

```
src/
├── index.ts                 # 入口：注册 <code-editor>、导出 API
├── component/
│   └── code-editor.ts       # 自定义元素：属性、生命周期、ResizeObserver
├── editor/
│   ├── monaco-bootstrap.ts  # 全局 MonacoVscodeApiWrapper（仅一次）
│   ├── standalone-language-contributions.ts  # TS/JS/MD Monarch 贡献
│   ├── virtual-workspace.ts # 内存 file 覆盖层，避免 Windows 误访问真实盘符
│   └── editor-app-factory.ts # EditorApp 配置（languageDef / theme 等）
├── lsp/
│   ├── language-client.ts   # LanguageClientWrapper 配置与启停
│   ├── lsp-connection-url.ts # 为 lsp-ws-server 拼接 ?language=
│   └── monaco-lsp-adapter.ts # 宿主事件：文本变更、光标、诊断
└── languages/
    └── registry.ts          # language 属性 → Monaco id、路径、Monarch（JSON/TOML）
```

---

## 自定义元素：`<code-editor>`

### 属性

| 属性 | 说明 |
|------|------|
| `language` | `typescript` \| `json` \| `markdown` \| `toml`（别名：`ts`、`md`、`jsonc` 等，见 `parseEditorLanguage`） |
| `lsp-url` | WebSocket **基础地址**，例如 `ws://127.0.0.1:8080/lsp`。组件会**自动**追加查询参数 `language=<与属性一致>`，以便后端路由到正确语言服务。留空则仅编辑器、不启动 LSP。 |
| `value` | 初始文本。大内容建议用 JS **`element.value = '...'`**（属性长度受限）。 |

### 属性与 property

- 设置 **`value` 属性**（property 未赋值时）会同步到模型。
- 通过 **`element.value = '...'`** 赋值后，以 property 为准，优先于属性。

### 自定义事件（联调 / UI）

在连接 LSP 且 `connectMonacoLspBridge` 生效时，元素会派发：

| 事件 | `detail` 要点 |
|------|----------------|
| `editor-text-changed` | `changeCount`、`versionId` |
| `editor-cursor-position` | `lineNumber`、`column`、`reason` |
| `lsp-diagnostics` | `uri`、`markers` |

事件 `bubbles: true`，`composed: true`，可在父级监听。

### 方法

- **`whenReady(): Promise<void>`**  
  等待当前一轮 bootstrap（Monaco + 可选 LSP）完成，便于测试或串联逻辑。

---

## 构建与产物

```bash
cd packages/web-editor-component
npm install
npm run build
```

产物在 **`dist/`**（需整体部署，含 `assets/` 下的 worker 分块）：

| 文件 | 用途 |
|------|------|
| `web-editor-component.js` | ESM 主入口 |
| `web-editor-component.css` | 编辑器 / workbench 样式，**必须引入** |
| `assets/*` | Worker 等，相对主入口加载（Vite `base: './'`） |

```bash
npm run typecheck   # 仅类型检查
npm run dev         # vite build --watch
```

---

## 在页面中使用

### 1. 静态资源 + `<code-editor>`

```html
<link rel="stylesheet" href="/path/to/dist/web-editor-component.css" />
<script type="module" src="/path/to/dist/web-editor-component.js"></script>

<code-editor
  language="typescript"
  lsp-url="ws://127.0.0.1:8080/lsp"
  value="const x = 1;"
></code-editor>
```

加载模块后会**自动**执行 `customElements.define('code-editor', ...)`。

### 2. 作为 npm 包（ESM）

```ts
import '@web-editor/component/web-editor-component.css';
import {
  defineCodeEditorElement,
  CodeEditorElement,
  buildLspWebSocketUrl,
  // …
} from '@web-editor/component';
```

也可调用 **`defineCodeEditorElement('my-editor')`** 使用自定义标签名（需自行避免与默认 `code-editor` 重复注册冲突）。

---

## 与 `@web-editor/lsp-ws-server` 的配合

1. 先启动 LSP WebSocket 服务（默认路径 **`/lsp`**，查询参数 **`language`**）。
2. `lsp-url` 写 **`ws://主机:端口/lsp`** 即可；组件会把 `language` 属性同步为查询参数。
3. 浏览器侧文档 URI 为虚拟的 **`file:///workspace/...`**；服务端会将该前缀映射到**会话临时目录**（详见 lsp-ws-server README），避免 Windows 上 `C:\workspace` 一类路径错误。

---

## 导出的编程式 API（节选）

| 符号 | 用途 |
|------|------|
| `defineCodeEditorElement` | 注册自定义标签 |
| `CodeEditorElement` | 类引用 |
| `buildLspWebSocketUrl(base, editorLanguage)` | 拼接带 `language` 的 WS URL |
| `createLanguageClientConfig` / `startLanguageClient` / `disposeLanguageClient` | 非 Web Component 场景自建客户端 |
| `connectMonacoLspBridge` | 挂载诊断 / 光标等宿主事件 |
| `parseEditorLanguage` / `getLanguageRegistration` | 语言解析与注册表 |

---

## 架构上的注意点

1. **全局初始化**  
   `MonacoVscodeApiWrapper.start()` 在同一页面通常只应成功执行一次；多个 `<code-editor>` 共享该环境，各自使用独立 `EditorApp` 与 `LanguageClientWrapper`。

2. **Classic 与扩展宿主**  
   当前配置关闭默认 **extension host** 加载，并合并 **views** 等必要 override，以减少「未注册服务」类错误；若你自行改 `monaco-bootstrap.ts`，需对照 monaco-languageclient / monaco-vscode-api 文档。

3. **Worker 与部署**  
   必须保证浏览器能按相对路径加载 `dist/assets/*`；不要用会破坏相对路径的 CDN 规则 unless 同步调整 `base` 或 worker URL。

4. **COOP / COEP**  
   若启用依赖 `SharedArrayBuffer` 的能力，可能需为页面配置 `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`；一般 demo 可不配。

5. **体积**  
   完整 bundle 体积较大，属 Monaco + VS Code 兼容栈常态；生产环境可配合 CDN、HTTP 压缩与缓存。

---

## 常见问题

**Q：没有语法高亮？**  
确认已引入 **`web-editor-component.css`**；`typescript` / `markdown` 依赖 standalone-languages 贡献，勿在 `EditorApp` 里对同一 `languageId` 再重复 `register` 覆盖 tokenizer（当前 `editor-app-factory` 已区分处理）。

**Q：LSP 连上但无诊断？**  
检查 WS 地址、服务端语言参数、以及服务端 URI 重写是否正常；浏览器控制台与 lsp-ws-server 日志一并查看。

**Q：`value` 很大怎么办？**  
使用 **`element.value = ...`**，避免超长 HTML 属性。

---

## 许可证

以仓库根目录 **LICENSE** 为准（若未单独声明，则与 monorepo 一致）。
