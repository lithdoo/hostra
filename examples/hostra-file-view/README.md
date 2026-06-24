# hostra-file-view

通过 `hostra` 打开一个本地页面，并联动：

- `@web-editor/file-view-ws-server`
- `@web-editor/file-view-component`（含 icons 平铺 UI）

页面默认将 `demo-files/` 目录作为 `file-view` 的浏览根目录（由 `app.js` 注入 `file://` URL，无需手改盘符）。

## 运行前准备

确保这两个项目已构建：

```bash
cd web-components/file-view-ws-server && npm install && npm run build
cd ../file-view-component && npm install && npm run build
```

## 启动示例（Windows）

```bat
run-example.bat
```

脚本会：

1. 同步 `.env`
2. 在 `examples` 层安装依赖（如缺失）
3. 启动 `npx --prefix ".." hostra`

## 端口说明

- Hostra RPC：`9333`
- 静态页面：`4174`（与 `hostra-web-editor` 的 `4173` 错开，便于同时跑两个示例）
- File-view WebSocket / HTTP：`8081`（健康检查 `http://127.0.0.1:8081/health`，JSON-RPC `ws://127.0.0.1:8081/rpc`）
