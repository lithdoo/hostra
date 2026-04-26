# a-tools

Small filesystem utilities adapted from **Claude Code** (`anthropic/claude-code` or your local checkout). Intended for use inside the hostra monorepo.

## Agent tools (register yourself)

Import **each** tool and add it to your agent/provider registry. No built-in `registerAll`.

- **`readFileInRangeTool`** — `name: 'read_file'`; `execute(args, { signal?, readFileState?, cwd? })`. If `readFileState` is passed, successful reads are recorded (same map keys as write).
- **`fileWriteTool`** — `name: 'Write'`; `execute(args, { readFileState, cwd?, signal? })` **requires** a shared `readFileState` (Claude `FileWriteTool` semantics: existing files must be fully read first; new files need no prior read).
- Common types: **`AgentToolDefinition`**, **`AgentToolExecuteOptions`**, **`JsonObjectSchema`**, **`FileReadStateMap`**.

Example:

```ts
import {
  readFileInRangeTool,
  fileWriteTool,
  type AgentToolDefinition,
} from 'a-tools'

const readFileState: import('a-tools').FileReadStateMap = new Map()
// register tools; when invoking execute, pass { readFileState, cwd: process.cwd() } for both read and write.
```

## Library API (low-level)

### `readFileInRange(filePath, offset?, maxLines?, maxBytes?, signal?, options?)`

Async, line-oriented read: returns `{ content, lineCount, totalLines, totalBytes, readBytes, mtimeMs, truncatedByBytes? }`.

- Regular files under **10 MB**: fast path (`fs.readFile` + in-memory line split).
- Larger files, pipes, devices: streaming path (`createReadStream`).
- Strips UTF-8 BOM; normalizes CRLF to LF in returned lines.
- Throws **`FileTooLargeError`** when `maxBytes` is exceeded (unless `options.truncateOnByteLimit` is `true`).

Upstream reference: `src/utils/readFileInRange.ts`.

### `readFileSyncWithMetadata(filePath, options?)` / `readFileSync(filePath)`

Synchronous full-file read with BOM/encoding handling and CRLF→LF normalization, plus detected `lineEndings` (`CRLF` | `LF`). Uses `safeResolvePath` (symlink / UNC / special-file guards) from the same upstream design.

- `options.onSymlinkTraverse` replaces Claude’s `logForDebugging` when reading through a symlink.

Upstream reference: `src/utils/fileRead.ts`, `src/utils/fsOperations.ts` (`safeResolvePath`).

### `formatFileSize(bytes)`

Human-readable size string for errors.

### `writeTextFile` / `FileReadStateMap` (Claude `FileWriteTool` core)

- **`writeTextFile(filePath, content, { readFileState, cwd?, signal? })`**: full-file write with `readFileState` guards and `getFileModificationTime` checks (see `FileWriteTool` in Claude Code). Does not run LSP, skills, or permission UIs.
- Use **`setStateFromReadInRange`**, or pass **`readFileState`** to **`readFileInRangeTool.execute`** so the map stays aligned with `writeTextFile` / **`fileWriteTool`**.

## License

Confirm the license of your Claude Code source tree before redistributing copied code. This package is marked **ISC** to match sibling hostra packages; upstream terms may differ.

## Build

```bash
cd packages/a-tools
npm install
npm run build
npm test
```

There is no npm `workspaces` field at the hostra repository root; link this package from siblings with `"a-tools": "file:../a-tools"` (see `packages/promptpile`).
