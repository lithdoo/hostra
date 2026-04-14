import chokidar, { type FSWatcher } from 'chokidar';
import { readdir, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { FVDirectory, FVFile } from './base.js';

export interface IFVState {
  fileList: (FVFile | FVDirectory)[];
  // 监听目录的元数据
  targetDir?: FVDirectory;
}

export interface IFVWsConnection {
  // 监听目标目录
  targetDirFileUrl?: string;

  // 文件变化回调
  onFileChange?: (type: 'add' | 'remove' | 'update', file: FVFile | FVDirectory) => void;

  // 监听目录变化回调
  onTargetDirChange?: (state: IFVState) => void;

  // 切换监听目录
  changeTargetDir(targetDirFileUrl: string): Promise<IFVState>;

  // 清除监听目录
  clearTargetDir(): Promise<IFVState>;

  // 获取文件列表
  fetchFileList(): Promise<IFVState>;
}

interface SnapshotEntry {
  item: FVFile | FVDirectory;
  signature: string;
}

interface CandidateAttachment {
  fileUrl: string;
  signature: string;
}

interface FVConnectionOptions {
  onFileChange?: IFVWsConnection['onFileChange'];
  onTargetDirChange?: IFVWsConnection['onTargetDirChange'];
}

function isHiddenName(name: string): boolean {
  return name.startsWith('[hide]');
}

function cloneState(state: IFVState): IFVState {
  return {
    targetDir: state.targetDir,
    fileList: [...state.fileList],
  };
}

function normalizeFileUrl(input: string): string {
  if (input.startsWith('file://')) {
    return input;
  }
  return pathToFileURL(resolve(input)).toString();
}

function fileUrlToPathSafe(fileUrl: string): string {
  if (fileUrl.startsWith('file://')) {
    return fileURLToPath(fileUrl);
  }
  return resolve(fileUrl);
}

function createDirectoryModel(fileUrl: string): FVDirectory {
  const dirName = basename(fileUrlToPathSafe(fileUrl));
  return {
    kind: 'directory',
    name: dirName,
    fileUrl,
    hidden: isHiddenName(dirName),
  };
}

function parseMetaBaseName(fileName: string): string | undefined {
  const suffix = '.meta.toml';
  if (!fileName.endsWith(suffix) || fileName.length <= suffix.length) {
    return undefined;
  }
  return fileName.slice(0, -suffix.length);
}

function parseThumbBaseName(fileName: string): string | undefined {
  const marker = '.thumb.';
  const markerIndex = fileName.lastIndexOf(marker);
  if (markerIndex <= 0) {
    return undefined;
  }
  const ext = fileName.slice(markerIndex + marker.length);
  if (!ext) {
    return undefined;
  }
  return fileName.slice(0, markerIndex);
}

function computePrimarySignature(
  baseSignature: string,
  metadataFileUrl?: string,
  thumbnailFileUrl?: string,
): string {
  return `${baseSignature}|meta:${metadataFileUrl ?? ''}|thumb:${thumbnailFileUrl ?? ''}`;
}

async function scanDirectory(dirFileUrl: string): Promise<Map<string, SnapshotEntry>> {
  const dirPath = fileUrlToPathSafe(dirFileUrl);
  const entries = await readdir(dirPath, { withFileTypes: true });
  const snapshot = new Map<string, SnapshotEntry>();
  const primaryByName = new Map<
    string,
    { item: FVFile | FVDirectory; fileUrl: string; baseSignature: string }
  >();
  const metaCandidates = new Map<string, CandidateAttachment[]>();
  const thumbCandidates = new Map<string, CandidateAttachment[]>();

  await Promise.all(
    entries.map(async (entry) => {
      const absPath = resolve(dirPath, entry.name);
      const fileUrl = pathToFileURL(absPath).toString();
      const stats = await stat(absPath);
      const baseSignature = `${stats.mtimeMs}:${stats.size}:${stats.mode}`;

      if (entry.isDirectory()) {
        const model: FVDirectory = {
          kind: 'directory',
          name: entry.name,
          fileUrl,
          hidden: isHiddenName(entry.name),
        };
        primaryByName.set(entry.name, { item: model, fileUrl, baseSignature });
        return;
      }

      if (entry.isFile()) {
        const metaBaseName = parseMetaBaseName(entry.name);
        if (metaBaseName) {
          const list = metaCandidates.get(metaBaseName) ?? [];
          list.push({ fileUrl, signature: baseSignature });
          metaCandidates.set(metaBaseName, list);
          return;
        }

        const thumbBaseName = parseThumbBaseName(entry.name);
        if (thumbBaseName) {
          const list = thumbCandidates.get(thumbBaseName) ?? [];
          list.push({ fileUrl, signature: baseSignature });
          thumbCandidates.set(thumbBaseName, list);
          return;
        }

        const model: FVFile = {
          kind: 'file',
          name: entry.name,
          fileUrl,
          hidden: isHiddenName(entry.name),
        };
        primaryByName.set(entry.name, { item: model, fileUrl, baseSignature });
      }
    }),
  );

  for (const [name, primary] of primaryByName) {
    const meta = metaCandidates.get(name)?.[0];
    const thumb = thumbCandidates.get(name)?.[0];
    if (primary.item.kind === 'file') {
      primary.item.metadataFileUrl = meta?.fileUrl;
      primary.item.thumbnailFileUrl = thumb?.fileUrl;
    } else {
      primary.item.metadataFileUrl = meta?.fileUrl;
      primary.item.thumbnailFileUrl = thumb?.fileUrl;
    }

    const attachmentSignature = `${meta?.signature ?? ''}:${thumb?.signature ?? ''}`;
    const signature = computePrimarySignature(
      `${primary.baseSignature}|attachment:${attachmentSignature}`,
      meta?.fileUrl,
      thumb?.fileUrl,
    );
    snapshot.set(primary.fileUrl, { item: primary.item, signature });
  }

  return snapshot;
}

function sortedItems(snapshot: Map<string, SnapshotEntry>): (FVFile | FVDirectory)[] {
  return [...snapshot.values()]
    .map((entry) => entry.item)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export class FVWsConnection implements IFVWsConnection {
  public targetDirFileUrl?: string;
  public onFileChange?: (type: 'add' | 'remove' | 'update', file: FVFile | FVDirectory) => void;
  public onTargetDirChange?: (state: IFVState) => void;

  private watcher?: FSWatcher;
  private snapshot = new Map<string, SnapshotEntry>();
  private readonly state: IFVState = {
    fileList: [],
    targetDir: undefined,
  };
  private refreshInFlight?: Promise<IFVState>;
  private watchEventDebounce?: NodeJS.Timeout;

  public constructor(private readonly options: FVConnectionOptions = {}) {
    this.onFileChange = options.onFileChange;
    this.onTargetDirChange = options.onTargetDirChange;
  }

  private notifyState(): void {
    const current = cloneState(this.state);
    this.options.onTargetDirChange?.(current);
    this.onTargetDirChange?.(current);
  }

  private notifyFileChange(type: 'add' | 'remove' | 'update', item: FVFile | FVDirectory): void {
    this.options.onFileChange?.(type, item);
    this.onFileChange?.(type, item);
  }

  private emitDiff(prev: Map<string, SnapshotEntry>, next: Map<string, SnapshotEntry>): void {
    for (const [key, nextEntry] of next) {
      const prevEntry = prev.get(key);
      if (!prevEntry) {
        this.notifyFileChange('add', nextEntry.item);
        continue;
      }
      if (prevEntry.signature !== nextEntry.signature) {
        this.notifyFileChange('update', nextEntry.item);
      }
    }

    for (const [key, prevEntry] of prev) {
      if (!next.has(key)) {
        this.notifyFileChange('remove', prevEntry.item);
      }
    }
  }

  private async closeWatcher(): Promise<void> {
    if (this.watchEventDebounce) {
      clearTimeout(this.watchEventDebounce);
      this.watchEventDebounce = undefined;
    }
    if (this.watcher) {
      await this.watcher.close();
    }
    this.watcher = undefined;
  }

  private async refreshState(): Promise<IFVState> {
    if (!this.targetDirFileUrl) {
      this.state.fileList = [];
      this.state.targetDir = undefined;
      this.notifyState();
      return cloneState(this.state);
    }

    const nextSnapshot = await scanDirectory(this.targetDirFileUrl);
    this.emitDiff(this.snapshot, nextSnapshot);
    this.snapshot = nextSnapshot;
    this.state.fileList = sortedItems(this.snapshot);
    this.state.targetDir = createDirectoryModel(this.targetDirFileUrl);
    this.notifyState();
    return cloneState(this.state);
  }

  private scheduleRefreshFromWatch = () => {
    if (this.watchEventDebounce) {
      clearTimeout(this.watchEventDebounce);
    }
    this.watchEventDebounce = setTimeout(() => {
      void this.refreshState().catch(() => {
        // Keep watcher alive; consumer can refresh manually after transient fs errors.
      });
    }, 60);
  };

  private ensureWatcher(): void {
    if (!this.targetDirFileUrl) {
      return;
    }
    const targetPath = fileUrlToPathSafe(this.targetDirFileUrl);
    this.watcher = chokidar.watch(targetPath, {
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: {
        stabilityThreshold: 80,
        pollInterval: 20,
      },
    });
    this.watcher.on('add', this.scheduleRefreshFromWatch);
    this.watcher.on('change', this.scheduleRefreshFromWatch);
    this.watcher.on('unlink', this.scheduleRefreshFromWatch);
    this.watcher.on('addDir', this.scheduleRefreshFromWatch);
    this.watcher.on('unlinkDir', this.scheduleRefreshFromWatch);
  }

  public async changeTargetDir(nextTargetDirFileUrl: string): Promise<IFVState> {
    await this.closeWatcher();
    const normalized = normalizeFileUrl(nextTargetDirFileUrl);
    const targetPath = fileUrlToPathSafe(normalized);
    const targetStat = await stat(targetPath);
    if (!targetStat.isDirectory()) {
      throw new Error(`Target path is not a directory: ${nextTargetDirFileUrl}`);
    }

    this.targetDirFileUrl = normalized;
    this.snapshot = new Map<string, SnapshotEntry>();

    const nextState = await this.refreshState();
    this.ensureWatcher();
    return nextState;
  }

  public async clearTargetDir(): Promise<IFVState> {
    await this.closeWatcher();
    this.targetDirFileUrl = undefined;
    this.snapshot = new Map<string, SnapshotEntry>();
    this.state.fileList = [];
    this.state.targetDir = undefined;
    this.notifyState();
    return cloneState(this.state);
  }

  public async fetchFileList(): Promise<IFVState> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.refreshState().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }
}
