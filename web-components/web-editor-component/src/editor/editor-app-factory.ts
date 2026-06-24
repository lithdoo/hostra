import type { EditorAppConfig } from 'monaco-languageclient/editorApp';
import {
  getLanguageRegistration,
  type EditorLanguage,
  modelUriForInstance,
} from '../languages/registry.js';

export function createEditorAppConfig(
  language: EditorLanguage,
  instanceId: string,
  text: string,
): EditorAppConfig {
  const reg = getLanguageRegistration(language);
  const uri = modelUriForInstance(language, instanceId);

  const base: EditorAppConfig = {
    codeResources: {
      modified: {
        text,
        uri,
        enforceLanguageId: reg.monacoLanguageId,
      },
    },
    overrideAutomaticLayout: true,
    editorOptions: {
      automaticLayout: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      theme: 'vs-dark',
    },
  };

  /**
   * TypeScript / Markdown: use monaco-vscode-standalone-languages (lazy Monarch).
   * Do not call `languages.register` again here — it would replace the tokenizer factory.
   */
  if (language === 'typescript' || language === 'markdown') {
    return base;
  }

  /** JSON + TOML: register extension point + Monarch here (not in standalone bundle). */
  return {
    ...base,
    languageDef: {
      languageExtensionConfig: reg.languageExtensionConfig,
      ...(reg.monarchLanguage !== undefined
        ? { monarchLanguage: reg.monarchLanguage }
        : {}),
    },
  };
}
