# file-view-ws-server

一个用于 file-view 场景的最小化 WebSocket JSON-RPC 2.0 服务骨架。

## 运行方式

```bash
npm install
npm run build
npm run start
```

默认端点：

- 健康检查：`http://127.0.0.1:8081/health`
- WebSocket JSON-RPC：`ws://127.0.0.1:8081/rpc`
- 文件二进制下载：`POST http://127.0.0.1:8081/file/blob`

可通过环境变量覆盖 host/port：

```bash
HOST=0.0.0.0 PORT=8081 npm run dev
```

## 运行测试

```bash
npm test
```

当前测试覆盖：

- `connection` 核心行为（`changeTargetDir/getState/clearTargetDir`）
- meta/thumb 关联规则（仅主对象识别，孤儿附属文件忽略）
- `handlers` 参数校验与 `fv.*` 调用委托
- `server` 的 ws + JSON-RPC 绑定与通知推送

## JSON-RPC 请求示例

发送：

```json
{"jsonrpc":"2.0","id":1,"method":"rpc.ping","params":{}}
```

接收：

```json
{"jsonrpc":"2.0","id":1,"result":{"ok":true}}
```

## HTTP 接口

### `POST /file/blob`

用途：按 `fileUrl` 返回对应文件的二进制数据流（复用与 ws 相同端口）。

请求体（JSON）：

```json
{"fileUrl":"file:///D:/data/a.txt"}
```

请求体大小限制：`20MB`（超出返回 `413`）。

成功响应：

- 状态码：`200`
- `content-type: application/octet-stream`
- 响应体：文件二进制流

示例：

```bash
curl -X POST "http://127.0.0.1:8081/file/blob" \
  -H "content-type: application/json" \
  -d "{\"fileUrl\":\"file:///D:/data/a.txt\"}" \
  --output a.txt
```

错误码：

- `400`：请求体非法、缺少参数、目标不是普通文件
- `413`：请求体过大
- `422`：`fileUrl` 不是 `file://` 协议
- `404`：文件不存在
- `500`：文件读取失败

## File-View JSON-RPC 接口设计

该 JSON-RPC 设计来源于 `src/connection.ts` 中的 `IFVWsConnection`。

当前版本中，以下方法与通知已绑定到运行时 WebSocket 服务（每个连接拥有独立 watcher 状态）：

- 已实现请求：`fv.changeTargetDir`、`fv.clearTargetDir`、`fv.getState`
- 已实现通知：`fv.onFileChange`、`fv.onTargetDirChange`

### 请求方法（Request）

- `fv.changeTargetDir`
  - 参数：`{ "targetDirFileUrl": "file:///..." }`
  - 返回：`IFVState`
- `fv.clearTargetDir`
  - 参数：`{}`
  - 返回：`IFVState`
- `fv.getState`
  - 参数：`{}`
  - 返回：`IFVState`

### 服务端通知（Notification）

- `fv.onFileChange`
  - 参数：
    - `type`：`"add" | "remove" | "update"`
    - `file`：`FVFile | FVDirectory`
- `fv.onTargetDirChange`
  - 参数：
    - `state`：`IFVState`

### 数据模型

`IFVState` 示例：

```json
{
  "fileList": [
    {
      "kind": "file",
      "name": "a.txt",
      "fileUrl": "file:///D:/data/a.txt",
      "hidden": false,
      "metadataFileUrl": "file:///D:/data/a.txt.meta.toml",
      "thumbnailFileUrl": "file:///D:/data/a.txt.thumb.jpg",
      "metadata": {
        "info": {
          "title": "示例标题",
          "describe": "示例描述",
          "tags": ["tag1", "tag2"]
        },
        "extends": {
          "rating": 5
        }
      }
    }
  ],
  "targetDir": {
    "kind": "directory",
    "name": "[FILE_VIEW] data",
    "fileUrl": "file:///D:/data",
    "hidden": false
  }
}
```

说明：

- `fileList` 只包含主对象（文件/目录）。
- `{name}.meta.toml` 与 `{name}.thumb.{ext}` 会挂载到对应主对象字段。
- 缩略图扩展名仅支持小写：`png`、`jpg`、`jpeg`、`gif`、`svg`。
- 非白名单扩展名（如 `webp`）或大写扩展名（如 `JPG`）会被忽略。
- `.meta.toml` 可解析时会填充 `metadata` 字段（`info/extends`）。
- 没有主对象的孤儿元数据/缩略图文件会被忽略，不进入 `fileList`。
- 若 `.meta.toml` 解析失败，不会中断目录刷新，当前对象的 `metadata` 返回 `undefined`。

### 典型调用流程

1. 客户端调用 `fv.changeTargetDir`。
2. 服务端返回当前 `IFVState`。
3. 监听期间服务端持续推送：
   - `fv.onFileChange`
   - `fv.onTargetDirChange`
4. 客户端可随时调用 `fv.getState` 进行手动刷新。

### 方法示例

切换目标目录：

```json
{"jsonrpc":"2.0","id":101,"method":"fv.changeTargetDir","params":{"targetDirFileUrl":"file:///D:/workspace/[FILE_VIEW]%20media"}}
```

获取当前状态：

```json
{"jsonrpc":"2.0","id":102,"method":"fv.getState","params":{}}
```

清空目标目录：

```json
{"jsonrpc":"2.0","id":103,"method":"fv.clearTargetDir","params":{}}
```

文件变化通知：

```json
{"jsonrpc":"2.0","method":"fv.onFileChange","params":{"type":"update","file":{"kind":"file","name":"a.txt","fileUrl":"file:///D:/data/a.txt","hidden":false}}}
```

## 错误处理

服务端返回标准 JSON-RPC 错误码：

- `-32700 Parse error`
- `-32600 Invalid Request`
- `-32601 Method not found`
- `-32603 Internal error`

推荐的 file-view 业务错误码：

- `-32001` 目标目录不存在
- `-32002` 目标路径不是目录
- `-32003` 监听器初始化或刷新失败

