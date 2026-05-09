# hostra example

用于集中存放 `hostra` 仓库内各个包的参考示例。

## 目录约定

- 建议按包名分目录：`example/<package-name>/...`
- 每个示例目录至少包含一个简短 `README.md`，说明运行方式
- 示例代码尽量使用相对本仓库的本地依赖路径，便于直接验证

## 初始化后建议

1. 为每个包创建子目录，例如：
   - `example/hostra/`
   - `example/promptpile/`
   - `example/tomlith/`
2. 在各子目录放最小可运行示例与说明文档
3. 执行 `npm run list` 查看约定提示

## 已有示例

- `promptpile-mcp-launcher/`：`promptpile-mcp launch` + filesystem / fetch / Playwright MCP（stdio + 本机 HTTP 网关）最小示例
- `hostra-open-web/`：通过 `hostra` 的 JSON-RPC `openWindow` 打开本地网页
- `hostra-web-editor/`：通过 `hostra` 打开 `web-editor-component` 编辑器窗口，并联动 `lsp-ws-server`
- `hostra-file-view/`：通过 `hostra` 打开 `file-view-component` + icons UI，并联动 `file-view-ws-server`（静态页 `4174`，file-view 服务 `8081`）
