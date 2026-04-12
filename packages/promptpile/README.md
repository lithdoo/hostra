# promptpile

将目录中的 Markdown 对话片段按顺序组装成 **OpenAI Chat Completions** 所需的消息列表，调用大模型 API 并输出回复。适合用「一个文件一条消息」的方式维护多轮对话上下文，再由命令行一键发起请求。

---

## 目录

- [功能概览](#功能概览)
- [工作原理](#工作原理)
- [环境要求](#环境要求)
- [安装](#安装)
- [消息文件约定（重要）](#消息文件约定重要)
- [配置说明](#配置说明)
- [命令行用法](#命令行用法)
- [输出格式](#输出格式)
- [与 OpenAI 兼容的网关](#与-openai-兼容的网关)
- [开发](#开发)
- [项目结构](#项目结构)
- [安全与隐私](#安全与隐私)
- [常见问题与排查](#常见问题与排查)
- [许可证](#许可证)

---

## 功能概览

- **递归扫描**指定目录下所有符合命名规则的 `.md` 或 `.json` 文件。
- 按文件名中的 **序号** 排序，拼成 `role` + `content` 的消息数组。
- 通过 **`node-fetch`** 向兼容端点发起 `POST .../chat/completions` 请求。
- 支持通过 **环境变量** 与 **命令行参数** 配置目录、模型、API Key、Base URL、输出格式。
- 支持 **JSON** 或 **纯文本** 两种控制台输出，便于脚本集成或人工阅读。

---

## 工作原理

1. 解析 CLI 参数，并与 `.env` / 环境变量合并为最终配置（见 [配置说明](#配置说明)）。
2. 校验 **API Key** 是否存在；不存在则退出并提示错误。
3. 从配置的 `directory` 开始 **深度优先**遍历子目录，收集文件名匹配 `^\[(\d+)\](.+?)\.(md|json)$` 的文件（扩展名不区分大小写）。
4. 按捕获组中的数字 **升序**排序（同一序号的多文件顺序依赖遍历顺序，建议避免重复序号）。
5. 依次读取每个文件：`.md` 在去掉可选的 YAML front matter（见下）后作为 `content`；`.json` 为全文 UTF-8 字符串作为 `content`。捕获组中的 **角色名**（不含扩展名）作为 `role`。
6. 使用 `fetch`（来自 `node-fetch`）请求 `{baseURL}/chat/completions`，解析 JSON 后取 `choices[0].message.content` 作为结果输出。

角色字符串会原样传给 API，并在 TypeScript 侧断言为 `user` | `assistant` | `system`。请使用 API 接受的 role 名称（常见为 `system`、`user`、`assistant`），否则可能收到 400 错误。

---

## 环境要求

- **Node.js**：建议 **18+**（项目使用较新的 `@types/node`；`node-fetch` v3 为 ESM，若未来改为直接 import 需注意运行环境）。
- 可访问大模型 API 的网络环境（或自建兼容网关）。

---

## 安装

在包目录内：

```bash
cd packages/promptpile
npm install
```

全局安装本包（若仓库以 workspace 发布，请按你实际的 monorepo 方式安装）：

```bash
npm install -g .
```

本地开发推荐使用 `npm link`：

```bash
cd packages/promptpile
npm link
promptpile --help
```

安装后若 `promptpile` 命令不可用，可直接使用：

```bash
node dist/index.js --help
# 或
npm start -- --help
```

> **说明**：`package.json` 的 `bin` 指向 `dist/index.js`，并通过 `prepare` 自动构建可执行产物。若终端里仍找不到命令，请检查全局 npm bin 目录是否在 PATH 中。

---

## 消息文件约定（重要）

### 文件名格式

必须严格匹配（正则）：

```text
^\[(\d+)\](.+?)\.(md|json)$
```

即：

- 以 **`[` + 数字 + `]`** 开头，表示排序序号；
- 紧跟 **角色名**（将作为 API 的 `role`）；
- 扩展名为 **`.md`** 或 **`.json`**。

### 示例

| 文件名 | 序号 | role | 说明 |
|--------|------|------|------|
| `[0]system.md` | 0 | `system` | 系统提示 |
| `[1]user.md` | 1 | `user` | 用户消息 |
| `[2]assistant.md` | 2 | `assistant` | 助手历史回复（可选） |
| `[3]user.md` | 3 | `user` | 下一轮用户输入 |
| `[4]user.json` | 4 | `user` | 整条消息为 JSON 文件原文（字符串），不解析字段 |

### 文件内容

- **Markdown（`.md`）**：若文件以 YAML front matter 开头（首行为 `---`，之后某一行单独为 `---` 闭合），则 **仅去掉该元数据块**，剩余正文作为 `content`；否则全文作为 `content`。正文**不会**再解析为 Markdown AST；模型看到的是纯文本。
- **JSON（`.json`）**：**完整文件内容**（UTF-8）作为 `content`，不按 JSON 结构抽取字段。
- 子目录中的匹配文件 **同样会被扫描**，与深度遍历顺序有关；排序仍只依据文件名中的数字。

### 序号与重复

- 排序键为文件名中的整数；**相同序号**的文件之间顺序取决于文件系统遍历顺序，**不建议**依赖未定义顺序。
- 若目录下没有任何匹配文件，程序会报错退出：`No files found matching the pattern [{idx}]{role}.md or [{idx}]{role}.json`。

---

## 配置说明

配置优先级（后者覆盖前者，与 `loadConfig` 实现一致）：

1. 环境变量 / `.env`（`dotenv` 在 `config` 模块加载时自动读取当前工作目录下的 `.env`）
2. CLI 参数

### 环境变量

| 变量 | 含义 | 默认值（未设置 CLI 时） |
|------|------|-------------------------|
| `DEFAULT_DIRECTORY` | 扫描根目录 | `./messages` |
| `AI_MODEL` | 模型名 | `gpt-3.5-turbo` |
| `AI_API_KEY` | API 密钥 | 空（必填，否则退出） |
| `AI_API_BASE_URL` | API 根地址 | `https://api.openai.com/v1` |
| `OUTPUT_FILE` | 将模型回复写入文件路径 | 空（默认不写文件） |
| `QUIET` | 静默模式（`1/true/yes/on` 为启用） | 关闭 |

### CLI 参数

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-d, --directory <path>` | 扫描目录 | 默认不设置（由 `DEFAULT_DIRECTORY` 或 `./messages` 决定） |
| `-m, --model <model>` | 模型 ID | 默认不设置（由 `AI_MODEL` 或 `gpt-3.5-turbo` 决定） |
| `-k, --api-key <key>` | API Key | 无 |
| `-b, --api-base-url <url>` | Base URL | `https://api.openai.com/v1` |
| `-o, --output <path>` | 输出文件路径（保存模型回复） | 无 |
| `-q, --quiet` | 静默模式：不打印过程日志和响应正文 | 关闭 |
| `-f, --format <format>` | `text` 或 `json` | `text` |
| `-i, --input` | 在终端读取输入并保存为下一条 `user` 消息后再执行 | 关闭 |
| `-c, --continue` | 将本次 assistant 回复追加为下一条消息文件 | 关闭 |

查看帮助：

```bash
node dist/index.js --help
```

---

## 命令行用法

### 最小示例

1. 准备目录（例如 `./messages`）与文件：

```text
messages/
  [0]system.md
  [1]user.md
```

2. 设置密钥并运行：

```bash
# Windows PowerShell
$env:AI_API_KEY="sk-..."
node dist/index.js -d ./messages

# 或使用 .env 文件（放在运行时的当前工作目录）
```

### 指定模型与 JSON 输出

```bash
node dist/index.js -d ./messages -m gpt-4o -f json
```

### 继续会话（保存 assistant 回复）

```bash
node dist/index.js -d ./messages --continue
```

启用后会在 `directory` 根目录下追加新文件：`[nextIdx]assistant.md`，用于下一轮继续对话。

### 终端输入并执行

```bash
node dist/index.js -d ./messages --input
```

启用后会先在终端等待输入，将输入保存为 `directory` 根目录下的 `[nextIdx]user.md`，然后再调用模型执行。

### nextIdx 计算规则

- `nextIdx` 按当前目录已匹配到的消息文件中 **最大 idx + 1** 计算。
- 若目标文件名已存在（例如已有同序号同角色文件），会继续递增直到找到可用文件名。
- 不要求 idx 连续；例如现有 `[0]... [1]... [3]...`，下一条会从 `[4]...` 开始尝试。

### 使用自建兼容网关

```bash
node dist/index.js -b https://your-gateway.example/v1 -k your-key -m your-model-id
```

### 将回复保存到文件

```bash
node dist/index.js -d ./messages -o ./outputs/last-response.txt
```

或使用环境变量：

```bash
# Windows PowerShell
$env:OUTPUT_FILE="./outputs/last-response.txt"
node dist/index.js -d ./messages
```

### 静默模式（建议与输出文件配合）

```bash
node dist/index.js -d ./messages -o ./outputs/last-response.txt --quiet
```

或使用环境变量：

```bash
# Windows PowerShell
$env:QUIET="true"
node dist/index.js -d ./messages -o ./outputs/last-response.txt
```

---

## 输出格式

### `text`（默认）

在标准输出打印分隔线包裹的模型回复文本。

### `json`

输出形如：

```json
{
  "response": "模型返回的字符串内容"
}
```

便于 `jq` 或其它脚本解析。

---

## 与 OpenAI 兼容的网关

本工具使用 `node-fetch` 直接调用 HTTP 接口，通过 `AI_API_BASE_URL`（或 `-b`）与 `AI_API_KEY`（或 `-k`）指向任意 **OpenAI Chat Completions 兼容** 的服务端（如部分云厂商、本地 `vLLM`/`llama.cpp` 的 OpenAI 兼容层等）。请注意：

- **路径**：默认 Base URL 为 `https://api.openai.com/v1`；若网关要求不含 `/v1` 或要求额外路径，需按对方文档填写 `-b` / `AI_API_BASE_URL`。
- **模型名**：`-m` 必须与网关识别的模型 ID 一致。

---

## 开发

| 命令 | 说明 |
|------|------|
| `npm run build` | `tsc` 编译到 `dist/` |
| `npm run dev` | 使用 `ts-node` 直接运行 `src/index.ts` |
| `npm start` | 运行 `node dist/index.js`（需先 `build`） |

TypeScript 配置见根目录 `tsconfig.json`（`strict: true`，输出 CommonJS）。

---

## 项目结构

```text
packages/promptpile/
├── src/
│   ├── index.ts        # 入口：编排扫描、读文件、调 API、打印结果
│   ├── cli.ts          # Commander：CLI 定义与选项解析
│   ├── config.ts       # dotenv + 配置合并
│   ├── file-handler.ts # 目录扫描、文件命名解析、读取为 Message[]
│   ├── ai-client.ts    # node-fetch 调用 chat/completions
│   └── types.ts        # Config / Message / FileInfo
├── dist/               # 编译产物（运行入口）
├── package.json
├── tsconfig.json
└── README.md
```

---

## 安全与隐私

- **API Key**：勿将真实密钥提交到仓库；优先使用环境变量或本地 `.env`（并将 `.env` 加入 `.gitignore`）。
- **日志**：当前实现在调用 API 前会将 **完整 `messages` 数组** 以 `JSON.stringify` 打印到控制台（见 `ai-client.ts`）。若消息含敏感数据，请注意截屏、日志采集与 CI 输出。
- **网络**：请求发往 `apiBaseUrl` 所指向的服务器，请确认合规与数据出境要求。

---

## 常见问题与排查

| 现象 | 可能原因 | 处理建议 |
|------|----------|----------|
| `AI API key is required` | 未设置 `-k` 且环境变量无 `AI_API_KEY` | 设置密钥或传入 `-k` |
| `No files found matching the pattern` | 目录下无匹配命名的 `.md` / `.json` 文件 | 检查文件名是否为 `[数字]角色.md` 或 `[数字]角色.json` |
| HTTP 400 / invalid role | `role` 不是 API 支持的值 | 使用 `system` / `user` / `assistant` 等 |
| 连接失败 | 网络、代理、Base URL 错误 | 检查 `-b`、防火墙与网关文档 |
| 模型不存在 | `-m` 与服务商不匹配 | 换成该 Base URL 下列出的模型 ID |

---

## 许可证

以 `package.json` 中的 `license` 字段为准（当前为 `ISC`）。
