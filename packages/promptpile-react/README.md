# promptpile-react

在 **`promptpile` 命令行**之上编排 AI agent（React 式的状态 / 回合模型）。**调用模型时**通过子进程执行 **`promptpile` CLI**（不把 CLI 当 npm 库 `import`）；**默认**使用依赖包 **`promptpile`** 内已构建的 **`dist/index.js`**（以当前 Node **`process.execPath`** 启动），无需全局安装。**`-i` 写入终端用户消息**时，本包依赖 workspace 内的 **`promptpile` npm 包**，引用其 **`file-handler`**（与 `promptpile -i` 写 `[idx]user.md` 的规则一致）。

**当前版本**：解析 CLI、用 `PromptpileReactRuntime` 同步循环调用 `promptpile`（`child_process.spawnSync`），从 `-d` 目录读取 `.react.*.md` 提示词。主循环 **`nextStep()`** 每轮依次 **`reactThoughtProcess()`** → **`reactObserveProcess()`**（不再单独用主 argv 跑一轮「裸」`promptpile`）。二者子进程 argv **不含** 主流程的 `-o`；**`-c`（continueMode）** 有两层含义：见下文「`-i` / `-c`」与 **`react*` 子进程 argv**。

### 运行时与 `PROMPTPILE_BIN`

- **默认**（未设置 **`PROMPTPILE_BIN`**）：解析依赖 **`promptpile`** 的 **`dist/index.js`**，用 **`process.execPath`** 执行；需已在 **`packages/promptpile`** 执行 **`npm install` / `npm run build`** 使 **`dist/`** 存在。
- **回退**：若无法解析到内置脚本（例如单独安装本包且未带 `promptpile` 依赖），则仍尝试命令名 **`promptpile`**（需在 `PATH` 中）。
- **覆盖**：设置环境变量 **`PROMPTPILE_BIN`** 为可执行文件路径或命令名时，**完全**使用该值启动子进程（与旧行为、CI 或自定义包装脚本兼容）。
- **`currentStep`**：已成功完成的 **ReAct 轮数**（每轮 `nextStep` 在 thought 与 observe **均成功**后 +1；从 0 递增）。
- **`--max-step N`**：最多 **N** 轮上述成功；用尽后 `stopReason` 为 `max_step`。
- **未传 `--max-step`**：内部为无上限（`Infinity`），为避免死循环，**入口只执行一轮** `nextStep` 后结束（仍可通过多次手动运行进程实现多轮）。
- **`finalAnswer()`**：委托 **`reactFinalAnswerProcess()`**（见下文）；若 `.react.final.md` 非空则发起一次带 final 注入的 `promptpile`。
- **`stopReason`**：`error` 表示 thought/observe 子进程失败或 observe 读 **`.calls.jsonl` 解析失败**（`nextStep` **catch** `PromptpileReactInvocationError` 等异常后写入，**不向进程外再抛**）；`final` 表示 observe 正常返回 **`false`**（判定不继续）；`max_step` 表示达到步数上限。

## React 提示词文件（`-d` 目录下）

在 **`-d` 指向的目录** 根下可放置三个 Markdown 文件（与消息文件约定同级），供本包读取用户自定义提示词：

| 文件名 | 说明 |
|--------|------|
| `.react.core.md` | 执行核心（core）提示词 |
| `.react.final.md` | 收尾 / 面向用户交付（final）提示词，**可省略或留空** |
| `.react.observe.md` | 观察 / 审视（observe）提示词 |

规则：

- **`core`**：文件不存在或内容仅空白时，使用**内置中文默认**。
- **`observe`**：同上，缺失或空白时使用**内置中文默认**。
- **`final`**：文件不存在或仅空白时视为**空字符串**（无内置默认）。

未传 `-d` 时不会读取上述文件；`core` / `observe` 仍使用内置默认，`final` 为空。

## 主循环 `nextStep`

每轮顺序：

1. 若 `stopReason !== 'running'` 或已达 **`maxStep`** → 置 `max_step` 或直接 return。
2. **`try`**：`reactThoughtProcess()` → **`reactObserveProcess()`**。
3. 二者均**未抛异常**时：`currentStep += 1`；若 `reactObserveProcess()` 返回 **`false`** → **`stopReason = 'final'`**；若返回 **`true`** 且已达有限 **`maxStep`** → **`stopReason = 'max_step'`**。
4. **`catch`**（含 **`PromptpileReactInvocationError`**）→ **`stopReason = 'error'`**（异常**不**冒泡到 CLI `index.ts`）。

## ReAct 思考阶段（`PromptpileReactRuntime.reactThoughtProcess`）

**`reactThoughtProcess()`**：单独一次 `promptpile`，注入 **`prompts.core`**。**`nextStep` 每轮会调用**；也可在外层单独调用。实现类为 **`CoreReactProcess`**（见源码 [`react-processes.ts`](src/react-processes.ts)）。

| 行为 | 说明 |
|------|------|
| **core 注入** | 将 `prompts.core` 写入 **临时 `.md` 文件**（`os.tmpdir()`），向本次 argv 追加 **`--system-inject-file` 绝对路径**；调用结束删除临时文件。不在 `-d` 消息目录内新增 `[idx]*.md` 承载 core。 |
| **`-c` / `--continue`** | 当 CLI 传入 `-c`（`continueMode` 为真）时，**仅在本方法**拼出的 argv 拷贝末尾追加 `-c`，交给 `promptpile` 以保持与消息目录续写语义一致。主流程 `buildForwardedPromptpileArgs()` 仍 **不** 转发 `-c`。 |
| **工具与落盘** | `[idx]assistant.calls.jsonl` / `[idx]assistant.result.jsonl` 及工具执行由 **`promptpile`** 负责；本方法 **不写**、不解析上述文件。 |
| **错误** | 子进程启动失败或非零退出 → **`throw PromptpileReactInvocationError`**（`phase: 'thought'`）。**不修改** `currentStep` / `stopReason`（由 `nextStep` 的 `try/catch` 或外层处理）。 |

## ReAct 观察阶段（`PromptpileReactRuntime.reactObserveProcess`）

**`reactObserveProcess(): boolean`**：单独一次 `promptpile`，用于根据当前消息目录做「是否继续递归」的判定。实现类为 **`ObserveReactProcess`**（[`react-processes.ts`](src/react-processes.ts)）。

| 行为 | 说明 |
|------|------|
| **argv** | 从 `forwardedArgs` **拷贝**后 **移除** `--tools-file`、`-o` / `--output`、`--after-hook-path` 及其参数；再追加 **临时** `--tools-file`（单行 `.tools.jsonl`，内含工具 **`react_observe_decision`**；该行须为 **`promptpile` 扁平工具条目** `{ name, description?, parameters? }`，与默认 `.tools.toml` 内每一项同理）、**`-o`** 指向临时 `.md`（主输出保留在磁盘供排查）。 |
| **after-hook** | 本轮 argv **不带** `--after-hook-path`，避免钩子处理本轮 `.calls.jsonl`。 |
| **observe 注入** | 若 `prompts.observe` 非空，则临时 `.md` + `--system-inject-file`（与 thought 同理）。 |
| **`-c`** | `continueMode` 为真时在本轮 argv 末尾追加 `-c`。 |
| **读盘判定** | 子进程成功后，按 `promptpile` 规则读取 **与 `-o` 主文件同目录的 `{basename}.calls.jsonl`**。**文件不存在**或合法解析后 **无 `decision === true`** → 返回 **`false`**（→ `nextStep` 置 **`final`**）。**`decision === true`** → **`true`**。**读盘失败**或 **非空行非法 JSON**、或目标工具行 **格式非法** → **`throw PromptpileReactInvocationError`**（`phase: 'observe'`）。 |
| **清理** | 解析后 **仅删除**上述 **`.calls.jsonl`**；删除临时 **tools** 与 **inject** 文件；**不删除** `-o` 主输出文件。 |
| **状态** | **不修改** `currentStep` / `stopReason`；`nextStep` 根据返回值与是否抛异常统一更新。 |

## ReAct 收尾（`reactFinalAnswerProcess` / `finalAnswer`）

**`reactFinalAnswerProcess()`**：`prompts.final` 非空时发起一次带 final 注入的 `promptpile`（失败时**不抛**、沿用 soft invoke 的静默返回语义）。**`finalAnswer()`** 当前委托此方法。实现类为 **`FinalReactProcess`**（[`react-processes.ts`](src/react-processes.ts)）。

## `-i` / `-c`（终端输入）

| 标志 | 行为 |
|------|------|
| **`-i`** | **必须先**带 **`-d`**。在本进程按 `promptpile` 同款提示从终端读入多行（Ctrl+Z / Ctrl+D 结束），调用 **`promptpile`** 的 **`scanDirectory` + `appendUserMessage`** 写入下一条 **user** 消息文件。**不会**向子进程传入 `-i`。 |
| **仅 `-i`** | 读入 **一次** → 跑完整 ReAct（`nextStep` 循环 + `finalAnswer()`）→ 退出。 |
| **`-i` + `-c`** | **外层循环**：每轮读入 → append → 新建 **`PromptpileReactRuntime`** → ReAct + `finalAnswer()` → 再次读入…直至某轮 **空输入**（报错退出，与 `promptpile -i` 一致）或 **`Ctrl+C`**。内层各 **`react*`** 子进程仍会按需追加 `-c`（续写消息目录）。 |

首次安装前请在 **`packages/promptpile`** 执行 **`npm run build`**，以便 **`promptpile/dist/file-handler`** 存在。

## 安装与构建

```bash
cd ../promptpile && npm install && npm run build
cd ../promptpile-react
npm install
npm run build
```

安装后入口命令为 **`promptpile-react`**（见 `package.json` 的 `bin`）。

## CLI 选项

与 [promptpile 说明](../promptpile/README.md) 中相关开关对齐；本包只声明下面列出的项。

### 会转发给 `promptpile` 的参数

以下选项由 `buildForwardedPromptpileArgs()` 拼成 **转发 argv**，供 **`reactThoughtProcess` / `reactObserveProcess` / `reactFinalAnswerProcess`** 在各自拷贝上追加注入项使用；**不含** `-i`、`-c`、`-o`（`-c` / 临时 `-o` 仅出现在上述方法的子进程 argv 中，见上文）。**`nextStep` 不再**以此 argv 直接额外调用一轮「裸」`promptpile`。

| 选项 | 说明 |
|------|------|
| `-d, --directory <path>` | 扫描消息文件目录 |
| `-m, --model <model>` | 模型 ID |
| `-k, --api-key <key>` | API Key |
| `-b, --api-base-url <url>` | API Base URL |
| `-q, --quiet` | 静默（与 `promptpile` 一致） |
| `--tools-file <path>` | 仅从该路径加载 tools（`.jsonl` 或 `.toml`）；相对路径相对当前工作目录 |
| `--after-hook-path <path>` | 成功后执行的脚本；相对路径相对当前工作目录 |

未出现在命令行中的项不会加入转发 argv；`promptpile` 仍可使用环境变量及其自身默认值。

### 由本包保留、不转发给 `promptpile` 的参数

| 选项 | 说明 |
|------|------|
| `-i, --input` | 在终端读入并写成下一条 `user` 消息（见上文「`-i` / `-c`」）；**由本包调用 `promptpile` 的 file-handler**，不会作为 `promptpile -i` 传给子进程 |
| `-c, --continue` | **与子进程**：为真时在 **`reactThoughtProcess()`** / **`reactObserveProcess()`** / **`reactFinalAnswerProcess()`** 的子进程 argv 末尾追加 `-c`。**与 `-i` 同时**：另启用外层「读完一轮 ReAct 后再读终端」的循环（见上文表）。主 argv **`buildForwardedPromptpileArgs()`** 仍 **不含** `-c`。 |
| `--max-step <n>` | 主循环最多 **n** 轮成功的 **`nextStep`**（每轮 thought + observe 均成功计 1）；仅本包使用，**不**传给 `promptpile`。未传时入口**只跑一轮** `nextStep`（见上文「运行时」） |

### 本包暂不提供的 `promptpile` 选项

例如 `-f` / `--format`、`--tool-choice` 等：**不在本 CLI 中声明**，也不参与主 argv 转发；**`-o`** 由 **`reactObserveProcess()`** 内部临时使用，主 CLI 不转发。

## 开发

```bash
npm run dev -- -d ./messages -q
```

## 许可证

ISC
