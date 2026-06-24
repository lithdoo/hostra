# hostra-web-editor

通过 `hostra` 打开一个编辑器窗口，并联动：

- `@hostra/web-components/lsp-ws-server`
- `@hostra/web-components/web-editor-component`

## 运行前准备

在 hostra 仓库根目录下，确保这两个项目已构建：

```bash
cd web-components/lsp-ws-server && npm install && npm run build
cd ../web-editor-component && npm install && npm run build
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
- 静态页面：`4173`
- LSP WS：`3001`
