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
  /** Target file name, for example `video.mp4` */
  name: string;
  /** Absolute or workspace-relative target file url (file://)*/
  fileUrl: string;
  /** Whether file name starts with `[hide]` */
  hidden: boolean;
  /** Optional sibling thumbnail path: `{name}.thumb.{ext}` */
  thumbnailFileUrl?: string;
  /** Optional sibling metadata path: `{name}.meta.toml` */
  metadataFileUrl?: string;
  /** Parsed metadata content from `.meta.toml` */
  metadata?: FVMeta;

  kind: 'file';
}

export interface FVDirectory {
  /** Target directory name, for example `[FILE_VIEW] 视频库` */
  name: string;
  /** Absolute or workspace-relative directory file url （file://）*/
  fileUrl: string;
  /** Whether directory name starts with `[hide]` */
  hidden: boolean;
  /** Optional sibling thumbnail path: `{directoryName}.thumb.{ext}` */
  thumbnailFileUrl?: string;
  /** Optional sibling metadata path: `{directoryName}.meta.toml` */
  metadataFileUrl?: string;
  /** Parsed metadata content from `.meta.toml` */
  metadata?: FVMeta;

  kind: 'directory';
}