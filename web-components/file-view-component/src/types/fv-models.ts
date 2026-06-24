/**
 * Mirrors `@web-editor/file-view-ws-server` `src/base.ts` + `IFVState` from `connection.ts`
 * for browser-side typing (no runtime dependency on the server package).
 */

export interface FVMetaLink {
  title: string;
  url: string;
}

export interface FVMetaInfo {
  title?: string;
  describe?: string;
  tags?: string[];
  links?: FVMetaLink[];
}

export interface FVMeta {
  info?: FVMetaInfo;
  extends?: Record<string, unknown>;
}

export interface FVFile {
  name: string;
  fileUrl: string;
  hidden: boolean;
  thumbnailFileUrl?: string;
  metadataFileUrl?: string;
  metadata?: FVMeta;
  kind: 'file';
}

export interface FVDirectory {
  name: string;
  fileUrl: string;
  hidden: boolean;
  thumbnailFileUrl?: string;
  metadataFileUrl?: string;
  metadata?: FVMeta;
  kind: 'directory';
}

export interface IFVState {
  fileList: (FVFile | FVDirectory)[];
  targetDir?: FVDirectory;
}
