# web-components

用于存放 `lithdoo-lab` workspace 内可复用的 Web Components 组件。

建议约定：

- 一个组件一个子目录
- 每个组件包含最小示例与文档
- 统一导出入口，便于在示例与业务工程复用

## 子项目

| 目录 | 包名 | 说明 |
|------|------|------|
| [`web-editor-component`](web-editor-component/) | `@web-editor/component` | Monaco + LSP 代码编辑器 Web Component |
| [`file-view-component`](file-view-component/) | `@web-editor/file-view-component` | WS + JSON-RPC；可选 `./icons` 平铺视图 |
| [`fsdb-view-component`](fsdb-view-component/) | `@web-editor/fsdb-view-component` | FSDB 视图组件脚手架（无业务实现） |
