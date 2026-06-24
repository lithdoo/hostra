# hostra-open-web

通过 `hostra` 启动 Electron，并在子进程里调用 JSON-RPC `openWindow` 打开网页的最小示例。

## 文件说明

- `index.html`：被打开的网页
- `app.js`：连接 `ws://localhost:<port>` 并调用 `openWindow`
- `.env.example`：用于启动 `hostra` 的环境变量模板

## 运行步骤

Windows 下可直接运行：

```bat
hostra-open-web\run-example.bat
```

该脚本会自动：

- 若缺失 `examples/.env`，从 `hostra-open-web/.env.example` 复制
- 若缺失 `examples/node_modules`，执行 `npm install`
- 启动 `npx hostra`

---

在仓库根目录执行：

```bash
cd examples
npm install
```

复制环境变量模板并按需修改：

```bash
cp hostra-open-web/.env.example .env
```

Windows PowerShell 可用：

```powershell
Copy-Item .\hostra-open-web\.env.example .\.env
```

启动：

```bash
npx hostra
```

当看到日志里出现 `openWindow success`，说明示例已成功打开网页窗口。
