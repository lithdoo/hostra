import type * as monaco from '@codingame/monaco-vscode-editor-api';

/**
 * Supported `language` attribute values map to Monaco / LSP language ids.
 */
export type EditorLanguage = 'typescript' | 'json' | 'markdown' | 'toml';

export interface LanguageRegistration {
  /** Monaco + LSP document language id */
  monacoLanguageId: string;
  /** Virtual path under `/workspace` for this model */
  fileName: string;
  languageExtensionConfig: monaco.languages.ILanguageExtensionPoint;
  /** Optional Monarch grammar (classic mode); required for TOML baseline highlighting */
  monarchLanguage?: monaco.languages.IMonarchLanguage;
}

/** JSON has no entry in monaco-vscode-standalone-languages; use a small Monarch grammar. */
const JSON_MONARCH: monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenizer: {
    root: [
      [/[{}]/, 'delimiter.bracket'],
      [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'attribute.name'],
      [/"(?:[^"\\]|\\.)*"/, 'string'],
      [/\btrue\b|\bfalse\b|\bnull\b/, 'keyword'],
      [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
      [/,/, 'delimiter'],
    ],
  },
};

const TOML_MONARCH: monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenizer: {
    root: [
      [/^\s*#.*$/, 'comment'],
      [/"""/, 'string', '@multilineString'],
      [/"/, 'string', '@string'],
      [/^\s*\[[^\]]+\]\s*$/, 'namespace'],
      [/[A-Za-z0-9_-]+(?=\s*=)/, 'key'],
      [/\d+\.\d+/, 'number.float'],
      [/\d+/, 'number'],
      [/\btrue|false\b/, 'keyword'],
    ],
    string: [
      [/[^"\\]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"/, 'string', '@pop'],
    ],
    multilineString: [
      [/"""/, 'string', '@pop'],
      [/./, 'string'],
    ],
  },
};

const registry: Record<EditorLanguage, LanguageRegistration> = {
  typescript: {
    monacoLanguageId: 'typescript',
    fileName: 'main.ts',
    languageExtensionConfig: {
      id: 'typescript',
      extensions: ['.ts', '.tsx'],
      aliases: ['TypeScript', 'typescript', 'ts'],
      mimetypes: ['text/typescript'],
    },
  },
  json: {
    monacoLanguageId: 'json',
    fileName: 'document.json',
    languageExtensionConfig: {
      id: 'json',
      extensions: ['.json', '.jsonc'],
      aliases: ['JSON', 'json'],
      mimetypes: ['application/json'],
    },
    monarchLanguage: JSON_MONARCH,
  },
  markdown: {
    monacoLanguageId: 'markdown',
    fileName: 'document.md',
    languageExtensionConfig: {
      id: 'markdown',
      extensions: ['.md', '.markdown'],
      aliases: ['Markdown', 'markdown'],
      mimetypes: ['text/markdown'],
    },
  },
  toml: {
    monacoLanguageId: 'toml',
    fileName: 'config.toml',
    languageExtensionConfig: {
      id: 'toml',
      extensions: ['.toml'],
      aliases: ['TOML', 'toml'],
      mimetypes: ['text/x-toml'],
    },
    monarchLanguage: TOML_MONARCH,
  },
};

/**
 * Normalizes attribute/property strings such as `ts`, `md`, `JSON`.
 */
export function parseEditorLanguage(raw: string | null | undefined): EditorLanguage | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const key = raw.trim().toLowerCase();
  if (key === 'typescript' || key === 'ts') {
    return 'typescript';
  }
  if (key === 'json' || key === 'jsonc') {
    return 'json';
  }
  if (key === 'markdown' || key === 'md') {
    return 'markdown';
  }
  if (key === 'toml') {
    return 'toml';
  }
  return null;
}

export function getLanguageRegistration(lang: EditorLanguage): LanguageRegistration {
  return registry[lang];
}

export function modelUriForInstance(lang: EditorLanguage, instanceId: string): string {
  const { fileName } = getLanguageRegistration(lang);
  const dot = fileName.lastIndexOf('.');
  const base = dot === -1 ? fileName : fileName.slice(0, dot);
  const ext = dot === -1 ? '' : fileName.slice(dot);
  return `/workspace/${base}-${instanceId}${ext}`;
}

/** Virtual `file:///workspace/…` URI string used by Monaco / LSP (matches `modelUriForInstance`). */
export function virtualDocumentFileUrl(lang: EditorLanguage, instanceId: string): string {
  return `file://${modelUriForInstance(lang, instanceId)}`;
}
