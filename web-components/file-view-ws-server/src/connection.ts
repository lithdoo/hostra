import chokidar, { type FSWatcher } from 'chokidar';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseToml } from 'toml';
import type { FVDirectory, FVFile, FVMeta, FVMetaInfo, FVMetaLink } from './base.js';

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

  // 获取当前连接状态
  getState(): Promise<IFVState>;
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

const ALLOWED_THUMB_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg']);

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
  if (!ext || ext !== ext.toLowerCase() || !ALLOWED_THUMB_EXTENSIONS.has(ext)) {
    return undefined;
  }
  return fileName.slice(0, markerIndex);
}

function computePrimarySignature(
  baseSignature: string,
  metadataFileUrl?: string,
  thumbnailFileUrl?: string,
  metadataDigest?: string,
): string {
  return `${baseSignature}|meta:${metadataFileUrl ?? ''}|thumb:${thumbnailFileUrl ?? ''}|metaDigest:${metadataDigest ?? ''}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value.filter((item) => typeof item === 'string');
  return normalized.length > 0 ? normalized : undefined;
}

function toMetaLinks(value: unknown): FVMetaLink[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const links: FVMetaLink[] = [];
  for (const item of value) {
    if (!isObject(item)) {
      continue;
    }
    if (typeof item.title !== 'string' || typeof item.url !== 'string') {
      continue;
    }
    links.push({ title: item.title, url: item.url });
  }
  return links.length > 0 ? links : undefined;
}

function normalizeMetaInfo(raw: unknown, fallbackLinks?: FVMetaLink[]): FVMetaInfo | undefined {
  if (!isObject(raw)) {
    if (!fallbackLinks) {
      return undefined;
    }
    return { links: fallbackLinks };
  }
  const info: FVMetaInfo = {};
  if (typeof raw.title === 'string') {
    info.title = raw.title;
  }
  if (typeof raw.describe === 'string') {
    info.describe = raw.describe;
  }
  const tags = toStringArray(raw.tags);
  if (tags) {
    info.tags = tags;
  }
  const ownLinks = toMetaLinks(raw.links);
  if (ownLinks) {
    info.links = ownLinks;
  } else if (fallbackLinks) {
    info.links = fallbackLinks;
  }
  return Object.keys(info).length > 0 ? info : undefined;
}

function toFVMeta(raw: unknown): FVMeta | undefined {
  if (!isObject(raw)) {
    return undefined;
  }
  const topLevelLinks = toMetaLinks(raw.links);
  const info = normalizeMetaInfo(raw.info, topLevelLinks);
  const extendsField = isObject(raw.extends) ? raw.extends : undefined;
  const meta: FVMeta = {};
  if (info) {
    meta.info = info;
  }
  if (extendsField) {
    meta.extends = extendsField;
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`).join(',')}}`;
}

function metadataDigest(value: FVMeta | undefined): string {
  return value ? stableStringify(value) : '';
}

async function readMetaFile(fileUrl: string): Promise<FVMeta | undefined> {
  try {
    const filePath = fileUrlToPathSafe(fileUrl);
    const content = await readFile(filePath, 'utf8');
    const parsed = parseToml(content) as unknown;
    return toFVMeta(parsed);
  } catch {
    return undefined;
  }
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

  await Promise.all(
    [...primaryByName.entries()].map(async ([name, primary]) => {
      const meta = metaCandidates.get(name)?.[0];
      const thumb = thumbCandidates.get(name)?.[0];
      primary.item.metadataFileUrl = meta?.fileUrl;
      primary.item.thumbnailFileUrl = thumb?.fileUrl;
      primary.item.metadata = meta?.fileUrl ? await readMetaFile(meta.fileUrl) : undefined;

      const attachmentSignature = `${meta?.signature ?? ''}:${thumb?.signature ?? ''}`;
      const signature = computePrimarySignature(
        `${primary.baseSignature}|attachment:${attachmentSignature}`,
        meta?.fileUrl,
        thumb?.fileUrl,
        metadataDigest(primary.item.metadata),
      );
      snapshot.set(primary.fileUrl, { item: primary.item, signature });
    }),
  );

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

  public async getState(): Promise<IFVState> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.refreshState().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }
}

export function createFVWsConnection(options: FVConnectionOptions = {}): IFVWsConnection {
  return new FVWsConnection(options);
}
