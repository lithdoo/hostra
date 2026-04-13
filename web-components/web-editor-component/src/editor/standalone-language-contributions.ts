/**
 * Registers lazy Monarch tokenizers for built-in languages (classic monaco-vscode-api).
 * Must load before EditorApp sets the model language for typescript / javascript / markdown.
 *
 * @see https://github.com/CodinGame/monaco-vscode-api — standalone-languages contributions
 */
import '@codingame/monaco-vscode-standalone-languages/typescript/typescript.contribution.js';
import '@codingame/monaco-vscode-standalone-languages/javascript/javascript.contribution.js';
import '@codingame/monaco-vscode-standalone-languages/markdown/markdown.contribution.js';
